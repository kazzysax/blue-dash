# Blue Dash 🏃‍♂️💨

A fast 3D lane-runner built with [Three.js](https://threejs.org). Dodge the spikes,
grab the rings, and climb the **live global leaderboard**.

**Play:** https://blue-dash-eight.vercel.app

## Controls
- **Desktop:** `← →` or `A / D` to switch lanes · `↑` / `Space` to jump
- **Phone:** drag — the runner follows your finger · flick up or tap to jump

## Scoring
`score = distance + rings × 10`. Speed ramps up the longer you survive.

## Live leaderboard
- Top 10 runs shown on the start and game-over screens, shared across all players.
- After a run, enter a name and hit **SUBMIT** to post your score.
- Backend: a Vercel Serverless Function (`api/scores.js`) reading/writing a JSON
  document in **Vercel Blob**. Writes are protected by a server-only
  `BLOB_READ_WRITE_TOKEN`; reads are public. Scores are validated and capped,
  names sanitised, and the best 100 runs are kept.

## Run locally
```bash
npm install
vercel dev      # serves the game + /api/scores with your linked Blob store
```
Requires the Vercel CLI, logged in and linked to the `blue-dash` project
(`vercel link`). The Blob store token lives in `.env.local` (git-ignored).

## Stack
Static HTML/JS + Three.js (CDN import map) · Vercel Serverless Functions · Vercel Blob.
No build step.
