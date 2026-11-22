import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const HASH_SECRET = Deno.env.get("TOPGRAM_OTP_HASH_SECRET")!;
const AUTH_SECRET = Deno.env.get("TOPGRAM_AUTH_SECRET")!;
const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const body = await req.json();
    const digits = digitsOnly(String(body.number ?? ""));
    const code = String(body.code ?? "").trim();
    if (!/^([17])[0-9]{10}$/.test(digits) || !/^[0-9]{6}$/.test(code)) {
      return Response.json({ error: "Неверный номер или код." }, { status: 400 });
    }

    const { data: numberRow } = await admin
      .from("virtual_numbers")
      .select("id,telegram_user_id,auth_user_id")
      .eq("number_digits", digits)
      .maybeSingle();
    if (!numberRow) return Response.json({ error: "Неверный номер или код." }, { status: 400 });

    const { data: challenge } = await admin
      .from("login_challenges")
      .select("id,code_hash,expires_at,attempts")
      .eq("virtual_number_id", numberRow.id)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!challenge || new Date(challenge.expires_at).getTime() < Date.now() || challenge.attempts >= 5) {
      return Response.json({ error: "Код истёк. Запроси новый." }, { status: 400 });
    }

    const expected = await hmac(HASH_SECRET, `${digits}:${code}`);
    if (expected !== challenge.code_hash) {
      await admin.from("login_challenges")
        .update({ attempts: challenge.attempts + 1 })
        .eq("id", challenge.id);
      return Response.json({ error: "Неверный номер или код." }, { status: 400 });
    }

    await admin.from("login_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", challenge.id)
      .is("consumed_at", null);

    const email = `tg_${numberRow.telegram_user_id}@users.topgram.invalid`;
    const password = await hmac(AUTH_SECRET, `topgram-auth:${numberRow.telegram_user_id}`);
    let userId = numberRow.auth_user_id as string | null;

    if (!userId) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { telegram_user_id: numberRow.telegram_user_id },
      });
      if (createError || !created.user) {
        return Response.json({ error: "Не удалось создать аккаунт. Повтори вход." }, { status: 500 });
      }
      userId = created.user.id;
      const { error: linkError } = await admin.from("virtual_numbers")
        .update({ auth_user_id: userId })
        .eq("id", numberRow.id)
        .is("auth_user_id", null);
      if (linkError) throw linkError;
    }

    const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
    const { data: sessionData, error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError || !sessionData.session) {
      return Response.json({ error: "Не удалось войти. Попробуй ещё раз." }, { status: 500 });
    }
    return Response.json({ session: sessionData.session, user: sessionData.user });
  } catch (_error) {
    return Response.json({ error: "Внутренняя ошибка входа." }, { status: 500 });
  }
});
