/* Shared rules for the CCF Sports Ministry app.
   Loaded in the browser (window.Logic) and on the server (require). */
(function (root) {
  "use strict";

  var TZ = "Asia/Dubai";

  var STAGES = [
    { k: "new", label: "New contact", short: "New" },
    { k: "open", label: "Open to faith talks", short: "Open" },
    { k: "gospel", label: "Heard the Gospel", short: "Heard Gospel" },
    { k: "received", label: "Received Christ", short: "Received Christ" },
    { k: "discipled", label: "Being discipled", short: "Discipled" },
    { k: "baptized", label: "Baptized", short: "Baptized" },
    { k: "serving", label: "Serving / leading", short: "Serving" }
  ];

  var LIFE_STAGES = ["Married – wife here in UAE", "Married – wife not in UAE", "Single man", "Kool single parent"];
  var WANTS = ["Yes, I'm interested", "Maybe later", "No thanks"];
  var ROLES = ["Attendee", "Volunteer"];
  /* Church connection, asked of attendees at sign-up. */
  var CHURCH = ["Already in a D-group", "CCF churchgoer, no D-group yet", "Just attending"];
  /* Active CCF satellites; each runs its own game on game day at its own gym.
     Players pick the one they were invited to. Add more here when new satellites start. */
  var SATELLITES = ["North", "South"];
  var SAT_LABELS = { North: "North – Al Nahda / Al Qusais area", South: "South – Business Bay (Dubai South area)" };
  function satLabel(k) { return SAT_LABELS[k] || k || ""; }
  function satFromLabel(label) { var k = SATELLITES.find(function (x) { return SAT_LABELS[x] === label || x === label; }); return k || ""; }

  var ATT = {
    "new": { label: "New", hint: "1 visit, in the last 30 days", color: "#eb6834" },
    regular: { label: "Regular", hint: "3+ visits in the last 8 weeks", color: "#1a7f37" },
    occasional: { label: "Occasional", hint: "1–2 visits in the last 8 weeks", color: "#2a78d6" },
    lapsed: { label: "Lapsed", hint: "Came 2+ times, not seen in 30+ days", color: "#9a6700" },
    noreturn: { label: "Didn't return", hint: "Came once, more than 30 days ago", color: "#8a877f" },
    none: { label: "No visits", hint: "Added but never checked in", color: "#8a877f" }
  };

  var OUTREACH = [
    { k: "not_yet", label: "Not reached out" },
    { k: "invited", label: "Invited, waiting" },
    { k: "attending", label: "In a D-group" },
    { k: "not_now", label: "Not ready / declined" }
  ];

  function pad(n) { return String(n).padStart(2, "0"); }

  /* Today's date (YYYY-MM-DD) in the ministry's time zone. */
  function today(d) {
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d || new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return o.year + "-" + o.month + "-" + o.day;
  }
  function parse(s) { var a = s.split("-").map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); }
  function ymd(d) { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function addDays(s, n) { var d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }

  function stageIdx(k) { var i = STAGES.findIndex(function (s) { return s.k === k; }); return i < 0 ? 0 : i; }
  function stageLabel(k) { return STAGES[stageIdx(k)].label; }

  function attendanceOf(visits, t) {
    t = t || today();
    if (!visits || !visits.length) return "none";
    var last = visits[visits.length - 1], since = daysBetween(last, t);
    if (visits.length === 1) return since <= 30 ? "new" : "noreturn";
    if (since > 30) return "lapsed";
    var recent = visits.filter(function (v) { return daysBetween(v, t) <= 56; }).length;
    return recent >= 3 ? "regular" : "occasional";
  }

  function outreachOf(p) { return p.dgOutreach || (p.dgroupId || p.churchStatus === CHURCH[0] ? "attending" : "not_yet"); }
  function outreachLabel(k) { var o = OUTREACH.find(function (x) { return x.k === k; }); return (o || OUTREACH[0]).label; }

  /* Small group lead (sports): the person caring for this player during game play.
     Not the same as the D-group leader, who is set on the D-group once the player commits to one. */
  function facilitatorOf(p) { return (p && p.facilitator) || ""; }
  function dgroupLeaderOf(p, dgroups) {
    if (p.dgroupId && p.dgroupLeader) return p.dgroupLeader;
    var g = (dgroups || []).find(function (g) { return g.id === p.dgroupId; });
    return g && g.leader ? g.leader : "";
  }

  function nextAction(p, visits, dgroups, t, rsvps) {
    t = t || today();
    if (p.volunteer) return "";
    var att = attendanceOf(visits, t), out = outreachOf(p), fac = facilitatorOf(p, dgroups);
    if (att === "new" && !p.followedUp) return "Follow up after first visit";
    if (rsvps && twoNoShowsInARow(rsvps, visits, t)) return "Said they'd come twice, didn't: check in on them";
    if ((att === "regular" || (att === "occasional" && visits.length >= 3) || p.wantsConnect === "Yes, I'm interested" || (p.churchStatus === CHURCH[1] && visits.length >= 2)) && out === "not_yet") return "Invite to a D-group";
    if (out === "invited" && p.dgOutreachDate && daysBetween(p.dgOutreachDate, t) > 14) return "Check on D-group invite";
    if (visits.length >= 2 && !fac && att !== "noreturn") return "Assign a small group lead";
    if (att === "lapsed" && out === "attending") return "Lapsed but in D-group: check in";
    if (att === "lapsed" && stageIdx(p.stage) >= 1) return "Reach out: hasn't come in 30+ days";
    return "";
  }

  /* ---- game schedule & "I'll play" ---- */
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DEFAULT_SCHEDULE = [{ dow: 0, time: "08:00" }];
  function scheduleOf(settings) {
    var s = settings && Array.isArray(settings.schedule) && settings.schedule.length ? settings.schedule : DEFAULT_SCHEDULE;
    return s.filter(function (x) { return x && x.dow >= 0 && x.dow <= 6; });
  }
  /* Each satellite's lead sets that satellite's own game days. Falls back to the ministry-wide schedule. */
  function satSchedule(settings, sat) {
    var s = sat && settings && settings.satellites && settings.satellites[sat];
    if (s && Array.isArray(s.schedule)) return s.schedule.filter(function (x) { return x && x.dow >= 0 && x.dow <= 6; });
    return scheduleOf(settings);
  }
  function isCancelled(settings, sat, d) {
    return ((settings && settings.venueChanges) || []).some(function (v) { return v.date === d && v.satellite === sat && v.cancelled; });
  }
  /* The next game on or after today for a satellite (or any satellite): { date, time, satellite } or null. */
  function nextGame(settings, t, sat) {
    t = t || today();
    var sats = sat ? [sat] : SATELLITES;
    for (var i = 0; i < 21; i++) {
      var d = addDays(t, i), dow = parse(d).getUTCDay();
      for (var j = 0; j < sats.length; j++) {
        var g = satSchedule(settings, sats[j]).find(function (x) { return x.dow === dow; });
        if (g && !isCancelled(settings, sats[j], d)) return { date: d, time: g.time || "", satellite: sat || "" };
      }
    }
    return null;
  }
  /* "Sunday" for a date: used for "Sunday's line-up" and similar labels. */
  function dayName(d) { return DAYS[parse(d || today()).getUTCDay()]; }
  /* Where and when a satellite plays on a date: its usual gym, or a one-date change set by leaders. */
  function venueFor(settings, satellite, date) {
    var base = ((settings && settings.satellites) || {})[satellite] || {};
    var change = ((settings && settings.venueChanges) || []).find(function (v) { return v.date === date && v.satellite === satellite; });
    var g = change || base;
    var sched = satSchedule(settings, satellite).find(function (x) { return x.dow === parse(date).getUTCDay(); });
    return { satellite: satellite, gym: (change && change.gym) || base.gym || "", map: (change && change.map) || base.map || "", time: (change && change.time) || (sched && sched.time) || base.time || "", changed: !!(change && !change.cancelled && change.gym), cancelled: !!(change && change.cancelled) };
  }
  function isGameDay(settings, d, sat) {
    var dow = parse(d).getUTCDay();
    return (sat ? [sat] : SATELLITES).some(function (s) { return !isCancelled(settings, s, d) && satSchedule(settings, s).some(function (x) { return x.dow === dow; }); });
  }
  function fmtTime(hhmm) {
    if (!hhmm) return "";
    var a = hhmm.split(":").map(Number), h = a[0], m = a[1] || 0;
    return ((h % 12) || 12) + (m ? ":" + pad(m) : "") + (h < 12 ? " AM" : " PM");
  }
  /* Past game dates a player said "I'll play" to but didn't check in. Newest last. */
  function noShows(rsvps, visits, t) {
    t = t || today();
    var v = new Set(visits || []);
    return (rsvps || []).filter(function (r) { return r.going && r.date < t && !v.has(r.date); }).map(function (r) { return r.date; }).sort();
  }
  /* True when the last two "I'll play" answers (for past games) were both missed. */
  function twoNoShowsInARow(rsvps, visits, t) {
    t = t || today();
    var v = new Set(visits || []);
    var past = (rsvps || []).filter(function (r) { return r.going && r.date < t; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (past.length < 2) return false;
    var last2 = past.slice(-2);
    return !v.has(last2[0].date) && !v.has(last2[1].date);
  }

  /* ---- the game day's line-up ----
     Who plays first, in this order (arrival time breaks ties inside each group):
       1 first-timers, 2 attendees, 3 CCF churchgoers with no D-group, 4 D-group attendees, 5 volunteers (once everyone has played).
     A satellite lead can change the order by hand, the players per game and the number of games. */
  var PRIORITY = ["First-timer", "Attendee", "CCF churchgoer, no D-group", "D-group attendee", "Volunteer"];
  function priorityOf(c, p) {
    p = p || {};
    if (c.role === "volunteer" || p.volunteer) return 4;
    if (c.firstTime) return 0;
    if (p.dgroupId || p.churchStatus === CHURCH[0] || p.dgOutreach === "attending") return 3;
    if (p.churchStatus === CHURCH[1]) return 2;
    return 1;
  }
  function gameKey(date, sat) { return date + "|" + (sat || ""); }
  /* The lead's settings for one satellite's game day: { perGame, games, order }. */
  function gameConfig(settings, date, sat) { return ((settings && settings.gameDays) || {})[gameKey(date, sat)] || {}; }
  function lineup(checkinsToday, players, cfg) {
    cfg = cfg || {};
    var get = function (id) { return !players ? null : players.get ? players.get(id) : players.find(function (x) { return x.id === id; }); };
    var list = checkinsToday.filter(function (c) { return !c.sitOut; }).map(function (c) { return { c: c, r: priorityOf(c, get(c.playerId)) }; });
    list.sort(function (a, b) { return a.r - b.r || (a.c.ts || 0) - (b.c.ts || 0); });
    if (cfg.order && cfg.order.length) {
      var byId = new Map(list.map(function (x) { return [x.c.id, x]; }));
      var manual = cfg.order.map(function (id) { return byId.get(id); }).filter(Boolean);
      var inManual = new Set(manual.map(function (x) { return x.c.id; }));
      // people who arrived after the lead arranged the line-up slot in by priority
      list.filter(function (x) { return !inManual.has(x.c.id); }).forEach(function (x) {
        var at = -1; manual.forEach(function (m, i) { if (m.r <= x.r) at = i; });
        manual.splice(at + 1, 0, x);
      });
      list = manual;
    }
    var n = list.length, per = Math.max(2, parseInt(cfg.perGame, 10) || 10);
    var size = cfg.games > 0 ? Math.max(2, Math.ceil(n / cfg.games)) : per;
    return list.map(function (x, i) {
      var inGame = i % size;
      return { checkin: x.c, n: i + 1, game: Math.floor(i / size) + 1, team: inGame % 2 === 0 ? "A" : "B", priority: x.r, size: size };
    });
  }

  /* Where a player has actually played: "North 6, South 2". checkins = that player's check-ins. */
  function playedAtText(checkins, fallbackSat) {
    var n = {};
    checkins.forEach(function (c) { var k = c.satellite || fallbackSat || ""; if (k) n[k] = (n[k] || 0) + 1; });
    return SATELLITES.filter(function (k) { return n[k]; }).map(function (k) { return k + " " + n[k]; }).join(", ");
  }
  function visitsByPlayer(checkins) {
    var m = new Map();
    checkins.forEach(function (c) { if (!m.has(c.playerId)) m.set(c.playerId, []); m.get(c.playerId).push(c.date); });
    m.forEach(function (v) { v.sort(); });
    return m;
  }

  function rsvpsByPlayer(rsvps) {
    var m = new Map();
    (rsvps || []).forEach(function (r) { if (!m.has(r.playerId)) m.set(r.playerId, []); m.get(r.playerId).push(r); });
    return m;
  }

  function fullName(p) { return ((p.firstName || "") + " " + (p.lastName || "")).trim() || "Unnamed"; }
  function codeLabel(p) { return p && p.code ? "CCF-" + p.code : ""; }

  var api = {
    TZ: TZ, STAGES: STAGES, LIFE_STAGES: LIFE_STAGES, WANTS: WANTS, ROLES: ROLES, CHURCH: CHURCH, SATELLITES: SATELLITES, SAT_LABELS: SAT_LABELS, satLabel: satLabel, satFromLabel: satFromLabel, playedAtText: playedAtText, venueFor: venueFor, ATT: ATT, OUTREACH: OUTREACH,
    today: today, parse: parse, ymd: ymd, addDays: addDays, daysBetween: daysBetween,
    stageIdx: stageIdx, stageLabel: stageLabel, attendanceOf: attendanceOf, outreachOf: outreachOf,
    outreachLabel: outreachLabel, facilitatorOf: facilitatorOf, nextAction: nextAction,
    visitsByPlayer: visitsByPlayer, fullName: fullName, codeLabel: codeLabel,
    DAYS: DAYS, DEFAULT_SCHEDULE: DEFAULT_SCHEDULE, scheduleOf: scheduleOf, nextGame: nextGame, isGameDay: isGameDay, fmtTime: fmtTime, dayName: dayName,
    noShows: noShows, twoNoShowsInARow: twoNoShowsInARow, lineup: lineup, rsvpsByPlayer: rsvpsByPlayer,
    satSchedule: satSchedule, isCancelled: isCancelled, PRIORITY: PRIORITY, priorityOf: priorityOf, gameKey: gameKey, gameConfig: gameConfig, dgroupLeaderOf: dgroupLeaderOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Logic = api;
})(this);
