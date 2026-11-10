"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BOT_NAME = process.env.BOT_NAME || "TALKLESS ULTRA";

/**
 * Prefix prepended to the Base64 creds — every session this service emits
 * starts with `Talkless`. Fixed, no env override, so no other brand can be
 * stamped on an outgoing session.
 *
 * The bot matches it case-insensitively (/^talkless!?/i), so `Talkless!`,
 * `TALKLESS!` and `talkless!` all parse. The `!` matters: without it the string
 * no longer looks like a prefixed payload and is rejected as bad Base64.
 */
const SESSION_PREFIX = "Talkless!";
const SESSION_ROOT = path.join(__dirname, "..", "routes", "session");

/** Random per-attempt folder name so two users never collide. */
function newId() {
  return crypto.randomBytes(8).toString("hex");
}

function sessionDir(id) {
  return path.join(SESSION_ROOT, id);
}

async function cleanUp(id) {
  try {
    await fs.promises.rm(sessionDir(id), { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}

/**
 * Poll for creds.json. Baileys writes it on the creds.update event, which can
 * land a few seconds after "connection open", and the file can be read while
 * still being written — so require a stable, parseable payload.
 */
async function waitForCreds(id, { attempts = 20, gapMs = 3000 } = {}) {
  const file = path.join(sessionDir(id), "creds.json");
  for (let i = 0; i < attempts; i++) {
    try {
      const raw = await fs.promises.readFile(file, "utf8");
      if (raw && raw.length > 100) {
        const creds = JSON.parse(raw);
        if (creds && creds.me && creds.me.id) return creds;
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return null;
}

/**
 * `TALKLESS!` + Base64 of creds.json.
 *
 * Talkless (helper/sessionId.js) strips code fences and any "<brand>!" token,
 * then Base64-decodes and JSON-parses. Bare Base64 parses too, so the prefix is
 * cosmetic — it just tells the user which bot the string belongs to.
 */
function toSessionString(creds) {
  return SESSION_PREFIX + Buffer.from(JSON.stringify(creds), "utf8").toString("base64");
}


/**
 * 8 characters, A-Z 0-9 — the same shape WhatsApp issues. Passing our own code
 * matches how the Elite generator calls requestPairingCode and removes any
 * dependency on the library's code generator.
 */
function generatePairingCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const bytes = require("crypto").randomBytes(8);
  for (let i = 0; i < 8; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/**
 * Second message. Deliberately does NOT repeat the session string: the string
 * was sent as its own message immediately before this one, and echoing it again
 * doubles the chance of it ending up in a screenshot or a forwarded chat.
 */
function instructionsText() {
  return (
    `✅ *SESSION READY — ${BOT_NAME}*\n\n` +
    `Your session ID is the message right above this one. ` +
    `Copy that whole line exactly as it is — it is not repeated here on purpose.\n\n` +
    `*Where to paste it*\n` +
    `• https://pair.talkless.co.ke — open it, tap *Paste Session ID*, paste the line.\n` +
    `• https://www.talkless.co.ke — pair direct, no session string needed.\n\n` +
    `*Or send it to the Telegram bot*\n` +
    `1. Send /pastsession — or tap 💾 𝑷𝑨𝑺𝑻𝑬 𝑺𝑬𝑺𝑺𝑰𝑶𝑵 𝑰𝑫\n` +
    `2. Paste the line as your next message\n\n` +
    `⚠️ Anyone holding that string can drive your WhatsApp account. ` +
    `Never share it, never commit it, and regenerate it if it leaks.`
  );
}



/** Warning captured here so it's impossible to ship the old auto-join. */
function consentNote() {
  return (
    `This generator does not join you to any group or channel. ` +
    `It only links the device you approve and hands the session back to you.`
  );
}

module.exports = {
  BOT_NAME,
  SESSION_PREFIX,
  generatePairingCode,
  SESSION_ROOT,
  newId,
  sessionDir,
  cleanUp,
  waitForCreds,
  toSessionString,
  instructionsText,
  consentNote,
};
