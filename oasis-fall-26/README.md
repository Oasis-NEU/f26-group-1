# NUSublet

Helps students fill empty rooms in a lease when roommates leave for co-op or summer, and helps seekers find rooms whose dates actually line up.

- **Frontend:** React + Vite + TypeScript + Tailwind (`src/`)
- **Backend:** Supabase: Auth (email code / magic link), Postgres with Row Level Security, Storage, pg_cron (`supabase/`). There is no app server; the browser talks to Supabase directly and RLS enforces who can do what.

See [CLAUDE.md](CLAUDE.md) for the data model, RLS rules and matching weights.

## Run it locally

You need Node 20+ and [Docker Desktop](https://www.docker.com/products/docker-desktop/) (local Supabase runs in Docker).

```sh
npm install
npm run db:start          # starts local Supabase, applies migrations + seed.sql
cp .env.example .env.local
# paste the "API URL" and "anon key" that db:start printed into .env.local
npm run dev               # http://localhost:5173
```

To sign in locally, enter a seed email and get the code from Mailpit at <http://127.0.0.1:54324>:

| Email                | Who                                 |
| -------------------- | ----------------------------------- |
| `alex@example.com`   | Has two open listings               |
| `priya@example.com`  | Has listings, one filled            |
| `jordan@example.com` | Seeking a room for co-op            |
| `sam@example.com`    | Seeking a room for summer classes   |
| `taylor@example.com` | Both: has a listing and is seeking  |

Vite loads `.env.local` over `.env`, so `.env.local` decides which Supabase you hit.

## Scripts

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `npm run dev`       | Frontend dev server                                             |
| `npm run build`     | Typecheck + production build (`dist/`)                          |
| `npm run lint`      | Oxlint                                                          |
| `npm run db:start`  | Start local Supabase (`db:stop` to stop)                        |
| `npm run db:reset`  | Rebuild the local DB from migrations + `seed.sql`               |
| `npm run db:test`   | Run the pgTAP tests in `supabase/tests/`                        |
| `npm run db:types`  | Regenerate `src/types/database.ts` from the local DB            |

After any schema change: add a migration (`npx supabase migration new <name>`), `db:reset`, `db:types`, `db:test`.

## Layout

```
supabase/
  migrations/   one concern per file; never edit one that has been pushed
  seed.sql      fake users, listings, seekers and sample buildings
  tests/        pgTAP tests for every table's RLS, matching and the expiry job
  templates/    sign-in email (includes the 6-digit code)
  config.toml   local Supabase settings
src/
  lib/          supabase client, auth context, formatting, photo upload helpers
  components/   shared UI, listing + seeking widgets
  pages/        one file per route
  types/        generated database types (don't hand-edit)
```

## Deploying

- **Schema:** `npx supabase link --project-ref <ref>`, then `npx supabase db push`.
- **Hosted auth settings** (dashboard, not in migrations): set the Site URL and redirect URLs to the Vercel domain, and add `{{ .Token }}` to the Magic Link and Confirm Signup email templates so the code-entry sign-in works.
- **Frontend:** Vercel static build (`npm run build`, output `dist/`). `vercel.json` sends every route to `index.html`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel. Never the service-role key.
