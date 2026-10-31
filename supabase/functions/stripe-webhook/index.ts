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

      const { error } = await db.from("purchases").upsert({
        owner_id: ownerId,
        workspace_id: workspaceId,
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
        customer_email: session.customer_details?.email ?? session.customer_email ?? null,
        product_key: productKey,
        amount_total: amount,
        amount_refunded: 0,
        currency: (session.currency ?? "usd").toLowerCase(),
        payment_status: paymentStatus,
        paid_at: paymentStatus === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "stripe_checkout_session_id" });
      if (error) throw error;
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
