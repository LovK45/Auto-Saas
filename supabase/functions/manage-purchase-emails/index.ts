import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const origin = Deno.env.get("APP_BASE_URL") ?? "";
const cors = {
  "access-control-allow-origin": origin,
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] ?? c));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!url || !anonKey || !serviceKey || !origin) return json({ error: "Function is not configured" }, 500);
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign-in required" }, 401);
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return json({ error: "Invalid session" }, 401);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));
  if (body.action === "list") {
    const { data, error } = await db.from("purchase_email_notifications")
      .select("stripe_checkout_session_id,recipient_email,product_name,status,attempt_count,last_attempt_at,sent_at,last_error,created_at")
      .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(100);
    if (error) return json({ error: "Could not load notification records" }, 500);
    return json({ notifications: data ?? [] });
  }
  if (body.action !== "retry" || typeof body.sessionId !== "string" || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(body.sessionId)) {
    return json({ error: "Invalid action or checkout session ID" }, 400);
  }
  const { data: notification, error: noteError } = await db.from("purchase_email_notifications")
    .select("*").eq("stripe_checkout_session_id", body.sessionId).eq("owner_id", user.id).maybeSingle();
  if (noteError || !notification) return json({ error: "Notification not found for this seller" }, 404);
  if (notification.status === "sent") return json({ error: "This confirmation was already sent" }, 409);
  const { data: purchase, error: purchaseError } = await db.from("purchases")
    .select("payment_status,amount_total,currency,owner_id,workspace_id")
    .eq("stripe_checkout_session_id", body.sessionId).eq("owner_id", user.id).maybeSingle();
  if (purchaseError || !purchase || !["paid","partially_refunded"].includes(purchase.payment_status)) {
    return json({ error: "Only verified paid purchases can receive a confirmation email" }, 409);
  }
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("PURCHASE_EMAIL_FROM") ?? "";
  const appUrl = origin.replace(/\/$/, "");
  if (!apiKey || !from) return json({ error: "Configure RESEND_API_KEY and PURCHASE_EMAIL_FROM first" }, 503);
  const attempt = Number(notification.attempt_count ?? 0) + 1;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171923"><h1>Purchase confirmed</h1><p>Stripe has confirmed your payment for <strong>${esc(notification.product_name)}</strong>.</p><p>Paid: ${new Intl.NumberFormat("en-US",{style:"currency",currency:String(purchase.currency||"usd").toUpperCase()}).format(Number(purchase.amount_total||0)/100)}</p><p>Sign in or create an account using this same email address to access your customer library.</p><p><a href="${esc(appUrl)}">Open your customer library</a></p></body></html>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `purchase-confirmation-${body.sessionId}-retry-${attempt}` },
    body: JSON.stringify({ from, to: [notification.recipient_email], subject: `Purchase confirmed: ${notification.product_name}`, html }),
  });
  const result = await response.json().catch(() => ({}));
  const patch = {
    status: response.ok ? "sent" : "failed",
    attempt_count: attempt,
    last_attempt_at: new Date().toISOString(),
    sent_at: response.ok ? new Date().toISOString() : null,
    provider_message_id: response.ok && typeof result.id === "string" ? result.id : null,
    last_error: response.ok ? null : `Resend request failed (${response.status})`,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await db.from("purchase_email_notifications")
    .update(patch).eq("stripe_checkout_session_id", body.sessionId).eq("owner_id", user.id);
  if (updateError) return json({ error: "Email result could not be saved; check provider logs before retrying" }, 500);
  if (!response.ok) return json({ error: "Email provider rejected the retry", status: response.status }, 502);
  return json({ sent: true, messageId: result.id ?? null });
});
