import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const HASH_SECRET = Deno.env.get("TOPGRAM_OTP_HASH_SECRET")!;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function formatNumber(digits: string): string {
  const country = digits.slice(0, 1);
  const rest = digits.slice(1);
  return country === "7"
    ? `+7 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8, 10)}`
    : `+1 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8, 10)}`;
}

async function hashCode(number: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(HASH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${number}:${code}`));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  try {
    const body = await req.json();
    const digits = digitsOnly(String(body.number ?? ""));
    if (!/^([17])[0-9]{10}$/.test(digits)) {
      return Response.json({ ok: true, message: "Если номер зарегистрирован, код будет отправлен в Telegram." }, { headers: corsHeaders });
    }

    const { data: numberRow } = await supabase
      .from("virtual_numbers")
      .select("id,telegram_user_id")
      .eq("number_digits", digits)
      .maybeSingle();

    // Use the same public response whether the number exists or not.
    if (!numberRow) {
      return Response.json({ ok: true, message: "Если номер зарегистрирован, код будет отправлен в Telegram." }, { headers: corsHeaders });
    }

    const { data: recent } = await supabase
      .from("login_challenges")
      .select("created_at")
      .eq("virtual_number_id", numberRow.id)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000) {
      return Response.json({ ok: true, message: "Если номер зарегистрирован, код будет отправлен в Telegram." }, { headers: corsHeaders });
    }

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const codeHash = await hashCode(digits, code);
    const { error: insertError } = await supabase.from("login_challenges").insert({
      virtual_number_id: numberRow.id,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (insertError) throw insertError;

    const sent = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: numberRow.telegram_user_id,
        text: `Код входа в TopGram: ${code}\n\nДействует 5 минут. Никому его не сообщай.`,
      }),
    });
    if (!sent.ok) throw new Error("Telegram delivery failed");

    return Response.json({ ok: true, message: "Если номер зарегистрирован, код будет отправлен в Telegram." }, { headers: corsHeaders });
  } catch (_error) {
    return Response.json({ ok: false, message: "Не удалось отправить код. Попробуй позже." }, { status: 500, headers: corsHeaders });
  }
});
