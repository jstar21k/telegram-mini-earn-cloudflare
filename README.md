# Telegram Mini Earn Cloudflare

A Cloudflare-only Telegram Mini App earning platform.

This project uses:

- Frontend: static HTML/CSS/JS with Telegram Mini App SDK
- Backend: FastAPI on Cloudflare Python Workers
- Database: Cloudflare D1
- Bot: Telegram webhook endpoint using Telegram Bot API HTTP calls

MongoDB Atlas, Railway, and a VPS are not required for this Cloudflare-only version.

## Project Structure

```text
frontend/
  index.html
  styles.css
  app.js
worker/
  main.py
  requirements.txt
migrations/
  0001_initial.sql
wrangler.toml
pyproject.toml
package.json
.env.example
```

## Current Cloudflare Dashboard Step

If you are on the Cloudflare welcome/build screen, choose **Skip** for now. This repo is set up for Wrangler CLI deployment, which is faster and reproducible.

## Local Setup

Install prerequisites:

```bash
npm install
```

For Python Workers, Cloudflare currently uses PyWrangler:

```bash
uv sync
```

## Create D1

Create the D1 database:

```bash
npm run d1:create
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "telegram-mini-earn-db"
database_id = "paste-real-database-id-here"
```

Apply migrations locally:

```bash
npm run d1:migrate:local
```

Apply migrations remotely:

```bash
npm run d1:migrate:remote
```

## Worker Development

Run the API locally:

```bash
npm run worker:dev
```

Deploy the Worker:

```bash
npm run worker:deploy
```

After deploy, update `frontend/index.html`:

```js
window.APP_CONFIG = {
  API_BASE: "https://your-worker-url.workers.dev",
  DEMO_AD_CALLBACKS: true,
};
```

Set `DEMO_AD_CALLBACKS` to `false` after real ad network callbacks are configured.

If `API_BASE` still contains `YOUR_SUBDOMAIN`, the frontend runs in offline demo mode so you can preview the Mini App without a deployed Worker.

## Pages Deployment

Deploy the static Mini App frontend:

```bash
npm run pages:deploy
```

After deployment, set the Pages URL in the Worker:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ADMIN_TG_ID
npx wrangler secret put JWT_SECRET
```

Then update `MINI_APP_URL` in `wrangler.toml` or set it as a secret/variable in Cloudflare.

## Telegram Setup

Set the webhook after the Worker is deployed:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-worker-url.workers.dev/telegram/webhook"
```

In BotFather:

1. Open your bot.
2. Configure the Mini App / Web App button.
3. Set the URL to your Cloudflare Pages URL.

## Ad Network Setup

Frontend ad buttons generate a single-use token using `/api/ad-token`.

Configure postbacks:

- Adsgram: `https://your-worker-url.workers.dev/api/adsgram-callback`
- Monetag: `https://your-worker-url.workers.dev/api/monetag-callback?token={SUBID}`

Optional verification secrets are supported:

- `ADSGRAM_WEBHOOK_SECRET`
- `MONETAG_POSTBACK_SECRET`

If these are empty, callbacks run in development/demo mode.

## API Summary

- `POST /api/register`
- `GET /api/user/{tg_id}`
- `POST /api/ad-token`
- `POST /api/reward`
- `POST /api/adsgram-callback`
- `POST /api/monetag-callback`
- `GET /api/tasks`
- `POST /api/tasks/{task_id}/verify`
- `POST /api/withdraw`
- `GET /api/withdrawals/{tg_id}`
- `GET /api/leaderboard`
- `POST /telegram/webhook`

## Notes

- Money is stored as paise integers in D1 and returned as rupees in API responses.
- New users receive a ₹25 welcome bonus.
- Ad rewards pay ₹5 per completed ad.
- Referral rewards unlock only after the referred user earns ₹50 from ad rewards.
- Withdrawals are deducted immediately, stored as pending, and sent to the Telegram admin with Approve/Reject buttons.
- Admins can use `/admin_withdrawals` in the bot to list pending payouts.
- The frontend ships with demo ad callbacks enabled so the reward flow can be tested before real ad network credentials exist.
- Task verification uses Telegram `getChatMember`; keep the bot as admin/member in every task channel.
