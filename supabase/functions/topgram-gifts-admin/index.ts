import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OWNER_NUMBER = "79228093238";

const adminDb = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "Требуется вход в TopGram" }, 401);

    const authClient = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return reply({ error: "Сессия недействительна" }, 401);

    const userId = authData.user.id;
    const { data: numberRow, error: numberError } = await adminDb
      .from("virtual_numbers")
      .select("number_digits")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (numberError) throw numberError;

    const isAdmin = numberRow?.number_digits === OWNER_NUMBER;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "list");

    if (action === "list") {
      const { data: gifts, error } = await adminDb
        .from("topgram_gifts")
        .select("id,gift_key,gift_name,asset_key,price_stars,total_supply,issued_count,is_active,created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return reply({ success: true, is_admin: isAdmin, gifts: gifts || [] });
    }

    if (action !== "mint") return reply({ error: "Неизвестное действие" }, 400);
    if (!isAdmin) return reply({ error: "Доступ только владельцу TopGram" }, 403);

    const giftName = String(body.gift_name || "").trim();
    const giftKey = String(body.gift_key || "").trim().toLowerCase();
    const assetKey = String(body.asset_key || "").trim().toLowerCase();
    const price = Number(body.price_stars);
    const supply = Number(body.total_supply);

    if (!giftName || giftName.length > 60) return reply({ error: "Проверь название подарка" }, 400);
    if (!/^[a-z0-9_-]{2,64}$/.test(giftKey) || !/^[a-z0-9_-]{2,64}$/.test(assetKey)) {
      return reply({ error: "Некорректный дизайн подарка" }, 400);
    }
    if (!Number.isSafeInteger(price) || price < 1 || price > 1000000000) {
      return reply({ error: "Стоимость должна быть от 1 до 1 000 000 000 звёзд" }, 400);
    }
    if (!Number.isSafeInteger(supply) || supply < 1 || supply > 1000000) {
      return reply({ error: "Тираж должен быть от 1 до 1 000 000 экземпляров" }, 400);
    }

    const { data: gift, error: insertError } = await adminDb
      .from("topgram_gifts")
      .insert({
        gift_key: giftKey,
        gift_name: giftName,
        asset_key: assetKey,
        price_stars: price,
        total_supply: supply,
        issued_count: 0,
        is_active: true,
        created_by: userId,
      })
      .select("id,gift_key,gift_name,asset_key,price_stars,total_supply,issued_count,is_active,created_at")
      .single();
    if (insertError) throw insertError;

    return reply({ success: true, gift });
  } catch (error) {
    console.error("topgram-gifts-admin:", error);
    return reply({ error: "Не удалось обработать запрос подарков" }, 500);
  }
});