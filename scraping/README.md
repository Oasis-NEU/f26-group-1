# Building data collection

Scripts that gather public data for the building info pages (`public.buildings`).
Nothing here runs in the app. Output is a draft the team reviews before it goes into `seed.sql`.

## Workflow

1. `find_candidates.py` builds a long list of rental buildings near campus.
2. `reddit_mentions.py --input output/candidates_50.csv` ranks them by how often students mention them (needs Reddit API access).
3. The team picks 15–20, fixes names/aliases, and copies those rows into `buildings.csv`.
4. `boston_open_data.py` fills in city data, walk times and nearby amenities for those buildings.
5. The team reads the Reddit threads and reviews, writes summaries, and moves the reviewed SQL into `seed.sql`.

## Candidate list (`find_candidates.py`)

No public list of "buildings Northeastern students live in" exists, so this builds one from:

- **City property records**: apartment buildings (7+ units), mixed-use buildings, and condo buildings within 2 km of Curry Student Center. Apartment and mixed-use records have no unit count, so units are estimated from living area (~850 sq ft per unit).
- **OpenStreetMap**: building names ("Kenmore Tower", "The Harlo"), which city records don't have. A name ending in "Apartments", "Condominiums" and similar also gets a short alias ("Landmark Square").

It drops dorms, university-owned buildings, and housing the city codes as subsidized or elderly. Everything near campus is included, not just student-heavy buildings.

```sh
python3 find_candidates.py                                    # ~735 buildings, 10+ units
python3 find_candidates.py --min-units 50 --out output/candidates_50.csv   # ~160, for the Reddit ranking
python3 find_candidates.py --named-only                       # ~58 named buildings only
```

`output/candidates.csv` has the `buildings.csv` columns plus `named_in_osm`, `units_estimate`, `size`, `owner_of_record` (companies only), `distance_m` and `parcels`. Named buildings come first, then the rest by size. It never overwrites `buildings.csv`.

**Before using the list:**
- Affordable housing that the city doesn't code as subsidized slips through: co-ops, nonprofit and tax-credit developments such as Tent City, Methunion Manor and Madison Melnea Cass. Remove anything students can't rent.
- Mission Hill is underrepresented. Most student housing there is triple-deckers and 4–6 unit buildings, which are below the size cutoff and have no names. Consider pages per street or block for Mission Hill instead of per building.
- Names come from OpenStreetMap volunteers. Check them, and add the names students actually use as `aliases`.
- A name that's also a street ("Van Ness") will match any mention of the street on Reddit.

## Boston open data (`boston_open_data.py`)

Needs Python 3.10+ and nothing else (standard library only). No API keys required; an optional
free `MBTA_API_KEY` in `.env` (see `.env.example`) speeds up long lists. The first run takes
about 30–40 seconds per building; reruns use the cache and finish instantly.

```sh
cd scraping
python3 boston_open_data.py
```

### Input: `buildings.csv`

One row per building or complex. The `EXAMPLE` rows are placeholders; replace them with the team's list.

| Column | Notes |
|---|---|
| `name` | What students call it. |
| `neighborhood` | Fenway, Mission Hill, etc. Should match the neighborhood names listings use. |
| `addresses` | Street addresses separated by `;`. Use the city's spelling: `409 Huntington Ave`, not `409 Huntington Avenue`. A number inside a range works (`12 Stoneholm St` finds `8-16 Stoneholm St`). Complexes with several buildings need every address. |
| `aliases` | Other names students use on Reddit, separated by `;` (only used by the Reddit script). Avoid short or generic words; every alias is a search term. |
| `management_company` | Fill in by hand from the company website. The script reports the owner of record, which is often a holding LLC, not the manager. |
| `notes` | Anything. Ignored by the script. |

If an address isn't found, the script prints a warning. Look up the exact spelling at
[Boston's SAM address search](https://data.boston.gov/dataset/live-street-address-management-sam-addresses).

### Output (`output/`, gitignored)

- `buildings_enriched.csv`: one row per building. Paste it into the team sheet.
- `buildings_enriched.json`: everything, including complaints by year and violation types.
- `buildings_draft.sql`: `insert into public.buildings` rows with `name`, `neighborhood`,
  `management_company`, `walk_minutes_to_campus`, `heat_ac`, `amenities` (nearby T, laundromat,
  supermarket, Bluebikes) and `sources`. Review it before copying into `seed.sql`.
  `rent_range`, `laundry` (in-unit or in-building), in-building amenities and `summary` are left for the team.
- `cache/`: saved API responses so reruns are fast. Delete it to fetch fresh data.

### What it pulls

| Field | Source | Read it with care |
|---|---|---|
| Walk minutes | OSRM foot routing (OpenStreetMap) to Curry Student Center | Assumes ~4.5 km/h, which is slightly slow. |
| Building type, year built, heat/AC, condition | [Property Assessment FY2026](https://data.boston.gov/dataset/property-assessment) | Heat/AC is often blank for apartment buildings; the city records it mostly for condos and small houses. |
| Owner of record | Property Assessment | Companies and trusts only. Individual owners are dropped on purpose. |
| 311 complaints, 2024 onward | [311 Service Requests](https://data.boston.gov/dataset/311-service-requests) | Counts, not verdicts. A 120-unit building will have more than a triple-decker. `rodents_outdoor` is mostly trash and street sightings. |
| Violations since 2021 | [Building and Property Violations](https://data.boston.gov/dataset/building-and-property-violations1) | Includes permit and paperwork violations, not just living conditions. |
| Permits since 2021 | [Approved Building Permits](https://data.boston.gov/dataset/approved-building-permits) | Renovations of $25k+ are listed by date. A big condo building pulls permits for individual units, so "renovated" may mean one apartment, not the building. Applicant names are left out. |
| Nearby T stations | [MBTA V3 API](https://www.mbta.com/developers/v3-api) | Subway and Green Line only (no buses), within 1 km. |
| Laundromats, supermarkets, pharmacies | OpenStreetMap via the Overpass API | Only as complete as OpenStreetMap. Some dry cleaners are tagged as laundries; the script skips names with "cleaners" unless they're marked self-service, so check the laundromat name. Credit "© OpenStreetMap contributors" wherever this shows up. |
| Nearest Bluebikes dock | [Bluebikes GBFS feed](https://bluebikes.com/system-data) | Straight-line distance. |

Each January, add the new year's 311 resource id to `REQUESTS_311` in the script. It's listed on the 311 dataset page.

## Reddit mentions (`reddit_mentions.py`)

Searches r/NEU, r/boston and r/bostonhousing for each building's name, aliases and street
addresses (`409 Huntington Ave` is searched as `"409 Huntington"`), reads the comments of every
matching thread, and counts how often each topic comes up. Standard library only.

### Setup (once)

1. Reddit API access must be approved first ([Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)).
2. Logged in as the team Reddit account, create a **script** app at <https://www.reddit.com/prefs/apps>.
3. `cp .env.example .env` and fill in the client id, secret and account username. `.env` is gitignored; never commit it.

### Run

```sh
python3 reddit_mentions.py --dry-run      # print each building's search query, no API calls
python3 reddit_mentions.py                # threads since 2021-01-01
python3 reddit_mentions.py --since 2023-01-01 --no-comments   # faster, misses most mentions
```

A full run makes one request per thread for comments, paced to stay under Reddit's 100
requests/minute. Expect a few minutes for 20 buildings.

### Output (`output/`)

- `reddit_ranking.csv`: buildings ranked by number of threads and comment mentions, with topic
  totals. Use it to pick the 15–20 buildings.
- `reddit_threads.csv`: one row per thread (link, title, date, score, which terms matched, topic
  counts). This is the reading list for writing summaries; thread links go into `sources`.

Topic counts are the number of posts/comments that use a keyword (`mice`, `ghosted`, `thin
walls`, ...). They show where to look, not what the answer is: "no mice at all" still counts
toward pests. Keywords live in `TOPICS` at the top of the script.

The script never saves post or comment text, by design: summaries are written by the team, and
our API access request says we only store links and metadata. Don't add a cache that stores raw
responses.

### Limitations

- Reddit search only covers post titles and bodies. A building mentioned only in the comments of
  a thread about something else won't be found.
- Search is fuzzy, so the script drops any result that doesn't actually contain a search term.
  Generic aliases still cause false positives. Skim `reddit_threads.csv`.

## Rules for building pages (from CLAUDE.md)

- Write `summary` in the team's own words. Never paste Reddit comments or review text.
- Put every Reddit thread, review page and dataset you used in `sources`.
- Street addresses stay in `buildings.csv`. The app shows neighborhood and building name only.
