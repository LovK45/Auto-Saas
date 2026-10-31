import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2025-01-27.acacia",
});
const baseUrl = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function response(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "authorization, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "Origin",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS") {
    if (!baseUrl || origin !== new URL(baseUrl).origin) return new Response("Forbidden", { status: 403 });
    return response({}, 200, origin);
  }
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);
  if (!baseUrl || !supabaseUrl || !anonKey || !serviceRoleKey || !Deno.env.get("STRIPE_SECRET_KEY")) {
    return response({ error: "Checkout is not configured" }, 500, origin);
  }
  if (origin !== new URL(baseUrl).origin) return response({ error: "Origin not allowed" }, 403, origin);

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return response({ error: "Sign in is required" }, 401, origin);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (authError || !user) return response({ error: "Invalid or expired session" }, 401, origin);

  let input: { workspace_id?: string; product_key?: string };
  try { input = await req.json(); } catch { return response({ error: "Invalid JSON" }, 400, origin); }
  const workspaceId = input.workspace_id?.trim();
  const productKey = input.product_key?.trim();
  if (!workspaceId || !productKey || workspaceId.length > 80 || productKey.length > 120) {
    return response({ error: "workspace_id and product_key are required" }, 400, origin);
  }

  const { data: workspace, error: workspaceError } = await admin.from("workspaces")
    .select("id, owner_id").eq("id", workspaceId).eq("owner_id", user.id).maybeSingle();
  if (workspaceError || !workspace) return response({ error: "Workspace not found" }, 404, origin);

  // Prices are looked up server-side; clients cannot submit or override an amount.
  const { data: product, error: productError } = await admin.from("stripe_products")
    .select("product_key, stripe_price_id, active")
    .eq("workspace_id", workspaceId).eq("owner_id", user.id)
    .eq("product_key", productKey).eq("active", true).maybeSingle();
  if (productError || !product?.stripe_price_id) return response({ error: "Active product price not found" }, 404, origin);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: product.stripe_price_id, quantity: 1 }],
      // The buyer is not the authenticated seller. Stripe Checkout collects the buyer email.
      metadata: { owner_id: user.id, workspace_id: workspaceId, product_key: productKey },
      success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?checkout=cancelled`,
    });
    if (!session.url) return response({ error: "Stripe did not return a checkout URL" }, 502, origin);
    return response({ checkout_url: session.url }, 200, origin);
  } catch (error) {
    console.error("Stripe Checkout creation failed", error);
    return response({ error: "Unable to create checkout session" }, 502, origin);
  }
});
