"use strict";
/* Tiny document store on Postgres (Neon). Every record is a JSON document in one table:
   docs(col, id, data). Collections: players, checkins, dgroups, settings.
   Set DB_MOCK=1 to use an in-memory store (local testing only). */

let sql = null;
let ready = null;
const mock = new Map(); // key col|id -> data

function useMock() { return process.env.DB_MOCK === "1"; }

function getSql() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw Object.assign(new Error("The database is not connected yet (DATABASE_URL is missing)."), { status: 503 });
    const { neon } = require("@neondatabase/serverless");
    sql = neon(url);
  }
  return sql;
}

async function init() {
  if (useMock()) return;
  if (!ready) {
    ready = getSql().query(
      "create table if not exists docs (col text not null, id text not null, data jsonb not null, updated_at timestamptz not null default now(), primary key (col, id))"
    ).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function all(col) {
  if (useMock()) {
    const out = [];
    for (const [k, v] of mock) { const [c, id] = k.split("|"); if (c === col) out.push({ ...v, id }); }
    return out;
  }
  await init();
  const rows = await getSql().query("select id, data from docs where col = $1", [col]);
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

async function get(col, id) {
  if (useMock()) { const v = mock.get(col + "|" + id); return v ? { ...v, id } : null; }
  await init();
  const rows = await getSql().query("select data from docs where col = $1 and id = $2", [col, id]);
  return rows.length ? { ...rows[0].data, id } : null;
}

/* Replace the whole document. */
async function put(col, id, data) {
  const clean = { ...data }; delete clean.id;
  if (useMock()) { mock.set(col + "|" + id, clean); return; }
  await init();
  await getSql().query(
    "insert into docs (col, id, data, updated_at) values ($1, $2, $3::jsonb, now()) on conflict (col, id) do update set data = excluded.data, updated_at = now()",
    [col, id, JSON.stringify(clean)]
  );
}

/* Merge top-level fields into the document (creates it if missing). */
async function patch(col, id, data) {
  const clean = { ...data }; delete clean.id;
  if (useMock()) { mock.set(col + "|" + id, { ...(mock.get(col + "|" + id) || {}), ...clean }); return; }
  await init();
  await getSql().query(
    "insert into docs (col, id, data, updated_at) values ($1, $2, $3::jsonb, now()) on conflict (col, id) do update set data = docs.data || excluded.data, updated_at = now()",
    [col, id, JSON.stringify(clean)]
  );
}

/* Create only if missing. Returns true if this call created it (atomic: two callers can't both win). */
async function claim(col, id, data) {
  const clean = { ...data }; delete clean.id;
  if (useMock()) { if (mock.has(col + "|" + id)) return false; mock.set(col + "|" + id, clean); return true; }
  await init();
  const rows = await getSql().query(
    "insert into docs (col, id, data, updated_at) values ($1, $2, $3::jsonb, now()) on conflict (col, id) do nothing returning id",
    [col, id, JSON.stringify(clean)]
  );
  return rows.length > 0;
}

async function del(col, id) {
  if (useMock()) { mock.delete(col + "|" + id); return; }
  await init();
  await getSql().query("delete from docs where col = $1 and id = $2", [col, id]);
}

module.exports = { all, get, put, patch, del, claim };
