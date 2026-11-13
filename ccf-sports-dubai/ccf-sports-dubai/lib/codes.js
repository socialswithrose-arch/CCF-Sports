"use strict";
/* Member numbers: one list for all satellites, in order (CCF-00001, CCF-00002, ...).
   Each number is claimed atomically in the "codes" collection, so two sign-ups at the same moment never share one. */
const db = require("./db");

function pad(n) { return String(n).padStart(5, "0"); }

async function nextCode(players, ownerId) {
  const list = players || await db.all("players");
  let n = list.reduce((m, p) => Math.max(m, parseInt(p.code, 10) || 0), 0) + 1;
  for (let tries = 0; tries < 50; tries++, n++) {
    if (await db.claim("codes", pad(n), { playerId: ownerId || "", at: Date.now() })) return pad(n);
  }
  throw Object.assign(new Error("Couldn't assign a member number. Please try again."), { status: 503 });
}

module.exports = { nextCode, pad };
