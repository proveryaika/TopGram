import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse({ error: "Нет авторизации" }, 401);

    const client = createClient(URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse({ error: "Сессия недействительна" }, 401);

    const userId = authData.user.id;
    const { data: numberRow, error: numberError } = await admin
      .from("virtual_numbers")
      .select("number_digits")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (numberError) throw numberError;
    if (!numberRow) return jsonResponse({ error: "Виртуальный номер не найден" }, 404);

    const { data: existing, error: readError } = await admin
      .from("topgram_profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (readError) throw readError;

    if (existing) {
      const { error } = await admin
        .from("topgram_profiles")
        .update({ virtual_number: numberRow.number_digits, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("topgram_profiles")
        .insert({ id: userId, virtual_number: numberRow.number_digits, phone_visible: false });
      if (error) throw error;
    }

    const { data: publicProfile, error: publicProfileError } = await admin
      .from("topgram_public_profiles")
      .select("display_number")
      .eq("id", userId)
      .maybeSingle();
    if (publicProfileError) throw publicProfileError;

    const { data: wallet, error: walletError } = await admin
      .from("topgram_wallets")
      .select("stars")
      .eq("user_id", userId)
      .maybeSingle();
    if (walletError) throw walletError;

    return jsonResponse({
      success: true,
      display_number: publicProfile?.display_number ?? null,
      wallet_stars: wallet?.stars ?? 0,
    });
  } catch {
    return jsonResponse({ error: "Не удалось сохранить профиль" }, 500);
  }
});
