"use strict";
/* Nightly Google Sheet refresh, called by Vercel Cron (see vercel.json). */
const db = require("../lib/db");
const sheets = require("../lib/sheets");
const { send } = require("../lib/http");

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== "Bearer " + secret) return send(res, 401, { error: "Not allowed" });
  try {
    const [players, checkins, dgroups, settingsArr, rsvps] = await Promise.all([db.all("players"), db.all("checkins"), db.all("dgroups"), db.all("settings"), db.all("rsvps")]);
    const out = await sheets.rebuild({ players, checkins, dgroups, settings: settingsArr.find((s) => s.id === "main") || {}, rsvps });
    send(res, 200, { ok: true, ...out });
  } catch (e) {
    console.error("cron", e);
    send(res, 500, { error: e.message });
  }
};
