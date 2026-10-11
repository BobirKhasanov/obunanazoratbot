# obunanazoratbot

Telegram bot + Mini App to track **expenses**, **subscriptions**, a **calendar** of both, and **renewal reminders**. Minimal dark UI with swipeable pages, a floating nav and a built-in **admin panel**.

- **Bot:** grammY (long polling). `/start` opens the app, `/admin` gives admins a quick summary.
- **Mini App:** vanilla JS, no build step. Swipe left/right between Home, Expenses, Subs, Calendar, Profile.
- **API:** Express + SQLite (Node's built-in `node:sqlite`, no native modules). Every request is verified against Telegram's signed `initData`.
- **Reminders:** a daily job sends a Telegram message N days before each renewal (N is set per user with the slider in Profile).
- **Admin panel:** Profile → *Admin panel*, visible only to IDs in `ADMIN_IDS` (stats, sign-ups chart, user search, block/unblock, broadcast). Non-admins get a 404 from every admin endpoint.

## Run locally

Requires Node.js 22.13+.

```bash
npm install
cp .env.example .env     # fill in BOT_TOKEN and WEBAPP_URL
export $(grep -v '^#' .env | xargs) && npm start
```

Telegram only opens Mini Apps over **HTTPS**. For local testing, expose the port with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and put that URL in `WEBAPP_URL`.

## Deploy

Any host that runs a Node process or a Docker container works (Railway, Render, Fly.io, a VPS).

1. Set the environment variables from `.env.example` (`BOT_TOKEN`, `WEBAPP_URL`, `ADMIN_IDS`).
2. **Mount a persistent volume at `/app/data`**, otherwise the SQLite database is wiped on each deploy.
3. Run a **single instance** (long polling and the SQLite file don't support multiple replicas).

```bash
docker build -t obunanazoratbot .
docker run -d -p 3000:3000 -v obuna-data:/app/data --env-file .env obunanazoratbot
```

On start the bot registers the menu button, so users can open the app from the chat's *Open* button.

## Configuration

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Token from @BotFather (required) |
| `WEBAPP_URL` | Public HTTPS URL of this server |
| `ADMIN_IDS` | Comma-separated Telegram IDs allowed into the admin panel |
| `DB_PATH` | SQLite file path (default `./data/app.db`) |
| `REMINDER_HOUR` | Local hour when daily reminders go out (default `9`) |
| `TZ` | Time zone for "today" and reminders (default `Europe/Riga`) |

## Tests

```bash
npm test
```

Boots the server with a throwaway database and checks auth (forged/stale/tampered `initData`), validation, per-user data isolation, subscription date rolling, admin gating and blocking.

## Security notes

- **Never commit the bot token.** It lives only in the environment. If a token was ever pasted in a chat or committed, revoke it in @BotFather (`/revoke`) and use the new one.
- Admin rights come only from `ADMIN_IDS` and are checked on the server for every admin request.
- All user-provided text is rendered with `textContent`, and a strict Content-Security-Policy is set.
