// node test/session-format.test.js
'use strict';
const assert = require('assert');
const path = require('path');

const CREDS = { me: { id: '254704955033:12@s.whatsapp.net' }, noiseKey: { private: 'x' }, registered: true };

function fresh(env) {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}lib${path.sep}session.js`)) delete require.cache[k];
  }
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const mod = require('../lib/session');
  process.env = saved;
  return mod;
}

// 1) default output starts with Talkless! and decodes back to creds
const def = fresh({});
const out = def.toSessionString(CREDS);
assert.ok(out.startsWith('Talkless!'), `expected Talkless! prefix, got ${out.slice(0, 12)}`);
const payload = out.slice('Talkless!'.length);
const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
assert.strictEqual(decoded.me.id, CREDS.me.id, 'payload round-trips');

// 2) the prefix is fixed — no env value can drop or change it
const bare = fresh({ SESSION_PREFIX: '' });
const out2 = bare.toSessionString(CREDS);
assert.ok(out2.startsWith('Talkless!'), 'empty SESSION_PREFIX must NOT drop the prefix');
assert.strictEqual(JSON.parse(Buffer.from(out2.slice('Talkless!'.length), 'base64').toString('utf8')).me.id, CREDS.me.id);

const renamed = fresh({ SESSION_PREFIX: 'PIXEL!' });
const out3 = renamed.toSessionString(CREDS);
assert.ok(out3.startsWith('Talkless!'), 'SESSION_PREFIX=PIXEL! must be ignored');
assert.ok(!out3.startsWith('PIXEL!'), 'no foreign prefix emitted');

// 3) instructions describe the Telegram paste flow, not .env
const text = def.instructionsText();
assert.ok(text.includes('/pastsession'), 'mentions /pastsession');
assert.ok(!/\.env/.test(text), 'no .env instruction');
assert.ok(!/SESSION_ID/.test(text), 'no SESSION_ID env var instruction');
assert.ok(text.includes('TALKLESS ULTRA'), 'branded');
assert.ok(!text.includes(out), 'second message must not repeat the session string');
assert.ok(!text.includes(payload), 'second message must not repeat the Base64 payload');
assert.ok(!text.includes('Talkless!'), 'no session prefix leaked into the instructions');
assert.ok(text.includes('pair.talkless.co.ke'), 'points at the paste site');
assert.ok(text.includes('www.talkless.co.ke'), 'points at the direct-pair site');
assert.ok(/Paste Session URL|Paste Session ID/i.test(text), 'names the paste action');

// 4) nothing left over from the previous brand
const all = out + text;
assert.ok(!/pixel/i.test(all), 'no Pixel references in generated text');

console.log('ok — session format matches the Talkless bot');
