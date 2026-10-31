import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS", "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!url || !anonKey || !serviceKey) return json({ error: "Delivery configuration is unavailable" }, 500);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Sign in as the seller to configure delivery" }, 401);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Valid seller sign-in is required" }, 401);

  let body: { workspace_id?: string; product_key?: string; storage_path?: string; product_name?: string; product_description?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const workspaceId = body.workspace_id?.trim() ?? "";
  const productKey = body.product_key?.trim() ?? "";
  const path = body.storage_path?.trim() ?? "";
  const name = body.product_name?.trim() ?? "";
  const description = body.product_description?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId) || !productKey || productKey.length > 80) return json({ error: "Valid workspace and product key are required" }, 400);
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("..") || path.includes("\\") || path.includes("?") || path.includes("#")) return json({ error: "Enter a valid private bucket object path" }, 400);
  if (!name || name.length > 120 || description.length > 500) return json({ error: "Product name is required; description must be 500 characters or fewer" }, 400);

  const { data: product, error: lookupError } = await db.from("stripe_products")
    .select("id").eq("workspace_id", workspaceId).eq("owner_id", authData.user.id)
    .eq("product_key", productKey).eq("active", true).maybeSingle();
  if (lookupError) return json({ error: "Could not verify product ownership" }, 500);
  if (!product) return json({ error: "No active Stripe product belongs to this seller and workspace" }, 404);
  const { error: updateError } = await db.from("stripe_products").update({
    delivery_bucket: "customer-deliveries",
    delivery_path: path,
    product_name: name,
    product_description: description,
  }).eq("id", product.id);
  if (updateError) return json({ error: "Could not save delivery configuration" }, 500);
  return json({ saved: true, bucket: "customer-deliveries", product_key: productKey });
});
