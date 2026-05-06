import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "./waitlist.db";
const LIST_TOKEN = process.env.LIST_TOKEN ?? "";

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS signups (
    email TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL,
    user_agent TEXT,
    ip TEXT
  )
`);

const insert = db.prepare(
  "INSERT OR IGNORE INTO signups (email, created_at, user_agent, ip) VALUES (?, ?, ?, ?)"
);
const count = db.prepare("SELECT COUNT(*) as n FROM signups");
const listAll = db.prepare(
  "SELECT email, created_at, user_agent, ip FROM signups ORDER BY created_at ASC"
);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const indexHtml = await Bun.file("./public/index.html").text();
const appJs = await Bun.file("./public/app.js").text();
const styleCss = await Bun.file("./public/style.css").text();

function send(body: string, type: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": type, "cache-control": "public, max-age=300" },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (req.method === "GET" && url.pathname === "/") {
      return send(indexHtml, "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/app.js") {
      return send(appJs, "application/javascript; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/style.css") {
      return send(styleCss, "text/css; charset=utf-8");
    }

    if (req.method === "POST" && url.pathname === "/api/signup") {
      let body: { email?: unknown };
      try {
        body = (await req.json()) as { email?: unknown };
      } catch {
        return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
      }
      const raw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!raw || raw.length > 254 || !EMAIL_RE.test(raw)) {
        return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
      }
      const ua = req.headers.get("user-agent")?.slice(0, 512) ?? null;
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        null;
      insert.run(raw, Date.now(), ua, ip);
      return Response.json({ ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/count") {
      const row = count.get() as { n: number };
      return Response.json({ count: row.n });
    }

    if (req.method === "GET" && url.pathname === "/api/list") {
      const auth = req.headers.get("authorization") ?? "";
      const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!LIST_TOKEN || !provided || !timingSafeEqual(provided, LIST_TOKEN)) {
        return new Response("not found", { status: 404 });
      }
      const rows = listAll.all();
      return Response.json({ count: rows.length, rows });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`waitlist listening on :${PORT} (db=${DB_PATH})`);
