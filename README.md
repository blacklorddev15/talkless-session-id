# TALKLESS ULTRA — Session Generator

Landing page that pairs a WhatsApp number and hands back a session ID in the
exact shape the **Talkless** telegram bot accepts. Country picker with 195 dial
codes, an 8-character pairing code, a QR fallback, live pairing status.

Branded for TALKLESS ULTRA: the bot artwork is the hero, and the same image is
used blurred and dimmed as the page background (`public/img/talkless.jpg`).

## What the bot accepts

Every session this service emits starts with **`TALKLESS!`** — hardcoded, not
configurable, so no other brand can be stamped on an outgoing session. The bot
enforces the same rule on the way in:

| Paste | Result |
|---|---|
| `TALKLESS!eyJub2lz…` | accepted — the only accepted prefix |
| `eyJub2lz…` | accepted (bare Base64) |
| `{"creds":{…}}` or a raw `creds.json` | accepted |
| ```` ```json\n TALKLESS!eyJ… \n``` ```` | accepted (fences stripped) |
| `Pixel!` / `Blacklord!` / `Varnox!` / `Astro!` | **rejected** — "only TALKLESS! sessions are accepted" |
| any other `<word>!` | **rejected** — unknown prefix |

The prefix is cosmetic for decoding but it is a hard gate: the bot will not
import a session wearing another product's name.

Only `creds.me.id` is mandatory for the bot; missing `noiseKey` /
`signedIdentityKey` / `signedPreKey` / `advSecretKey` / `registered` is reported
as a warning and the import still runs.

## How it behaves

1. User enters a number → `GET /code?number=…` returns the 8-char code instantly.
2. They enter it in **WhatsApp → Linked devices → Link with phone number**.
3. On `connection open` the app waits for a complete `creds.json`, base64-encodes
   it, and **DMs it to that same account** ("Message yourself") as two messages:
   the one-line session ID, then the paste instructions.
4. The socket is closed and `routes/session/<id>/` is deleted. Nothing persists.

The session is never returned over HTTP — only to the account that paired.

## Wiring it to the bot

The DM tells the user to send the string to the Talkless bot with `/pastsession`
(or the 💾 **𝑷𝑨𝑺𝑻𝑬 𝑺𝑬𝑺𝑺𝑰𝑶𝑵 𝑰𝑫** keyboard button). The bot then writes
`sessions/wa_<telegramId>_<phone>/creds.json` and connects immediately — no QR,
no second pairing code, no `.env` editing.

Talkless is a multi-session Telegram host, so there is no `SESSION_ID` env var:
the session belongs to whoever pastes it, keyed by their Telegram id.

## Rebuilt from `EliteProTech/ELITEPRO-SESSION-ID`

Three changes that matter:

1. **Format matches the bot.** Output is `TALKLESS!` + plain Base64 of
   `creds.json`, which the bot's parser handles without special-casing.
2. **No side effects on the paired account.** The original calls
   `groupAcceptInvite("Jx5g9WIAzFe4BPB3tXLzCU")` on every successful pairing,
   force-adding the user to the author's group, plus a `newsletterFollow(...)`.
   Both are removed here. Nothing is joined, nothing is followed.
3. **Built for Render's free plan.** Respects `PORT`, starts with plain
   `node index.js` (no pm2), and the page pings `/keepalive` while a pairing is
   in flight so the service isn't spun down mid-handoff.

**Baileys: `@whiskeysockets/baileys@6.7.24` only.** This is the build that
reliably issues a code and completes the link. No resolver, no fallback — a
second build on disk is how you get a code that is issued but never finishes.
The `creds.json` it writes is plain JSON and loads fine on the bot's 7.x fork.

Three things in `routes/pair.js` exist purely to stop "stuck on login":

1. **`connection.update` is attached before the code is requested.** Otherwise a
   socket that closes while the code is in flight is never reported, and the page
   waits forever on a dead socket.
2. **2 s delay + an explicit 8-character code.** `requestPairingCode` throws
   `Connection Closed` on 6.7.24 if it is called before the websocket settles.
3. **5-minute watchdog + one re-issue.** A pairing code dies with its socket, so
   if WhatsApp drops the connection before approval the server issues a fresh code
   and pushes it to the page through `/status`.

---

## Deploy on Render

### Blueprint (one click)

1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → pick the repo. `render.yaml` is read
   automatically: free plan, `node index.js`, health check `/healthz`.

### Manual

Render → **New → Web Service** → connect the repo, then:

```
Runtime         Node
Build Command   npm install --omit=dev
Start Command   node index.js
Instance Type   Free
Health Check    /healthz
```

Add env vars if you want to override the defaults:

| Variable | Default | Meaning |
|----------|---------|---------|
| `BOT_NAME` | `TALKLESS ULTRA` | Shown on the page and in the DM |
| `MAX_ACTIVE` | `4` | Concurrent pairing sockets (free 512 MB dies above ~5) |
| `PER_IP` | `3` | Pairing attempts per IP |
| `WINDOW_MS` | `600000` | Rate-limit window (10 min) |
| `NODE_VERSION` | `20.18.1` | Baileys 6.7.24 targets Node 20 |
| `LINK_TIMEOUT_MS` | `300000` | How long a code stays usable |
| `MAX_CODE_RETRIES` | `2` | Re-issues after a dropped socket |

## Free-plan limits you should expect

- Spins down after **15 minutes** with no inbound traffic; cold start ≈ 1 min.
  While a pairing is open the page's `/keepalive` ping keeps it warm.
- Ephemeral disk — fine here, since the session folder lives for under two
  minutes and is deleted either way.
- **750 instance hours/month** per workspace. One always-warm service is ~744 h,
  so a second free service would eat into the same allowance.
- A spin-down or restart **during** a pairing loses that attempt; the user just
  retries.

## Page behaviour

- Country list is fetched from `public/countries.json` (195 entries, searchable by
  name or dial code). The prefix box stays editable for numbers typed manually.
- `+1`, `+7` and `+39` appear twice (US/Canada, Kazakhstan/Russia, Italy/Vatican
  City) — the picker shows each country separately and both dial the same digits.
- While a pairing is in flight the page polls `/status` every 3 s and pings
  `/keepalive` every 20 s, so the handoff survives Render's idle spin-down.
- The session is never rendered in the browser; the page only says whether it was
  delivered.

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET /` | UI |
| `GET /code?number=2547…` | `{ ok, code, id }` — 8-char pairing code |
| `GET /qr` | `{ ok, qr }` — data-URL QR |
| `GET /status?id=…` | `started` → `waiting` → `paired` → `delivered` / `failed`, plus the current code |
| `GET /keepalive` | Warm-up ping, also reports active sockets |
| `GET /healthz` | Bot name, resolved Baileys build, uptime |

## Security notes

- Whoever holds the session ID controls that WhatsApp account — treat it like a
  password. The DM goes to the account owner only; the page never displays it.
- While pairing, `creds.json` exists briefly on the server's disk under
  `routes/session/<random-id>/`. It is removed on every exit path, including errors.
- If you make this public, keep the rate limit on. It stops one IP from opening
  dozens of sockets and knocking a 512 MB instance over.

## Local run

```bash
npm install
node index.js          # http://localhost:5000
```
