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
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
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
    const { data: numberRow, error: numberError } = await adminDb.from("virtual_numbers")
      .select("number_digits").eq("auth_user_id", userId).maybeSingle();
    if (numberError) throw numberError;
    const isAdmin = numberRow?.number_digits === OWNER_NUMBER;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "list");

    if (action === "save_username") {
      const raw = body.username == null ? "" : String(body.username).trim().replace(/^@/, "").toLowerCase();
      if (raw && !/^[a-z0-9_]{5,24}$/.test(raw)) return reply({ error: "Юзернейм должен содержать 5–24 символа: латиница, цифры и _" }, 400);
      const { error } = await adminDb.from("topgram_usernames").upsert({
        user_id: userId, username: raw || null, updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (error) return reply({ error: error.code === "23505" ? "Этот юзернейм уже занят" : error.message }, 400);
      return reply({ success: true, username: raw });
    }
    if (action === "grant_stars") {
      if (!isAdmin) return reply({ error: "Доступ только владельцу TopGram" }, 403);
      const username = String(body.username || "").trim().replace(/^@/, "").toLowerCase();
      const amount = Number(body.amount);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) return reply({ error: "Укажи количество от 1 до 1 000 000 000 ⭐" }, 400);
      const { data, error } = await adminDb.rpc("topgram_admin_grant_stars", { p_admin_id: userId, p_username: username, p_amount: amount });
      if (error) return reply({ error: error.message || "Не удалось выдать звёзды" }, 400);
      return reply({ success: true, result: data });
    }
    if (action === "assign_collectible_username") {
      if (!isAdmin) return reply({ error: "Доступ только владельцу TopGram" }, 403);
      const username = String(body.username || "").trim().replace(/^@/, "").toLowerCase();
      const collectible = String(body.collectible_username || "").trim().replace(/^@/, "").toLowerCase();
      const { data, error } = await adminDb.rpc("topgram_admin_assign_collectible_username", {
        p_admin_id: userId, p_username: username, p_collectible_username: collectible
      });
      if (error) return reply({ error: error.message || "Не удалось назначить коллекционный юзернейм" }, 400);
      return reply({ success: true, result: data });
    }
    if (action === "stats") {
      if (!isAdmin) return reply({ error: "Доступ только владельцу TopGram" }, 403);
      const { data, error } = await adminDb.rpc("topgram_admin_stats", { p_admin_id: userId });
      if (error) return reply({ error: error.message || "Не удалось загрузить статистику" }, 400);
      return reply({ success: true, stats: data });
    }
    if (action === "list") {
      const { data: gifts, error } = await adminDb.from("topgram_gifts")
        .select("id,gift_key,gift_name,asset_key,price_stars,total_supply,issued_count,is_active,created_at")
        .eq("is_active", true).order("created_at", { ascending: false });
      if (error) throw error;
      const { data: usernameRow, error: usernameError } = await adminDb.from("topgram_usernames")
        .select("username,collectible_username").eq("user_id", userId).maybeSingle();
      if (usernameError) throw usernameError;
      return reply({ success: true, is_admin: isAdmin, gifts: gifts || [],
        username: usernameRow?.username ?? null, collectible_username: usernameRow?.collectible_username ?? null });
    }
    if (action === "inventory") {
      const { data: inventory, error } = await adminDb.from("topgram_gift_inventory")
        .select("id,attributes,acquired_at,updated_at,gift:topgram_gifts(id,gift_name,asset_key,gift_key,price_stars)")
        .eq("user_id", userId).order("acquired_at", { ascending: false });
      if (error) throw error;
      const { data: wallet, error: walletError } = await adminDb.from("topgram_wallets")
        .select("stars").eq("user_id", userId).maybeSingle();
      if (walletError) throw walletError;
      return reply({ success: true, inventory: inventory || [], stars: wallet?.stars ?? 0 });
    }
    if (action === "buy") {
      const giftId = String(body.gift_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(giftId))
        return reply({ error: "Некорректный подарок" }, 400);
      const { data, error } = await adminDb.rpc("topgram_purchase_gift", { p_user_id: userId, p_gift_id: giftId });
      if (error) return reply({ error: error.message || "Покупка не выполнена" }, 400);
      return reply({ success: true, purchase: data });
    }
    if (action === "upgrade_bundle") {
      const inventoryId = String(body.inventory_id || "");
      const attributes = body.attributes;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inventoryId))
        return reply({ error: "Подарок не найден" }, 400);
      const { data, error } = await adminDb.rpc("topgram_upgrade_gift_bundle", {
        p_user_id: userId, p_inventory_id: inventoryId, p_attributes: attributes
      });
      if (error) return reply({ error: error.message || "Улучшение не выполнено" }, 400);
      return reply({ success: true, upgrade: data });
    }
    if (action === "upgrade") {
      const inventoryId = String(body.inventory_id || "");
      const attribute = String(body.attribute || "");
      const value = String(body.value || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inventoryId))
        return reply({ error: "Подарок не найден" }, 400);
      const { data, error } = await adminDb.rpc("topgram_upgrade_gift", {
        p_user_id: userId, p_inventory_id: inventoryId, p_attribute: attribute, p_value: value
      });
      if (error) return reply({ error: error.message || "Улучшение не выполнено" }, 400);
      return reply({ success: true, upgrade: data });
    }
    if (action !== "mint") return reply({ error: "Неизвестное действие" }, 400);
    if (!isAdmin) return reply({ error: "Доступ только владельцу TopGram" }, 403);

    const giftName = String(body.gift_name || "").trim();
    const giftKey = String(body.gift_key || "").trim().toLowerCase();
    const assetKey = String(body.asset_key || "").trim().toLowerCase();
    const price = Number(body.price_stars);
    const supply = Number(body.total_supply);
    if (!giftName || giftName.length > 60) return reply({ error: "Проверь название подарка" }, 400);
    if (!/^[a-z0-9_-]{2,64}$/.test(giftKey) || !/^[a-z0-9_-]{2,64}$/.test(assetKey))
      return reply({ error: "Некорректный дизайн подарка" }, 400);
    if (!Number.isSafeInteger(price) || price < 1 || price > 1000000000)
      return reply({ error: "Стоимость должна быть от 1 до 1 000 000 000 звёзд" }, 400);
    if (!Number.isSafeInteger(supply) || supply < 1 || supply > 1000000)
      return reply({ error: "Тираж должен быть от 1 до 1 000 000 экземпляров" }, 400);
    const { data: gift, error: insertError } = await adminDb.from("topgram_gifts").insert({
      gift_key: giftKey, gift_name: giftName, asset_key: assetKey, price_stars: price,
      total_supply: supply, issued_count: 0, is_active: true, created_by: userId
    }).select("id,gift_key,gift_name,asset_key,price_stars,total_supply,issued_count,is_active,created_at").single();
    if (insertError) throw insertError;
    return reply({ success: true, gift });
  } catch (error) {
    console.error("topgram-gifts-admin:", error);
    return reply({ error: "Не удалось обработать запрос подарков" }, 500);
  }
});