# TopGram: permanent virtual numbers + Telegram login

Virtual numbers are app-only identifiers formatted like phone numbers. They are NOT real phone lines and cannot receive ordinary calls or SMS.

## Edge Function secrets

Set these in Supabase Dashboard → Edge Functions → Secrets:

- TELEGRAM_BOT_TOKEN — bot token (never put it in the website or GitHub).
- TELEGRAM_WEBHOOK_SECRET — random secret string used to verify Telegram webhook requests.
- TOPGRAM_OTP_HASH_SECRET — long random secret used to hash one-time codes.
- TOPGRAM_AUTH_SECRET — a different long random secret used to derive the private Supabase Auth password.
- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — Supabase project values (the platform normally provides these automatically).

Do not share any of these secrets in chat or commit them to GitHub.

## Deploy order

1. Run `migrations/202611220001_virtual_numbers.sql` in Supabase SQL Editor.
2. Deploy Edge Functions `telegram-bot`, `request-login-code`, and `verify-login-code`.
3. Configure Telegram webhook to:
   `https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot`
   using Telegram's `setWebhook` API and set `secret_token` to the same TELEGRAM_WEBHOOK_SECRET.
4. In Telegram, open the bot and press Start. The bot's button issues one permanent number.
5. Connect the TopGram login screen to request-login-code and verify-login-code.

## Security notes

- The service-role key is used only inside Edge Functions.
- OTPs expire after 5 minutes, can be attempted at most 5 times, and resend is throttled to once per minute per number.
- A virtual number is uniquely linked to one Telegram user and is never reassigned.
- Before public launch, add IP/device-level rate limiting and monitoring. The basic per-number cooldown is not a complete anti-abuse system.
