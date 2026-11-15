We are making a housing website for students. We want to add a feature for comparing fields such as costs, expenses, ammeneties, location, etc to buildings. We would like a similar comparison to how on the apple website you can compare different models of their products such as the iphone 15 vs iphone 19 as an example (we will have buildings instead of iphones of couse though). We also need to plan how to integrate scraping into the architecture of the comparison feature. For now, we would like to scrape the data once, format it cleanly, and then use it to compare different buildings. First, create a workflow that will allow us to scrape information about the buildings listed in the nusublet_buildings.json file. Additionally, plan how we will format this data. If needed, add updates to the architecture in the CLAUDE.md file BUT notify me before changing anything in the CLAUDE.md file.

---

# Building comparison: plan

Status (2026-11-12): phase 1 (scraping workflow + data format), phase 2 (database:
`buildings.slug`, `building_specs`, test, seed, `build --sql`) and a first version of phase 3
(compare page, running on seed data) are built. Gap 4 below is still open; the other gaps are proposals.

## How it fits together

```
oasis-fall-26/nusublet_buildings.json      143 buildings: id, name, type, campus, address, website
        │
        ▼  scraping/building_specs.py  (run by hand, once; output reviewed by the team)
  fetch    official pages only, robots.txt + crawl delay  ──► output/specs/pages/
  extract  NU hall pages + NU rate chart + Boston open data
           + keyword matches on official sites             ──► output/specs/facts.jsonl
  build    pick best source per field, validate types,
           apply data/overrides.csv                        ──► output/specs/buildings_compare.json
                                                               review.csv, manual_todo.csv, coverage.csv
        │
        ▼  phase 2: generate SQL from buildings_compare.json
  supabase/seed.sql (local) / one-off insert (prod)        ──► public.building_specs
        │
        ▼  phase 3
  /compare?b=west-village-a,lightview,van-ness             React page, reads building_specs + buildings
```

Scraping never runs in the app or in the browser. The app only reads the reviewed result from
Postgres, the same way building pages work today. Rerunning later (new rate chart, new buildings)
is the same three commands plus a new seed/insert.

## Data format

### 1. Field catalog: `scraping/data/field_catalog.json`

This file defines every row of the comparison table: section, label, type, unit, and which
direction is "better" (used for highlighting). The scraper validates against it and the UI
renders from it, so adding a row means editing one file. Six sections, 53 fields:

| Section | Examples |
|---|---|
| Overview | type, campus, style, neighborhood, managed by, year built, stories |
| Cost | rent per person/month (from/up to), NU semester rate (from/up to), rates by room type, meal plan, lease type, utilities, internet, broker fee, parking |
| Rooms | bedroom types, apartment sizes, bathroom, kitchen, appliances, furnished, A/C, heat |
| Building amenities | laundry (in unit / in building / none), elevator, security, gym, lounge, dining hall, parking, pets, bike storage, packages, roof deck |
| Location | walk to campus, nearest T (2), supermarket, laundromat, pharmacy, Bluebikes, measured from |
| City records | 311 pest/heat/living-condition complaints, violations (total/open), renovation permits, last renovation |

Types: `text`, `int`, `money`, `bool`, `enum`, `list`, `places`, `rates`.

### 2. Rules every value follows

- **Money** is whole US dollars (integer), like the rest of the schema. The unit in the catalog
  says the period. "Rent per person per month" is the field that makes dorms and apartments
  comparable. Northeastern semester rates are divided by 4 months, and the semester figure is
  kept alongside.
- **Unknown is missing, never `false`.** A building with no `amenities.elevator` key shows "—",
  not "No".
- **Enums, not prose**: `amenities.laundry` is `in_unit | in_building | none`, so the UI can
  compare and highlight. Labels live in the catalog.
- **Every value carries its source**: `{value, source, url, status}`. `status` is `verified`
  (structured official source, or checked by a person) or `unverified` (keyword match, parcel-wide
  city data, Northeastern-leased units only). The clean dataset only has verified values by default.
- **No street addresses, Reddit text or review text in the dataset.** Addresses stay in the
  building list and are used only for lookups. (Some building names are addresses, e.g.
  "836 Huntington Ave"; that's the name, not new information.)

### 3. Dataset file: `output/specs/buildings_compare.json`

```json
{
  "generated_at": "2026-11-05",
  "catalog_version": 1,
  "months_per_semester": 4,
  "sources": { "nu_rates": {"title": "...", "url": "..."}, "...": {} },
  "buildings": [
    {
      "id": "stetson-hall-east",
      "name": "Stetson Hall East",
      "aliases": ["Stetson East"],
      "specs": {
        "cost.rent_pp_month_min": {"value": 1470, "source": "nu_rates",
                                   "url": "https://housing.northeastern.edu/...pdf", "status": "verified"},
        "amenities.laundry": {"value": "in_building", "source": "nu_housing", "url": "...", "status": "verified"},
        "location.t_stations": {"value": [{"name": "Northeastern University", "detail": "Green Line E",
                                           "walk_minutes": 3, "distance_m": 210}], "source": "boston_open_data"}
      },
      "coverage": {"filled": 39, "of": 53}
    }
  ]
}
```

## Sources and what each covers

| Source | Covers | Trust |
|---|---|---|
| Team overrides (`data/overrides.csv`) | anything | verified, always wins |
| NU rate charts 2026–27 (hand-typed CSV, cross-checked against the PDF text) | cost for all 36 existing halls | verified |
| housing.northeastern.edu hall pages | rooms, laundry, elevator, kitchen, security, A/C | verified |
| Boston open data, MBTA, OpenStreetMap, Bluebikes | location, year built, heat/AC, city records | verified (parcel-wide fields on campus: unverified) |
| Official complex websites (thefenway.com, americancampus.com…) | building amenities | unverified until a person checks |
| Listing portals (apartments.com, homes.com, Redfin, aptsearch…) | rent, amenities | **not scraped**: terms forbid it or they block bots. Read by hand → overrides |

## What the first runs showed

Full fetch of all 143 buildings (39 pages saved, 39 skipped by policy), plus city data for a sample of 13:

- Northeastern halls fill ~40/53 fields with city data (19–25 without), including real costs for all 36.
- Off-campus buildings fill ~20/53: location and city records yes, **rent no**.
- Streets (24 entries) fill ~10/53: location only, measured from the middle of the street.
- Planned buildings (2) have nothing to compare.
- Data problems in `nusublet_buildings.json` that the workflow caught: `church-park`'s website
  redirects to a Bronx property, `church-park` has no street address, `768 Columbus` lacks "Ave",
  and three buildings share one thefenway.com page, so its amenities can't be attributed to a
  single building.

## Gaps to decide

1. **Off-campus rent.** No automated source is allowed. Options, best first:
   a. Use NUSublet's own data: median `listings.rent_per_room` per `building_id` (already in
      Postgres, live, per-room, so directly comparable). Show "From NUSublet listings (n=4)".
   b. Team reads listings by hand for the buildings people compare most → overrides.
   c. Neighborhood-level context (e.g. Zillow ZORI by ZIP). It can't distinguish one building
      from another.
2. **Which buildings the compare picker offers.** Suggest: residence halls and apartment
   buildings with coverage ≥ 15 fields. Streets and planned buildings stay on the list page
   but aren't comparable.
3. **Linking scraped rows to `public.buildings`.** The JSON uses slugs (`west-village-a`); the table
   uses bigint ids and unique names. Proposal: add `buildings.slug text unique`.
4. **CLAUDE.md says "start with the 15–20 most-mentioned buildings".** The list now has 143.
   Either the compare feature covers more buildings than have team-written pages, or we narrow it.

## Phase 2: database (built)

Migrations `20261105120000_add_building_slug.sql` and `20261105120100_create_building_specs.sql`,
test `supabase/tests/06_building_specs.test.sql`, fictional specs for 3 sample buildings in
`seed.sql`. Simplified shape:

```sql
alter table public.buildings add column slug text unique;

create table public.building_specs (
  building_id bigint primary key references public.buildings on delete cascade,
  specs jsonb not null default '{}' check (jsonb_typeof(specs) = 'object'),
  catalog_version smallint not null,
  scraped_at date not null
);
alter table public.building_specs enable row level security;
create policy "building specs are readable by logged-in users"
  on public.building_specs for select to authenticated using (true);
```

Why a separate table instead of more columns on `buildings`: the scraper owns it and can replace
it wholesale without touching team-written summaries, and new fields don't need migrations. The
catalog does the validating that column types would otherwise do (a check constraint still makes
sure every field is `{"value": ...}`). `build --sql [--with-buildings]` writes
`output/specs/building_specs.sql`, matched on `slug`.

## Phase 3: compare page (first version built 2026-11-12)

- Route `/compare?b=slug1,slug2,slug3`, so a comparison can be shared as a link. Up to 3 columns
  on desktop, 2 on phones.
- "Compare" checkbox on each card in `BuildingsPage`, with a tray at the bottom
  ("2 selected · Compare").
- Sticky header row: building name + a dropdown to swap it.
- Sections and rows come from the catalog, in catalog order. Unknown shows "—". Where `better` is
  set, the best value gets a subtle highlight. A "Show only differences" toggle.
- Footnote numbers link to each value's source; unverified values (if ever shown) get a marker.
- Catalog shipped to the app as a JSON import (single source of truth).

Built: `src/pages/ComparePage.tsx`, `src/lib/compare.ts` (formatting, best value, differences),
the checkboxes and tray in `BuildingsPage`, and a "Compare with other buildings" link on building
pages. The picker offers every building that has a `building_specs` row, so the loaded SQL decides
gap 2. Off-campus rent shows "—" until gap 1 is decided. Footnote titles mirror `SOURCES` in
`building_specs.py`. Seed: Back Bay Towers (sample) uses every value type.

Layout (revised 2026-11-12, modeled on apple.com/iphone/compare): a centered title; bordered
dropdowns with a "From $X/mo per person" headline; an "At a glance" section with large rent and walk
figures plus laundry, A/C and nearest T with icons; then one section per catalog section with no
row-label lines. Each value has a grey caption naming it, and yes/no fields read as phrases
("No elevator"). The best value gets a small green label (Lowest, Closest, Newest, Fewest).
Field notes sit under their section, and a compact bar of building names stays at the top while
scrolling.

## Next steps

- [ ] Run `python3 building_specs.py all` for all 143 buildings (~1.5–2 h first time, cached after).
- [ ] Fix the issues `manual_todo.csv` lists in `nusublet_buildings.json` (addresses, wrong URLs).
- [ ] Review `review.csv`; record checks/corrections in `data/overrides.csv`.
- [ ] Decide gaps 1–4 above.
- [x] CLAUDE.md updated; phase 2 built.
- [ ] Load the reviewed data (`build --sql`) and check the compare page with real data.
- [x] Phase 3 first version (seed data).
