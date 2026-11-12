---
name: run-oasis-fall-26
description: Build, run, test, and drive the NUSublet website (oasis-fall-26, React + Vite + local Supabase). Use when asked to run or start the site, test it end-to-end, take screenshots of its pages, check a UI change works in the real app, or run the DB tests.
---

NUSublet is a React SPA that talks straight to Supabase (no app server). To drive it, run
local Supabase in Docker, start the Vite dev server pointed at it, then run
`.claude/skills/run-oasis-fall-26/driver.mjs` (headless Chromium via Playwright).

All paths below are relative to `oasis-fall-26/`. Verified on macOS (Docker Desktop, Node 23).

**Never test against `.env`.** It points at the shared remote Supabase project, and every
driver run creates a new anonymous user plus a listing and a seeker post.

## Prerequisites

- Docker running. The Supabase CLI is a devDependency, so use `npx supabase`, not a global `supabase`.
- Playwright, installed once outside the repo (it isn't in `package.json`):

```bash
PW_DIR=~/.cache/oasis-playwright; [ -d $PW_DIR/node_modules/playwright ] || npm i --prefix $PW_DIR playwright@1.65.0 >/dev/null; $PW_DIR/node_modules/.bin/playwright install chromium-headless-shell
```

## Start the backend (local Supabase)

```bash
docker info >/dev/null 2>&1 || open -a Docker
until docker info >/dev/null 2>&1; do sleep 2; done
npx supabase start >/dev/null 2>&1; until npx supabase status >/dev/null 2>&1; do sleep 3; done; echo supabase-up
npx supabase db reset 2>&1 | tail -1     # applies every migration + seed.sql; wipes local data
```

## Start the frontend, pointed at local Supabase

```bash
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY nohup npm run dev -- --port 5173 --strictPort > /tmp/oasis-dev.log 2>&1 &
until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done; echo dev-up
curl -s http://localhost:5173/src/lib/supabase.ts | head -1   # must show VITE_SUPABASE_URL "http://127.0.0.1:54321"
```

## Drive it (agent path)

```bash
PW_DIR=~/.cache/oasis-playwright node .claude/skills/run-oasis-fall-26/driver.mjs flow
PW_DIR=~/.cache/oasis-playwright node .claude/skills/run-oasis-fall-26/driver.mjs shot /buildings /seeking
```

- `flow` runs 17 steps and prints PASS/FAIL for each: the login redirect, anonymous sign-in, onboarding (a gmail address must be rejected), seed listings, posting a listing, posting a seeker request and seeing its matches, the buildings list and a building page, the compare page (ticking buildings, the tray, "Show only differences", adding a third building, the 2-column phone layout, the link from a building page), saving lifestyle answers, and a check that the page doesn't scroll sideways at 375px. The compare steps rely on the seed specs for the Back Bay Towers, Fenway Commons and Symphony Place samples.
- `shot <route>...` signs in a new user, completes onboarding, then takes a full-page screenshot of each route. Use it for UI changes, for example a new page.
- Screenshots go to `$TMPDIR/oasis-shots/` (set `OUT=` to change it) and are numbered in step order. **Open them and look.**
- Exit code 1 if any step fails or any console error or HTTP response ≥ 400 shows up. Those errors are printed under `ERRORS:`.
- `BASE=` changes the URL (default `http://localhost:5173`).
- To add a step: copy a `step(...)` block. `field('Label text')` finds the input, select or textarea inside a `<Field>` label.

## Build and static checks

```bash
npm run typecheck && npm run lint && npm run build
npx supabase test db      # pgTAP, 6 files / 92 tests as of 2026-11-12; needs local Supabase up
```

## Stop

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs kill
npx supabase stop
```

## Run (human path)

Start the backend and frontend as above, then open http://localhost:5173 and click **Continue**.
Plain `npm run dev` with no overrides uses `.env`, which is the remote project.

## Gotchas

- **Vite gives shell env vars priority over `.env`.** The inline `VITE_SUPABASE_*=` override is how
  you get onto local without touching any file. Don't create `.env.local` for this: it would quietly
  move the user's own `npm run dev` onto local too. The `curl …/src/lib/supabase.ts` line shows which
  backend the browser actually got.
- **Every app route needs a profile.** `RequireAuth` sends users without a `profiles` row to
  `/profile`, so screenshotting `/buildings` right after sign-in shows the onboarding form.
  `driver.mjs` always onboards first.
- **Each run creates a new anonymous user.** The local limit is 30 anonymous sign-ins per hour per
  IP (`supabase/config.toml`). `npx supabase db reset` clears the test users.
- **A seeker's matches never include their own listing.** `match_listings_for_seeker` filters
  `owner_id <> user_id`. So in `flow`, the test listing doesn't show in that user's matches. Only
  seed listings and listings from earlier runs do.
- The onboarding email check is the browser's `pattern=".+@northeastern\.edu"`. A bad email never
  reaches the DB, so the driver checks `checkValidity()` instead of waiting for an error message.
- macOS has no `timeout`, so wait with `until …; do sleep N; done` loops.
- zsh aborts the whole command on a glob with no matches (`rm shots/*.png` → `no matches found`).
- The compare page imports `../scraping/data/field_catalog.json`, which lives outside the Vite root.
  `vite.config.ts` allows it through `server.fs.allow`. Without that, dev mode refuses to serve the file.
- `npm run build` warns that the main chunk is about 530 KB (over 500 KB). That's expected, not a failure.

## Troubleshooting

- `failed to connect to the docker API at unix:///Users/…/.docker/run/docker.sock` → Docker
  Desktop isn't running. Run `open -a Docker` and wait for `docker info` to succeed.
- `supabase start` → `StatusDbNotReadyError … container is not ready: starting` right after Docker
  boots. The containers are still coming up. Poll `npx supabase status` until it exits 0, as the
  start loop above does.
- `playwright not found: set PW_DIR` → run the Prerequisites install and pass `PW_DIR=`.
- In `shot` mode, a dead dev server crashes with a `page.goto` stack trace (exit 1). Start the
  frontend first.
