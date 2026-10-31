import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2025-01-27.acacia",
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});


const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] ?? char));

async function sendPurchaseConfirmation(input: {
  sessionId: string;
  email: string;
  productName: string;
  description: string;
  ownerId: string;
  workspaceId: string;
  amount: number;
  currency: string;
}) {
  const { data: existing, error: lookupError } = await db.from("purchase_email_notifications")
    .select("status").eq("stripe_checkout_session_id", input.sessionId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.status === "sent") return;

  const { error: reserveError } = await db.from("purchase_email_notifications").upsert({
    stripe_checkout_session_id: input.sessionId,
    recipient_email: input.email,
    owner_id: input.ownerId,
    workspace_id: input.workspaceId,
    product_name: input.productName,
    status: "pending",
    updated_at: new Date().toISOString(),
  }, { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true });
  if (reserveError) throw reserveError;

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("PURCHASE_EMAIL_FROM") ?? "";
  const appUrl = Deno.env.get("APP_BASE_URL") ?? "";
  if (!apiKey || !from || !appUrl) {
    await db.from("purchase_email_notifications").update({
      status: "pending",
      last_error: "Email provider is not configured (RESEND_API_KEY, PURCHASE_EMAIL_FROM, APP_BASE_URL)",
      updated_at: new Date().toISOString(),
    }).eq("stripe_checkout_session_id", input.sessionId);
    return;
  }

  const product = escapeHtml(input.productName);
  const description = escapeHtml(input.description || "Your purchase is ready in your customer library.");
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency", currency: input.currency.toUpperCase(),
  }).format(input.amount / 100);
  const safeAppUrl = escapeHtml(appUrl.replace(/\/$/, ""));
  const html = `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f6fa;font-family:Arial,sans-serif;color:#171923"><div style="max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:32px"><h1 style="margin-top:0">Your purchase is confirmed</h1><p>Thank you for your purchase. Stripe has confirmed your payment.</p><h2>${product}</h2><p>${description}</p><p><strong>Paid:</strong> ${amount}</p><p>To access your purchase, sign in or create an account using this same email address:</p><p><a href="${safeAppUrl}" style="display:inline-block;padding:13px 20px;background:#5b4bdb;color:#fff;text-decoration:none;border-radius:8px">Open your customer library</a></p><p style="font-size:13px;color:#666">If you have not created an account yet, register with the email address that received this message. Your available purchases will appear in the library after sign-in.</p></div></body></html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `purchase-confirmation-${input.sessionId}`,
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: `Purchase confirmed: ${input.productName}`,
      html,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    await db.from("purchase_email_notifications").update({
      status: "failed",
      last_error: `Resend request failed (${response.status})`,
      updated_at: new Date().toISOString(),
    }).eq("stripe_checkout_session_id", input.sessionId);
    console.error("Purchase confirmation email failed", response.status, result);
    return;
  }
  const { error: sentError } = await db.from("purchase_email_notifications").update({
    status: "sent",
    provider_message_id: typeof result.id === "string" ? result.id : null,
    last_error: null,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("stripe_checkout_session_id", input.sessionId);
  if (sentError) throw sentError;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!webhookSecret || !serviceRoleKey || !supabaseUrl || !Deno.env.get("STRIPE_SECRET_KEY")) {
    return json({ error: "Webhook is not configured" }, 500);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing Stripe signature" }, 400);

  // Verify the exact raw body before parsing or trusting any event fields.
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody, signature, webhookSecret, undefined, cryptoProvider,
    );
  } catch {
    return json({ error: "Invalid webhook signature" }, 400);
  }

  const supported = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "charge.refunded",
  ]);
  if (!supported.has(event.type)) return json({ received: true, ignored: true });

  // Reserve the event ID first. On processing failure it is removed so Stripe retries can succeed.
  const { error: reserveError } = await db.from("stripe_webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    processing_status: "processing",
  });
  if (reserveError) {
    if (reserveError.code === "23505") return json({ received: true, duplicate: true });
    return json({ error: "Could not reserve event" }, 500);
  }

  try {
    if (event.type.startsWith("checkout.session.")) {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata ?? {};
      const ownerId = metadata.owner_id;
      const workspaceId = metadata.workspace_id;
      const productKey = metadata.product_key;
      if (!ownerId || !workspaceId || !productKey) {
        throw new Error("Checkout session is missing required owner_id, workspace_id or product_key metadata");
      }

      const { data: workspace, error: workspaceError } = await db
        .from("workspaces")
        .select("id, owner_id")
        .eq("id", workspaceId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (workspaceError || !workspace) throw new Error("Checkout metadata does not match an owned workspace");

      const isFailed = event.type === "checkout.session.async_payment_failed";
      const paymentStatus = isFailed ? "failed" : session.payment_status === "paid" ? "paid" : "pending";
      const sessionId = session.id;
      const amount = Number(session.amount_total ?? 0);
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid checkout amount");

      const buyerEmail = (session.customer_details?.email ?? session.customer_email ?? "").trim().toLowerCase();
      const { error } = await db.from("purchases").upsert({
        owner_id: ownerId,
        workspace_id: workspaceId,
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
        customer_email: buyerEmail || null,
        product_key: productKey,
        amount_total: amount,
        amount_refunded: 0,
        currency: (session.currency ?? "usd").toLowerCase(),
        payment_status: paymentStatus,
        paid_at: paymentStatus === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "stripe_checkout_session_id" });
      if (error) throw error;

      // Create/revoke delivery entitlement only for a paid session with a verified buyer email
      // and an explicitly configured private Storage object on the server-managed product record.
      const { data: deliveryProduct, error: deliveryLookupError } = await db.from("stripe_products")
        .select("delivery_bucket, delivery_path, product_name, product_description")
        .eq("workspace_id", workspaceId).eq("owner_id", ownerId).eq("product_key", productKey)
        .eq("active", true).maybeSingle();
      if (deliveryLookupError) throw deliveryLookupError;
      if (buyerEmail && deliveryProduct?.delivery_bucket && deliveryProduct?.delivery_path) {
        const { error: entitlementError } = await db.from("purchase_entitlements").upsert({
          stripe_checkout_session_id: sessionId,
          owner_id: ownerId,
          workspace_id: workspaceId,
          product_key: productKey,
          product_name: deliveryProduct.product_name ?? productKey,
          product_description: deliveryProduct.product_description ?? "",
          customer_email: buyerEmail,
          storage_bucket: deliveryProduct.delivery_bucket,
          storage_path: deliveryProduct.delivery_path,
          entitlement_status: paymentStatus === "paid" ? "active" : "inactive",
          updated_at: new Date().toISOString(),
        }, { onConflict: "stripe_checkout_session_id" });
        if (entitlementError) throw entitlementError;
      }

      // Notify only after Stripe confirms payment. Resend's idempotency key protects retries.
      if (paymentStatus === "paid" && buyerEmail) {
        await sendPurchaseConfirmation({
          sessionId,
          email: buyerEmail,
          productName: deliveryProduct?.product_name ?? productKey,
          ownerId,
          workspaceId,
          description: deliveryProduct?.product_description ?? "",
          amount,
          currency: (session.currency ?? "usd").toLowerCase(),
        });
      }
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === "string"
        ? charge.payment_intent : charge.payment_intent?.id;
      if (paymentIntentId) {
        const { error } = await db.from("purchases").update({
          amount_refunded: charge.amount_refunded,
          payment_status: charge.refunded ? "refunded" : "partially_refunded",
          refunded_at: charge.refunded ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq("stripe_payment_intent_id", paymentIntentId);
        if (error) throw error;
        const { data: purchase, error: purchaseLookupError } = await db.from("purchases")
          .select("stripe_checkout_session_id").eq("stripe_payment_intent_id", paymentIntentId).maybeSingle();
        if (purchaseLookupError) throw purchaseLookupError;
        if (purchase) {
          const { error: entitlementError } = await db.from("purchase_entitlements").update({
            entitlement_status: charge.refunded ? "revoked" : "inactive",
            updated_at: new Date().toISOString(),
          }).eq("stripe_checkout_session_id", purchase.stripe_checkout_session_id);
          if (entitlementError) throw entitlementError;
        }
      }
    }

    const { error: completeError } = await db.from("stripe_webhook_events")
      .update({ processing_status: "processed", processed_at: new Date().toISOString() })
      .eq("stripe_event_id", event.id);
    if (completeError) throw completeError;
    return json({ received: true });
  } catch (error) {
    await db.from("stripe_webhook_events").delete().eq("stripe_event_id", event.id);
    console.error("Stripe webhook processing failed", error);
    return json({ error: "Event processing failed; Stripe may retry" }, 500);
  }
});
