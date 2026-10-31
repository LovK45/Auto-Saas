import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!url || !anonKey || !serviceKey) return json({ error: "Library is not configured" }, 500);
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return json({ error: "Sign in to view your purchases" }, 401);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  const email = authData?.user?.email?.trim().toLowerCase();
  if (authError || !email) return json({ error: "Valid customer sign-in is required" }, 401);

  const { data: entitlements, error: entError } = await db.from("purchase_entitlements")
    .select("stripe_checkout_session_id, product_key, entitlement_status, created_at")
    .eq("customer_email", email)
    .order("created_at", { ascending: false })
    .limit(100);
  if (entError) return json({ error: "Could not load your product library" }, 500);
  const sessions = (entitlements ?? []).map((item) => item.stripe_checkout_session_id);
  if (!sessions.length) return json({ purchases: [] });

  const { data: purchases, error: purchaseError } = await db.from("purchases")
    .select("stripe_checkout_session_id, product_key, amount_total, amount_refunded, currency, payment_status, created_at, paid_at")
    .in("stripe_checkout_session_id", sessions);
  if (purchaseError) return json({ error: "Could not load purchase details" }, 500);
  const bySession = new Map((purchases ?? []).map((item) => [item.stripe_checkout_session_id, item]));
  const result = (entitlements ?? []).map((item) => {
    const purchase = bySession.get(item.stripe_checkout_session_id);
    return {
      checkout_session_id: item.stripe_checkout_session_id,
      product_key: item.product_key,
      entitlement_status: item.entitlement_status,
      created_at: item.created_at,
      payment_status: purchase?.payment_status ?? "unknown",
      amount_total: purchase?.amount_total ?? 0,
      amount_refunded: purchase?.amount_refunded ?? 0,
      currency: purchase?.currency ?? "usd",
      paid_at: purchase?.paid_at ?? null,
    };
  });
  return json({ purchases: result });
});
