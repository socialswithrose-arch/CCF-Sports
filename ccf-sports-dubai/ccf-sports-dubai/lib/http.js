"use strict";
/* Small helpers shared by the API functions. */

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch (e) { return {}; }
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}

function handler(actions) {
  return async (req, res) => {
    if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
    let body;
    try {
      body = await readBody(req);
      const fn = actions[body.action];
      if (!fn) return send(res, 400, { error: "Unknown action" });
      const out = await fn(body, req);
      send(res, 200, out || { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(body && body.action, e);
      send(res, status, { error: status >= 500 && !e.status ? "Something went wrong on the server. Please try again." : e.message });
    }
  };
}

function fail(status, message) { return Object.assign(new Error(message), { status }); }

/* Trim strings and cap their length so one record can't grow without limit. */
function str(v, max) { return typeof v === "string" ? v.trim().slice(0, max || 200) : ""; }
function digits(v) { return String(v || "").replace(/\D/g, ""); }

module.exports = { handler, fail, str, digits, send, readBody };
