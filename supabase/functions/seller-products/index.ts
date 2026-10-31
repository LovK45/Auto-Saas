import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const url=Deno.env.get("SUPABASE_URL")??"", anon=Deno.env.get("SUPABASE_ANON_KEY")??"", service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"", base=(Deno.env.get("APP_BASE_URL")??"").replace(/\/$/,"");
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":base?new URL(base).origin:"null","access-control-allow-headers":"authorization, apikey, content-type","access-control-allow-methods":"POST, OPTIONS"}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:{"access-control-allow-origin":base?new URL(base).origin:"null","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"authorization, apikey, content-type"}});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 if(!base||req.headers.get("origin")!==new URL(base).origin)return reply({error:"Origin not allowed"},403);
 const token=(req.headers.get("authorization")??"").replace(/^Bearer /,""); if(!token)return reply({error:"Sign in required"},401);
 const auth=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:u,error:ue}=await auth.auth.getUser(token); if(ue||!u.user)return reply({error:"Valid seller sign-in required"},401);
 const body=await req.json().catch(()=>({})); const workspace=String(body.workspace_id??"");
 if(!/^[0-9a-f-]{36}$/i.test(workspace))return reply({error:"Valid workspace required"},400);
 const {data,error}=await db.from("stripe_products").select("product_key,public_checkout_key,product_name,active").eq("owner_id",u.user.id).eq("workspace_id",workspace);
 if(error)return reply({error:"Could not load seller products"},500);
 return reply({products:(data??[]).map(p=>({product_key:p.product_key,public_checkout_key:p.public_checkout_key,product_name:p.product_name,active:p.active,checkout_url:base+"/storefront.html?key="+p.public_checkout_key}))});
});
