import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return reply({ error: "Sign-in required" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return reply({ error: "Invalid session" }, 401);
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return reply({ error: "AI provider is not configured by the workspace operator" }, 503);
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return reply({ error: "Invalid JSON body" }, 400); }
  const offer = String(input.offer ?? "").trim().slice(0, 500);
  const audience = String(input.audience ?? "").trim().slice(0, 300);
  const format = String(input.format ?? "social").slice(0, 40);
  const goal = String(input.goal ?? "Build awareness").slice(0, 120);
  const tone = String(input.tone ?? "Clear and helpful").slice(0, 120);
  if (!offer) return reply({ error: "Offer or topic is required" }, 400);
  const prompt = "Create useful, specific marketing content. Do not invent customer testimonials, results, guarantees, scarcity, or factual claims. Clearly mark any facts the user must verify.\nOffer: " + offer + "\nAudience: " + audience + "\nGoal: " + goal + "\nTone: " + tone + "\nFormat: " + format;
  const upstream = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini", input: prompt, max_output_tokens: 1800 }) });
  const data = await upstream.json();
  if (!upstream.ok) return reply({ error: data.error?.message ?? "AI provider request failed" }, upstream.status);
  const text = (data.output ?? []).flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("\n");
  if (!text) return reply({ error: "AI provider returned no text" }, 502);
  return reply({ text });
});
