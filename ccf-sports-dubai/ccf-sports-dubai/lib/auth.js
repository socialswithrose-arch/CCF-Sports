"use strict";
const crypto = require("crypto");
const Logic = require("../public/logic.js");

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw Object.assign(new Error("SESSION_SECRET is not set"), { status: 503 });
  return s;
}

function hmac(text) { return crypto.createHmac("sha256", secret()).update(text).digest(); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* Leader sign-in tokens: valid for 60 days. */
function leaderToken(name, role) {
  const body = Buffer.from(JSON.stringify({ n: name, r: role === "volunteer" ? "volunteer" : "leader", exp: Date.now() + 60 * 864e5 })).toString("base64url");
  return body + "." + hmac("leader:" + body).toString("base64url");
}
function readLeaderToken(tok) {
  if (!tok || typeof tok !== "string" || !tok.includes(".")) return null;
  const [body, sig] = tok.split(".");
  if (!safeEqual(sig, hmac("leader:" + body).toString("base64url"))) return null;
  try {
    const o = JSON.parse(Buffer.from(body, "base64url").toString());
    return o.exp > Date.now() ? { name: o.n, role: o.r === "volunteer" ? "volunteer" : "leader" } : null;
  } catch (e) { return null; }
}
/* Returns "leader", "volunteer" or null. */
function checkPassword(pw) {
  const real = process.env.LEADER_PASSWORD;
  if (!real) throw Object.assign(new Error("LEADER_PASSWORD is not set"), { status: 503 });
  if (safeEqual(pw || "", real)) return "leader";
  const vol = process.env.VOLUNTEER_PASSWORD;
  if (vol && safeEqual(pw || "", vol)) return "volunteer";
  return null;
}

/* The check-in code for one game day, shown as a QR on a leader's screen. */
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function sessionCode(date) {
  const b = hmac("session:" + date);
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPH[b[i] % ALPH.length];
  return s;
}
function sessionCodes() {
  const t = Logic.today(), out = {};
  for (let i = -1; i <= 14; i++) { const d = Logic.addDays(t, i); out[d] = sessionCode(d); }
  return out;
}
function validSession(code, date) {
  return !!code && !!date && safeEqual(String(code).toUpperCase(), sessionCode(date));
}

function randomToken() { return crypto.randomBytes(24).toString("hex"); }
function randomId() { return crypto.randomBytes(9).toString("base64url"); }

module.exports = { leaderToken, readLeaderToken, checkPassword, sessionCode, sessionCodes, validSession, randomToken, randomId, safeEqual };
