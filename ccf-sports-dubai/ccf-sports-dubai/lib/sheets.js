"use strict";
/* Google Sheets CRM sync. Needs GOOGLE_SERVICE_ACCOUNT_JSON and SHEET_ID.
   Without them every function quietly does nothing. */
const crypto = require("crypto");
const Logic = require("../public/logic.js");

let cached = null; // { token, exp }

function enabled() { return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.SHEET_ID); }

async function accessToken() {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + sig })
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google sign-in failed: " + (j.error_description || j.error || r.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function call(method, path, body) {
  const tok = await accessToken();
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + process.env.SHEET_ID + path;
  const r = await fetch(url, { method, headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error("Google Sheets " + r.status + ": " + (await r.text()).slice(0, 300));
  return r.json();
}
const rng = (a1) => encodeURIComponent(a1);
const clear = (a1) => call("POST", "/values/" + rng(a1) + ":clear", {});
const append = (a1, rows) => rows.length ? call("POST", "/values/" + rng(a1) + ":append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE", { values: rows }) : null;
const update = (a1, rows) => call("PUT", "/values/" + rng(a1) + "?valueInputOption=USER_ENTERED", { values: rows });

/* Keep text as text: values starting with = + - @ would be read as formulas. */
function txt(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
const yn = (b) => (b ? "Yes" : "No");

function playerRow(p, visits, dgroups, t, rsvps, myCheckins) {
  const g = dgroups.find((d) => d.id === p.dgroupId);
  const recent = visits.filter((v) => Logic.daysBetween(v, t) <= 56).length;
  const sd = p.stageDates || {};
  return [
    Logic.codeLabel(p), txt(p.firstName), txt(p.lastName), txt(p.phone), txt(p.email), txt(p.location), txt(p.lifeStage),
    txt(p.invitedBy), txt(p.wantsConnect), yn(p.contactOk), p.firstVisit || "", visits[visits.length - 1] || "",
    visits.length, recent, Logic.ATT[Logic.attendanceOf(visits, t)].label, yn(p.followedUp),
    Logic.outreachLabel(Logic.outreachOf(p)), p.dgOutreachDate || "", txt(g ? g.name : ""), p.dgroupDate || "",
    txt(Logic.facilitatorOf(p) || "Unassigned"), Logic.stageLabel(p.stage), sd.received || "", sd.baptized || "",
    Logic.nextAction(p, visits, dgroups, t, rsvps), txt(p.notes),
    p.volunteer ? "Volunteer" : txt(p.churchStatus || ""),
    txt(p.satellite || ""),
    Logic.playedAtText(myCheckins || [], p.satellite),
    txt(p.dgroupId ? Logic.dgroupLeaderOf(p, dgroups) : "")
  ];
}
function checkinRow(c, p) { return [c.date, Logic.codeLabel(p || {}), txt((p ? Logic.fullName(p) : "") + (c.role === "volunteer" ? " (volunteer)" : "")), yn(c.firstTime)]; }

/* Add rows straight away when something happens. Errors are logged, never thrown. */
async function appendCheckins(items) {
  if (!enabled() || !items.length) return;
  try { await append("'Check-ins'!A1:D", items.map((x) => checkinRow(x.checkin, x.player))); }
  catch (e) { console.error("sheet append check-in", e.message); }
}
async function appendPlayers(players, dgroups) {
  if (!enabled() || !players.length) return;
  try { const t = Logic.today(); await append("'Player Report'!A1:AD", players.map((p) => playerRow(p, [], dgroups || [], t))); }
  catch (e) { console.error("sheet append player", e.message); }
}

/* Rebuild the Player Report, Check-ins and Leaders tabs from the database. */
async function rebuild(data) {
  if (!enabled()) return { skipped: "Google Sheet not connected" };
  const t = Logic.today();
  const { players, checkins, dgroups, settings } = data;
  const vbp = Logic.visitsByPlayer(checkins), rbp = Logic.rsvpsByPlayer(data.rsvps || []);
  const pById = new Map(players.map((p) => [p.id, p]));
  const prows = players
    .map((p) => ({ p, v: vbp.get(p.id) || [] }))
    .sort((a, b) => (b.v[b.v.length - 1] || "").localeCompare(a.v[a.v.length - 1] || ""))
    .map(({ p, v }) => playerRow(p, v, dgroups, t, rbp.get(p.id) || [], checkins.filter((c) => c.playerId === p.id)));
  const crows = checkins.slice().sort((a, b) => b.date.localeCompare(a.date)).map((c) => checkinRow(c, pById.get(c.playerId)));
  const names = new Set();
  ((settings && settings.leaders) || []).forEach((n) => n && names.add(n));
  dgroups.forEach((g) => g.leader && names.add(g.leader));
  players.forEach((p) => { if (p.volunteer) { const n = [p.firstName, p.lastName].filter(Boolean).join(" ").trim(); if (n) names.add(n); } });
  players.forEach((p) => { const f = Logic.facilitatorOf(p); if (f) names.add(f); });
  const lrows = [["Unassigned"]].concat([...names].sort((a, b) => a.localeCompare(b)).map((n) => [txt(n)]));

  // headers for the renamed and new columns
  await update("'Player Report'!U1", [["Small group lead (sports)"]]);
  await update("'Player Report'!AD1", [["D-group leader"]]);
  await update("'Check-ins'!F1:G1", [["Satellite", "Gym"]]);
  await clear("'Player Report'!A2:AD");
  await append("'Player Report'!A1:AD", prows);
  await clear("'Check-ins'!A2:D");
  await append("'Check-ins'!A1:D", crows);
  await clear("'Check-ins'!F2:G");
  const sats = checkins.slice().sort((a, b) => b.date.localeCompare(a.date)).map((c) => [txt(c.satellite || ""), txt(c.venue || "")]);
  if (sats.length) await update("'Check-ins'!F2:G" + (sats.length + 1), sats);
  await clear("Leaders!A2:A");
  await update("Leaders!A2:A" + (lrows.length + 1), lrows);
  const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: Logic.TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date());
  await update("About!B1", [[stamp + " Dubai, " + players.length + " players, " + checkins.length + " check-ins"]]);
  return { players: players.length, checkins: checkins.length };
}

module.exports = { enabled, appendCheckins, appendPlayers, rebuild };
