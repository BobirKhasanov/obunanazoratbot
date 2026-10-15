# Chess for Telegram

A minimalist chess **Mini App** and bot. Play the computer (4 levels), a random online player, or a friend you invited from Telegram.

- **Bot** (grammY, long polling): `/start` first asks for a language (O'zbekcha, Ўзбекча, Русский, English), then sends a welcome with an **Open** button. `/lang`, `/play`, `/help`, `/admin`.
- **Mini App** (vanilla ES modules, no build step): swipe between Play, Live, Friends and Profile. Dark/light theme, four languages, emoji reactions, confetti.
- **Computer:** negamax engine running in a Web Worker (`public/js/ai*.mjs`).
- **Online games:** server-authoritative (chess.js validates every move), pushed to both players over WebSocket.
- **Friends:** *Friends → Share invite* opens Telegram's share sheet with a `t.me/<bot>?start=i<id>` link. A friend who opens it becomes your friend and can be challenged. Open games use `?start=g<id>` links.
- **Notifications:** Telegram messages (challenge, your move, draw offer, reminders) each with an **Open** button; skipped when the player is online in the app.
- **Admin panel** (Profile → Admin panel, only for `ADMIN_IDS`): live users, KPIs, sign-ups, user block/unblock, and a **post composer** (text, photo/video/GIF, up to 6 buttons with custom text and colours, language filter, test send).

## Run locally

Node.js 22.13+.

```bash
npm install
cp .env.example .env     # fill in BOT_TOKEN and WEBAPP_URL
export $(grep -v '^#' .env | xargs) && npm start
```

Mini Apps need HTTPS: tunnel the port (e.g. `cloudflared tunnel --url http://localhost:3000`) and use that URL as `WEBAPP_URL`.

## Tests

```bash
npm test            # backend (fake Telegram) + bot conversation tests
npm run test:engine # chess engine strength/sanity
```

## Deploy (Render + Cloudflare + Redis)

1. **Render** (API / WebSocket / bot): `BOT_TOKEN`, `ADMIN_IDS`, `DATABASE_URL` (**Neon pooled** URL, hostname contains `-pooler`), optional Redis + Storage env vars below. Health check: `/healthz`. One instance only (long polling).
2. **Cloudflare Worker** (`wrangler.toml`): serves `public/` and proxies `/api`, `/ws`, `/healthz` to Render. In Workers → Settings → Variables set `API_ORIGIN=https://<your-render>.onrender.com`. Set Render + BotFather `WEBAPP_URL` to the Worker URL (`https://obunanazoratbot.…workers.dev`).
3. **Upstash Redis** (optional but recommended): `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — Lichess cache, lobby/rankings cache, rate limits.
4. **Supabase Storage** (optional, media files only): create private bucket `media`, set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Render. Postgres itself lives on Neon.

## Configuration

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Token from @BotFather (required) |
| `WEBAPP_URL` | Public HTTPS URL of this server |
| `ADMIN_IDS` | Comma-separated admin Telegram IDs |
| `BOT_USERNAME` | Optional, otherwise fetched with `getMe` |
| `DATABASE_URL` | Neon Postgres pooled connection string (`-pooler`) |
| `REMIND_AFTER_HOURS` | Idle time before a "your move" reminder (default 6) |

Revoke any token that was ever pasted into a chat or committed (BotFather → `/revoke`).
