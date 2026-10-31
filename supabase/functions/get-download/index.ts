import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Delivery is not configured" }, 500);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Sign in with the purchasing email to access your order" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: authError } = await userClient.auth.getUser(token);
  const email = data?.user?.email?.trim().toLowerCase();
  if (authError || !email) return json({ error: "Valid customer sign-in is required" }, 401);

  let body: { checkout_session_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const sessionId = body.checkout_session_id?.trim();
  if (!sessionId || !sessionId.startsWith("cs_") || sessionId.length > 255) {
    return json({ error: "A valid checkout session ID is required" }, 400);
  }

  const { data: entitlement, error: lookupError } = await db.from("purchase_entitlements")
    .select("storage_bucket, storage_path, entitlement_status, customer_email")
    .eq("stripe_checkout_session_id", sessionId)
    .eq("entitlement_status", "active")
    .maybeSingle();
  if (lookupError) return json({ error: "Could not verify purchase access" }, 500);
  if (!entitlement || entitlement.customer_email.trim().toLowerCase() !== email) {
    return json({ error: "No active purchase is associated with this signed-in email" }, 404);
  }

  const { data: signed, error: signError } = await db.storage
    .from(entitlement.storage_bucket)
    .createSignedUrl(entitlement.storage_path, 90);
  if (signError || !signed?.signedUrl) return json({ error: "Delivery file is not available; contact the seller" }, 404);
  return json({ download_url: signed.signedUrl, expires_in_seconds: 90 });
});
