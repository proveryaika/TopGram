import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;

function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => String(b % 10)).join("");
}

function formatNumber(digits: string): string {
  const country = digits.slice(0, 1);
  const rest = digits.slice(1);
  return country === "7"
    ? `+7 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8, 10)}`
    : `+1 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8, 10)}`;
}

async function telegram(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Telegram API request failed");
  return await response.json();
}

async function issueNumber(telegramUserId: number): Promise<string> {
  const { data: existing } = await supabase
    .from("virtual_numbers")
    .select("number_digits")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (existing?.number_digits) return formatNumber(existing.number_digits);

  for (let attempt = 0; attempt < 12; attempt++) {
    const country = Math.random() < 0.5 ? "7" : "1";
    const digits = country + randomDigits(10);
    const { error } = await supabase.from("virtual_numbers").insert({
      telegram_user_id: telegramUserId,
      number_digits: digits,
    });
    if (!error) return formatNumber(digits);
    if (error.code !== "23505") throw new Error("Could not issue virtual number");

    const { data: raced } = await supabase
      .from("virtual_numbers")
      .select("number_digits")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (raced?.number_digits) return formatNumber(raced.number_digits);
  }
  throw new Error("Could not allocate a unique number");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = await req.json();
    const message = update.message;
    const callback = update.callback_query;
    const chatId = message?.chat?.id ?? callback?.message?.chat?.id;
    const telegramUserId = message?.from?.id ?? callback?.from?.id;
    if (!chatId || !telegramUserId) return Response.json({ ok: true });

    if (callback) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id });
    }

    const wantsNumber =
      callback?.data === "get_number" ||
      (typeof message?.text === "string" &&
        (message.text.startsWith("/start") || message.text.startsWith("/number")));

    if (wantsNumber) {
      const number = await issueNumber(Number(telegramUserId));
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
          `Твой постоянный виртуальный номер TopGram: ${number}\n\n` +
          "Он используется только внутри TopGram. Обычные SMS и звонки на него не поступают. " +
          "Коды входа будут приходить сюда, в этот чат.",
      });
    } else if (message?.text) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "Нажми кнопку, чтобы получить постоянный виртуальный номер TopGram.",
        reply_markup: {
          inline_keyboard: [[{ text: "Получить мой номер", callback_data: "get_number" }]],
        },
      });
    }
    return Response.json({ ok: true });
  } catch (_error) {
    return Response.json({ ok: false }, { status: 500 });
  }
});
