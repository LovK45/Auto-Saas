import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-01-27.acacia" });
const base = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
function reply(body: unknown, status=200) { return new Response(JSON.stringify(body), { status, headers: { "content-type":"application/json", "cache-control":"no-store", "access-control-allow-origin": base ? new URL(base).origin : "null", "access-control-allow-headers":"content-type, apikey, x-client-info", "access-control-allow-methods":"GET, POST, OPTIONS" } }); }
Deno.serve(async (req: Request) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: { "access-control-allow-origin": base ? new URL(base).origin : "null", "access-control-allow-methods":"GET, POST, OPTIONS", "access-control-allow-headers":"content-type, apikey, x-client-info" } });
 if (!base || !Deno.env.get("STRIPE_SECRET_KEY") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return reply({error:"Checkout is not configured"},500);
 if (req.headers.get("origin") !== new URL(base).origin) return reply({error:"Origin not allowed"},403);
 const key = req.method === "GET" ? new URL(req.url).searchParams.get("key") : (req.method === "POST" ? (await req.json().catch(()=>({}))).key : null);
 if (req.method !== "GET" && req.method !== "POST") return reply({error:"Method not allowed"},405);
 if (!key || !/^[0-9a-f-]{36}$/i.test(key)) return reply({error:"Invalid checkout link"},400);
 const {data:p,error} = await db.from("stripe_products").select("owner_id,workspace_id,product_key,stripe_price_id,product_name,product_description,active").eq("public_checkout_key",key).eq("active",true).maybeSingle();
 if(error || !p) return reply({error:"This product is unavailable"},404);
 if(req.method==="GET") return reply({product:{name:p.product_name || "Digital product",description:p.product_description || "",available:true}});
 try {
  const session=await stripe.checkout.sessions.create({mode:"payment",line_items:[{price:p.stripe_price_id,quantity:1}],metadata:{owner_id:p.owner_id,workspace_id:p.workspace_id,product_key:p.product_key},success_url:base+"/checkout-success.html?session_id={CHECKOUT_SESSION_ID}",cancel_url:base+"/storefront.html?key="+encodeURIComponent(key)+"&checkout=cancelled"});
  if(!session.url) return reply({error:"Stripe did not return a checkout URL"},502);
  return reply({checkout_url:session.url});
 } catch(e) { console.error("Public checkout failed",e); return reply({error:"Unable to start checkout"},502); }
});
