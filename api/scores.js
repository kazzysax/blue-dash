import { put, list, del } from "@vercel/blob";

// Live global leaderboard for Blue Dash.
// Each run is an IMMUTABLE blob whose pathname encodes {score, ts, rings, name},
// so a strongly-consistent list() alone reconstructs the board — no mutable
// read-modify-write blob, no CDN-cached content reads, no lost updates.
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const PREFIX = "runs/";
const MAX_STORE = 200; // keep the best 200 runs
const TOP_N = 10; // show the top 10
const MAX_SCORE = 1_000_000;

function sanitizeName(n) {
  const clean = String(n ?? "").replace(/[^\w \-.'’]/g, "").trim().slice(0, 16);
  return clean || "RUNNER";
}

// Encode name so the only literal "_" in the pathname is our field separator.
function encName(name) {
  return encodeURIComponent(name).replace(/_/g, "%5F");
}
function pathFor(e) {
  return `${PREFIX}${e.score}_${e.ts}_${e.rings}_${encName(e.name)}.json`;
}
function parsePath(p) {
  const base = p.slice(PREFIX.length).replace(/\.json$/, "");
  const parts = base.split("_");
  if (parts.length < 4) return null;
  const [score, ts, rings, ...rest] = parts;
  const e = {
    score: Number(score),
    ts: Number(ts),
    rings: Number(rings),
    name: decodeURIComponent(rest.join("_")),
  };
  if (!Number.isFinite(e.score) || !Number.isFinite(e.ts)) return null;
  return e;
}

async function allRuns() {
  if (!TOKEN) return [];
  const out = [];
  let cursor;
  do {
    const res = await list({ prefix: PREFIX, token: TOKEN, cursor, limit: 1000 });
    for (const b of res.blobs) {
      const e = parsePath(b.pathname);
      if (e) out.push(e);
    }
    cursor = res.cursor;
  } while (cursor);
  out.sort((a, b) => b.score - a.score || a.ts - b.ts);
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!TOKEN) return res.status(500).json({ error: "storage not configured" });

    if (req.method === "GET") {
      const runs = await allRuns();
      return res.status(200).json({ top: runs.slice(0, TOP_N), total: runs.length });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const name = sanitizeName(body.name);
      const score = Math.floor(Number(body.score));
      const rings = Math.floor(Number(body.rings) || 0);
      if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE)
        return res.status(400).json({ error: "invalid score" });
      if (!Number.isFinite(rings) || rings < 0 || rings > 100000)
        return res.status(400).json({ error: "invalid rings" });

      const entry = { name, score, rings, ts: Date.now() };
      // Immutable write — concurrent submits never clobber each other.
      await put(pathFor(entry), JSON.stringify(entry), {
        access: "public",
        addRandomSuffix: false,
        token: TOKEN,
        contentType: "application/json",
        cacheControlMaxAge: 0,
      });

      const runs = await allRuns();
      // Prune anything past the best MAX_STORE so storage stays bounded.
      if (runs.length > MAX_STORE) {
        const drop = runs.slice(MAX_STORE).map(pathFor);
        await del(drop, { token: TOKEN }).catch(() => {});
      }
      const kept = runs.slice(0, MAX_STORE);
      const rank = kept.findIndex((r) => r.ts === entry.ts && r.name === name) + 1;
      return res.status(200).json({
        rank: rank || null,
        top: kept.slice(0, TOP_N),
        total: kept.length,
      });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    console.error("scores API error:", e);
    return res.status(500).json({ error: "server error" });
  }
}
