"use strict";
/* Public API used by players on their own phones. */
const db = require("../lib/db");
const auth = require("../lib/auth");
const sheets = require("../lib/sheets");
const Logic = require("../public/logic.js");
const { handler, fail, str, digits } = require("../lib/http");

function publicPlayer(p) {
  return { id: p.id, code: p.code, firstName: p.firstName, lastName: p.lastName, lifeStage: p.lifeStage, dgroupId: p.dgroupId || "" };
}

const { nextCode } = require("../lib/codes");

async function playerFor(body) {
  const id = str(body.id, 40), token = str(body.token, 100);
  if (!id || !token) throw fail(401, "Please sign up or find your record first.");
  const p = await db.get("players", id);
  if (!p || !p.token || !auth.safeEqual(p.token, token)) throw fail(401, "We couldn't find your record on this phone. Please find it again.");
  return p;
}

/* Where this player is in today's line-up (only their own spot is shared). Uses the same order and game sizes the leaders see. */
async function spotFor(playerId, checkins, date) {
  const day = checkins.filter((c) => c.date === date);
  const mine = day.find((c) => c.playerId === playerId);
  if (!mine) return null;
  const settings = (await db.get("settings", "main")) || {};
  const sat = mine.satellite || "", gym = mine.venue || (sat ? Logic.venueFor(settings, sat, date).gym : "");
  if (mine.sitOut) return { sitOut: true, satellite: sat, gym };
  const tonight = day.filter((c) => (c.satellite || "") === sat);
  const players = await db.all("players");
  const lu = Logic.lineup(tonight, players, Logic.gameConfig(settings, date, sat));
  const me = lu.find((x) => x.checkin.playerId === playerId);
  const games = lu.length ? lu[lu.length - 1].game : 0;
  return me ? { game: me.game, team: me.team, n: me.n, games, players: lu.length, satellite: sat, gym } : null;
}

/* Record one check-in; returns { already, visitNumber }. */
async function doCheckin(p, date, satellite) {
  const id = date + "_" + p.id;
  const existing = await db.get("checkins", id);
  const visits = (await db.all("checkins")).filter((c) => c.playerId === p.id);
  if (existing) return { already: true, visitNumber: visits.length, spot: await spotFor(p.id, await db.all("checkins"), date) };
  const firstTime = visits.length === 0;
  const sat = Logic.SATELLITES.includes(satellite) ? satellite : (p.satellite || "");
  const venue = sat ? Logic.venueFor((await db.get("settings", "main")) || {}, sat, date).gym : "";
  const rec = { playerId: p.id, date, ts: Date.now(), firstTime, by: "self", role: p.volunteer ? "volunteer" : "player", satellite: sat, venue };
  await db.put("checkins", id, rec);
  const upd = {};
  if (!p.firstVisit || p.firstVisit > date) upd.firstVisit = date;
  if (!p.satellite && sat) upd.satellite = sat;
  if (Object.keys(upd).length) await db.patch("players", p.id, upd);
  await sheets.appendCheckins([{ checkin: rec, player: p }]);
  return { already: false, visitNumber: visits.length + 1, firstTime, spot: await spotFor(p.id, await db.all("checkins"), date) };
}

module.exports = handler({
  async info() {
    const s = (await db.get("settings", "main")) || {};
    return { name: s.name || "CCF Sports Ministry", tagline: s.tagline || "Play with a purpose." };
  },

  async signup(b) {
    const first = str(b.firstName, 60), last = str(b.lastName, 60), phone = str(b.phone, 30), email = str(b.email, 120);
    const location = str(b.location, 120), lifeStage = str(b.lifeStage, 60);
    const volunteer = b.role === "Volunteer", churchStatus = volunteer ? "" : str(b.churchStatus, 60);
    if (!first || !last || digits(phone).length < 7 || !email.includes("@") || !location || !Logic.LIFE_STAGES.includes(lifeStage)) {
      throw fail(400, "Please fill in your name, mobile number, email, where you live and your life stage.");
    }
    if (!Logic.ROLES.includes(b.role)) throw fail(400, "Please choose whether you're signing up as an attendee or a volunteer.");
    if (!volunteer && !Logic.CHURCH.includes(churchStatus)) throw fail(400, "Please tell us your church connection.");
    const ph = digits(phone).slice(-8);
    const players = await db.all("players");
    const dupe = players.find((p) => digits(p.phone).slice(-8) === ph);
    if (dupe) throw fail(409, "This mobile number is already registered. Tap “I've been here before” to find your record.");
    const id = auth.randomId(), token = auth.randomToken(), code = await nextCode(players, id);
    const p = {
      firstName: first, lastName: last, phone, email, location, lifeStage,
      invitedBy: str(b.invitedBy, 80), wantsConnect: Logic.WANTS.includes(b.wantsConnect) ? b.wantsConnect : "",
      contactOk: b.contactOk !== false, volunteer, churchStatus, satellite: Logic.SATELLITES.includes(b.satellite) ? b.satellite : "", code, token, firstVisit: "", stage: "new", stageDates: { new: Logic.today() },
      dgroupId: "", dgroupDate: "", followedUp: false, notes: "", createdAt: Date.now(), source: "self"
    };
    await db.put("players", id, p);
    const full = { ...p, id };
    await sheets.appendPlayers([full], await db.all("dgroups"));
    let checkin = null;
    const date = Logic.today();
    if (b.session && auth.validSession(b.session, date)) checkin = await doCheckin(full, date, b.sessionSatellite);
    return { player: publicPlayer(full), token, checkin };
  },

  /* Find an existing record: player code + last 4 digits of mobile. */
  async claim(b) {
    const code = digits(b.code).slice(-5), last4 = digits(b.phoneLast4).slice(-4);
    if (code.length !== 5 || last4.length !== 4) throw fail(400, "Enter your 5-digit player code and the last 4 digits of your mobile.");
    const p = (await db.all("players")).find((x) => String(x.code) === code && digits(x.phone).endsWith(last4));
    if (!p) throw fail(404, "No match. Check the code, or ask a leader at the table.");
    let token = p.token;
    if (!token) { token = auth.randomToken(); await db.patch("players", p.id, { token }); }
    return { player: publicPlayer(p), token };
  },

  async me(b) {
    const p = await playerFor(b);
    const allCheckins = await db.all("checkins");
    const visits = allCheckins.filter((c) => c.playerId === p.id).map((c) => c.date).sort();
    const g = p.dgroupId ? await db.get("dgroups", p.dgroupId) : null;
    const settings = (await db.get("settings", "main")) || {};
    const next = Logic.nextGame(settings, Logic.today(), p.satellite || "");
    const r = next ? await db.get("rsvps", next.date + "_" + p.id) : null;
    const sats = p.satellite ? [p.satellite] : Logic.SATELLITES.filter((s) => next && Logic.isGameDay(settings, next.date, s));
    if (next) next.venues = sats.map((sat) => Logic.venueFor(settings, sat, next.date));
    return { player: { ...publicPlayer(p), satellite: p.satellite || "" }, visits, dgroup: g ? { name: g.name, leader: g.leader || "", meets: g.meets || "" } : null,
      nextGame: next ? { ...next, satellite: p.satellite || "", going: r ? r.going : null, checkedIn: visits.includes(next.date) } : null,
      tonight: visits.includes(Logic.today()) ? await spotFor(p.id, allCheckins, Logic.today()) : null };
  },

  /* "I'll play" / "Can't make it" for an upcoming game. */
  async rsvp(b) {
    const p = await playerFor(b);
    const settings = (await db.get("settings", "main")) || {};
    const t = Logic.today(), date = str(b.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < t || Logic.daysBetween(t, date) > 14 || !Logic.isGameDay(settings, date)) throw fail(400, "That isn't an upcoming game day.");
    await db.put("rsvps", date + "_" + p.id, { playerId: p.id, date, going: !!b.going, ts: Date.now(), satellite: p.satellite || "" });
    return { ok: true, going: !!b.going };
  },

  /* Self check-in with the code from the game day's QR. date may be up to 3 days old (sent from an offline queue). */
  async checkin(b) {
    const p = await playerFor(b);
    const t = Logic.today();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : t;
    if (date > t || Logic.daysBetween(date, t) > 3) throw fail(400, "That check-in is too old to record.");
    if (!auth.validSession(b.session, date)) throw fail(403, "This check-in QR isn't valid for that day. Scan today's code at the court.");
    return doCheckin(p, date, b.satellite);
  }
});
