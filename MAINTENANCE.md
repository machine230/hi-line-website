# Maintenance Notes

**What this repo is:** the Hi-Line club's public **marketing website** — static HTML/CSS/JS,
hosted on **Netlify**, auto-deployed on every push to `main`.

## Architecture (read this before debugging)
- **Fully static.** There is **no backend, database, or auth server** in this repo.
- **Member login is handled entirely by FlightBoard.** `login.html` is a thin landing page
  that links members to **https://www.flightboard.app/login**. The old in-house member app
  (Supabase login / admin / scheduling) is **retired** — do not resurrect it here.
- **All app logic** (scheduling, aircraft, billing, member portal) lives in the separate
  **`flightboard-app`** repo → `flightboard.app`.

## Do NOT re-add
- `supabase/`, `db/`, a runtime `.env`, or any backend/auth code — this site is static-only.
  (Removed 2026-08-25 as legacy in-house-app remnants.)
- `_backup/` snapshots — use git history for prior versions, not committed backup folders.

## Deploy / rollback
- **Deploy:** `git push origin main` → Netlify auto-builds.
- **Rollback:** revert the commit and push, or re-publish a previous deploy in Netlify.

## Contents
- Pages: `index.html`, `join.html`, `wb.html` (weight & balance), `weather.html`,
  `404.html`, `login.html` (→ FlightBoard).
- Assets: `css/`, `js/`, `images/`, `favicon.svg`.
- Config: `netlify.toml`, `netlify/`.
- `docs/` — reference material — keep.
