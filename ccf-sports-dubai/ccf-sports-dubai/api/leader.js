"use strict";
/* API for leaders. Everything except login needs a leader token. */
const db = require("../lib/db");
const auth = require("../lib/auth");
const sheets = require("../lib/sheets");
const Logic = require("../public/logic.js");
const { handler, fail, str, digits } = require("../lib/http");
const { nextCode } = require("../lib/codes");

const PLAYER_FIELDS = ["firstName", "lastName", "phone", "email", "location", "lifeStage", "invitedBy", "wantsConnect", "contactOk",
  "firstVisit", "stage", "stageDates", "dgroupId", "dgroupDate", "dgOutreach", "dgOutreachDate", "facilitator",
  "followedUp", "followedUpDate", "notes", "code", "createdAt", "source", "volunteer", "churchStatus", "satellite"];
/* What a volunteer may fill in when signing up a new player at the table. */
const VOLUNTEER_CREATE_FIELDS = ["firstName", "lastName", "phone", "email", "location", "lifeStage", "invitedBy", "wantsConnect", "contactOk", "volunteer", "churchStatus", "satellite",
  "firstVisit", "stage", "stageDates", "code", "createdAt", "source"];

function leader(b) {
  const who = auth.readLeaderToken(b.auth);
  if (!who) throw fail(401, "Please sign in again.");
  return who;
}
/* Leaders list in Settings = who may sign in with the leader password.
   While the list is empty (first setup), any name works so the first leader can add everyone. */
const norm = (x) => String(x || "").trim().replace(/\s+/g, " ").toLowerCase();
async function allowedName(name) {
  const st = (await db.get("settings", "main")) || {};
  const list = (st.leaders || []).filter(Boolean);
  if (!list.length) return { name, open: true };
  const hit = list.find((n) => norm(n) === norm(name));
  return hit ? { name: hit } : null;
}
async function stillAllowed(who) {
  if (who.role !== "leader") return;
  if (!(await allowedName(who.name))) throw fail(401, "Your name isn't on the leaders list any more. Ask the ministry lead.");
}
function leaderOnly(b) {
  const who = leader(b);
  if (who.role !== "leader") throw fail(403, "Only leaders can do that.");
  return who;
}
function cleanSatellites(v) {
  if (!v || typeof v !== "object") return undefined;
  const out = {};
  Logic.SATELLITES.forEach((k) => {
    const x = v[k] || {};
    out[k] = { gym: str(x.gym, 120), map: /^https?:\/\//.test(x.map || "") ? str(x.map, 500) : "", time: /^\d{2}:\d{2}$/.test(x.time || "") ? x.time : "" };
  });
  return out;
}
function cleanVenueChanges(v) {
  if (!Array.isArray(v)) return undefined;
  const since = Logic.addDays(Logic.today(), -7);
  return v.filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") && x.date >= since && Logic.SATELLITES.includes(x.satellite))
    .map((x) => ({ date: x.date, satellite: x.satellite, gym: str(x.gym, 120), map: /^https?:\/\//.test(x.map || "") ? str(x.map, 500) : "", time: /^\d{2}:\d{2}$/.test(x.time || "") ? x.time : "" }))
    .slice(0, 60);
}
function cleanSchedule(v) {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x) => x && Number.isInteger(x.dow) && x.dow >= 0 && x.dow <= 6)
    .map((x) => ({ dow: x.dow, time: /^\d{2}:\d{2}$/.test(x.time || "") ? x.time : "08:00" })).slice(0, 7);
}

function cleanPatch(patch) {
  const out = {};
  for (const k of PLAYER_FIELDS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (typeof v === "string") out[k] = v.slice(0, k === "notes" ? 4000 : 200);
    else if (typeof v === "boolean" || typeof v === "number") out[k] = v;
    else if (k === "stageDates" && v && typeof v === "object") {
      out[k] = {};
      Logic.STAGES.forEach((s) => { if (typeof v[s.k] === "string") out[k][s.k] = v[s.k].slice(0, 10); });
    }
  }
  return out;
}

async function loadAll() {
  const [players, checkins, dgroups, settingsArr, rsvps] = await Promise.all([db.all("players"), db.all("checkins"), db.all("dgroups"), db.all("settings"), db.all("rsvps")]);
  const settings = settingsArr.find((s) => s.id === "main") || {};
  return { players, checkins, dgroups, settings, rsvps };
}

module.exports = handler({
  async login(b) {
    const name = str(b.name, 60);
    if (!name) throw fail(400, "Enter your name.");
    const role = auth.checkPassword(b.password);
    if (!role) throw fail(401, "That password isn't right.");
    let use = name, open = false;
    if (role === "leader") {
      const ok = await allowedName(name);
      if (!ok) throw fail(403, "“" + name + "” isn't on the leaders list. Type your name exactly as the ministry lead added it, or ask them to add you in Settings.");
      use = ok.name; open = !!ok.open;
    }
    return { auth: auth.leaderToken(use, role), name: use, role, setup: open };
  },

  async all(b) {
    const who = leader(b);
    await stillAllowed(who);
    const d = await loadAll();
    delete d.settings.id;
    const since = Logic.addDays(Logic.today(), -180);
    d.rsvps = d.rsvps.filter((r) => r.date >= since);
    if (who.role === "volunteer") {
      // Volunteers only get what they need to check people in.
      const t = Logic.today();
      return {
        role: "volunteer",
        players: d.players.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, code: p.code, phone: String(p.phone || "").replace(/\D/g, "").slice(-4), firstVisit: p.firstVisit, volunteer: !!p.volunteer, satellite: p.satellite || "" })),
        checkins: d.checkins.map((c) => ({ id: c.id, playerId: c.playerId, date: c.date, ts: c.ts, firstTime: c.firstTime, role: c.role, sitOut: c.sitOut, satellite: c.satellite || "" })),
        rsvps: d.rsvps.filter((r) => r.date >= t), dgroups: [],
        settings: { name: d.settings.name, schedule: d.settings.schedule, satellites: d.settings.satellites, venueChanges: d.settings.venueChanges }, sessionCodes: auth.sessionCodes(), sheet: false, now: Date.now()
      };
    }
    d.players = d.players.map((p) => { const c = { ...p }; delete c.token; return c; });
    return { ...d, role: "leader", sessionCodes: auth.sessionCodes(), sheet: sheets.enabled(), now: Date.now() };
  },

  /* Apply a batch of changes queued on a leader's phone (possibly made offline). */
  async push(b) {
    const who = leader(b);
    await stillAllowed(who);
    const ops = Array.isArray(b.ops) ? b.ops.slice(0, 500) : [];
    const results = [];
    const newCheckins = [], newPlayers = [];
    let players = null, checkinList = null;
    const getPlayers = async () => (players = players || await db.all("players"));
    const getCheckins = async () => (checkinList = checkinList || await db.all("checkins"));

    for (const op of ops) {
      try {
        const volunteer = who.role === "volunteer";
        if (volunteer && !["player", "checkin", "checkinPatch"].includes(op.type)) throw fail(403, "Only leaders can do that.");
        if (op.type === "player") {
          const id = str(op.id, 40);
          if (!id) throw fail(400, "Missing player id");
          const patch = cleanPatch(op.patch || {});
          const existing = await db.get("players", id);
          if (volunteer) {
            if (existing) throw fail(403, "Only leaders can edit player records.");
            Object.keys(patch).forEach((k) => { if (!VOLUNTEER_CREATE_FIELDS.includes(k)) delete patch[k]; });
          }
          let codeChanged = null;
          if (!existing) {
            const list = await getPlayers();
            // Member numbers are given out in order by the server; the phone's number was a placeholder.
            const wanted = String(patch.code || "");
            patch.code = await nextCode(list, id);
            if (patch.code !== wanted) codeChanged = patch.code;
            Object.assign(patch, { createdAt: patch.createdAt || Date.now(), source: patch.source || "leader", addedBy: who.name });
            list.push({ ...patch, id });
            newPlayers.push(id);
          } else delete patch.code;
          await db.patch("players", id, patch);
          results.push({ ok: true, id, codeChanged });
        } else if (op.type === "checkin") {
          const r = op.rec || {};
          const pid = str(r.playerId, 40), date = str(r.date, 10);
          if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, "Bad check-in");
          const cid = date + "_" + pid;
          const list = await getCheckins();
          if (!list.some((c) => c.id === cid)) {
            const p = await db.get("players", pid);
            if (!p) throw fail(404, "Player not found");
            const prior = list.some((c) => c.playerId === pid);
            const sat = Logic.SATELLITES.includes(r.satellite) ? r.satellite : (p.satellite || "");
            const rec = { playerId: pid, date, ts: Number(r.ts) || Date.now(), firstTime: !prior, by: who.name, role: r.role === "volunteer" ? "volunteer" : "player", satellite: sat };
            await db.put("checkins", cid, rec);
            list.push({ ...rec, id: cid });
            const upd = {};
            if (!p.firstVisit || p.firstVisit > date) upd.firstVisit = date;
            if (!p.satellite && sat) upd.satellite = sat;
            if (Object.keys(upd).length) await db.patch("players", pid, upd);
            newCheckins.push({ checkin: rec, player: p });
          }
          results.push({ ok: true });
        } else if (op.type === "checkinPatch") {
          const cid = str(op.id, 60), patch = {};
          if (typeof (op.patch || {}).sitOut === "boolean") patch.sitOut = op.patch.sitOut;
          if (["player", "volunteer"].includes((op.patch || {}).role)) patch.role = op.patch.role;
          if (Logic.SATELLITES.includes((op.patch || {}).satellite)) patch.satellite = op.patch.satellite;
          if (await db.get("checkins", cid)) await db.patch("checkins", cid, patch);
          const list = await getCheckins(); const c = list.find((x) => x.id === cid); if (c) Object.assign(c, patch);
          results.push({ ok: true });
        } else if (op.type === "dgroup") {
          const id = str(op.id, 40);
          if (op.delete) await db.del("dgroups", id);
          else await db.put("dgroups", id, { name: str((op.data || {}).name, 80), leader: str((op.data || {}).leader, 80), meets: str((op.data || {}).meets, 120) });
          results.push({ ok: true });
        } else if (op.type === "settings") {
          const d = op.data || {};
          const patch = {};
          if ("name" in d) patch.name = str(d.name, 80) || "CCF Sports Ministry";
          if ("tagline" in d) patch.tagline = str(d.tagline, 120);
          if ("leaders" in d) patch.leaders = Array.isArray(d.leaders) ? d.leaders.map((x) => str(x, 60)).filter(Boolean).slice(0, 100) : [];
          const sch = cleanSchedule(d.schedule); if (sch) patch.schedule = sch;
          const sats = cleanSatellites(d.satellites); if (sats) patch.satellites = sats;
          const vc = cleanVenueChanges(d.venueChanges); if (vc) patch.venueChanges = vc;
          await db.patch("settings", "main", patch);
          results.push({ ok: true });
        } else if (op.type === "deletePlayer") {
          const id = str(op.id, 40);
          const list = await getCheckins();
          for (const c of list.filter((x) => x.playerId === id)) await db.del("checkins", c.id);
          checkinList = list.filter((x) => x.playerId !== id);
          await db.del("players", id);
          results.push({ ok: true });
        } else if (op.type === "deleteCheckin") {
          await db.del("checkins", str(op.id, 60));
          results.push({ ok: true });
        } else results.push({ ok: false, error: "Unknown change" });
      } catch (e) {
        if (!e.status) console.error("push op", op && op.type, e);
        results.push({ ok: false, error: e.status ? e.message : "Server error" });
      }
    }

    if (newPlayers.length) {
      const fresh = await Promise.all(newPlayers.map((id) => db.get("players", id)));
      await sheets.appendPlayers(fresh.filter(Boolean), await db.all("dgroups"));
    }
    await sheets.appendCheckins(newCheckins);
    return { results };
  },

  async sheetSync(b) {
    leaderOnly(b);
    if (!sheets.enabled()) throw fail(400, "The Google Sheet isn't connected yet.");
    return sheets.rebuild(await loadAll());
  }
});

module.exports.loadAll = loadAll;
