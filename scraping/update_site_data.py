"""Collect building data and format it for the website, in one command.

Runs building_specs.py end to end (fetch -> extract -> build) for every building in
oasis-fall-26/nusublet_buildings.json and writes one SQL file that the website reads from:

  public.buildings       adds missing buildings and fills empty building page columns
                         (walk time, rent, laundry, heat/AC, management, amenities, sources)
  public.building_specs  the comparison table data, replaced on every load

Only verified values go into the SQL. Nothing is written to Supabase: review the output, then
load output/specs/building_specs.sql yourself (see the steps printed at the end).

    python3 update_site_data.py                     # first run ~30 min, cached after
    python3 update_site_data.py --offline           # reuse saved pages, don't fetch sites
    python3 update_site_data.py --only van-ness,lightview
    python3 update_site_data.py --skip-open-data    # fast: no city data, walk times, nearby places
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import boston_open_data as city
import building_specs as specs


def count_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with open(path, newline="", encoding="utf-8") as f:
        return max(sum(1 for _ in csv.reader(f)) - 1, 0)


def report(dataset: specs.Row, catalog: dict[str, specs.Row], sql_path: Path) -> None:
    loaded = [b for b in dataset["buildings"] if b["specs"]]
    pages = [specs.page_columns(b["specs"], catalog) for b in loaded]
    with open(specs.OUT / "review.csv", newline="", encoding="utf-8") as f:
        unverified = sum(1 for r in csv.DictReader(f) if r["status"] == "unverified")
    todo = count_rows(specs.OUT / "manual_todo.csv")

    print("\n" + "=" * 70)
    print(f"Ready for the website: {len(loaded)} buildings")
    print(f"  SQL to load:   {sql_path}")
    print(f"  Compare data:  {specs.OUT / 'buildings_compare.json'}")
    print("\nBuilding page columns this will fill (only where still empty):")
    for column in specs.PAGE_COLUMNS:
        print(f"  {sum(1 for p in pages if p.get(column)):4d}  {column}")
    print("\nBefore loading:")
    print(f"  1. Skim output/specs/review.csv ({unverified} unverified values are left out "
          "until someone checks them)")
    print(f"  2. Check output/specs/manual_todo.csv ({todo} rows: pages that couldn't be "
          "fetched, addresses that didn't match)")
    print("  3. Record fixes in data/overrides.csv, then rerun with --offline (fast)")
    print("\nTo load:")
    print("  local:       psql postgresql://postgres:postgres@127.0.0.1:54322/postgres "
          f"-f {sql_path.relative_to(specs.HERE)}")
    print("               (or paste it into Studio's SQL editor at http://127.0.0.1:54323)")
    print("  production:  paste it into the Supabase dashboard's SQL editor")
    print("The last query in the file lists buildings that didn't load.")


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n", maxsplit=1)[0])
    parser.add_argument("--input", default=specs.DEFAULT_INPUT, type=Path,
                        help="building list (default: oasis-fall-26/nusublet_buildings.json)")
    parser.add_argument("--only", help="comma-separated building ids")
    parser.add_argument("--offline", action="store_true",
                        help="don't fetch websites; use pages saved by an earlier run")
    parser.add_argument("--refresh", action="store_true", help="fetch every page again")
    parser.add_argument("--skip-open-data", action="store_true",
                        help="skip Boston open data, walk times and nearby places")
    args = parser.parse_args()
    if args.offline and args.refresh:
        parser.error("--offline and --refresh can't be used together")
    city.load_env(specs.HERE / ".env")

    only = {s.strip() for s in args.only.split(",")} if args.only else None
    all_buildings = specs.load_buildings(args.input, None)
    buildings = specs.load_buildings(args.input, only)
    if not buildings:
        sys.exit(f"no buildings matched --only {args.only}")

    steps = ["extract", "build"] if args.offline else ["fetch", "extract", "build"]
    for i, step in enumerate(steps, 1):
        print(f"\n[{i}/{len(steps)}] {step} ({len(buildings)} buildings)", file=sys.stderr)
        if step == "fetch":
            specs.cmd_fetch(buildings, args.refresh)
        elif step == "extract":
            specs.cmd_extract(buildings, all_buildings, args.skip_open_data)
    dataset = specs.cmd_build(buildings, include_unverified=False)
    specs.write_sql(dataset, buildings, with_buildings=True)

    catalog = specs.load_catalog()
    report(dataset, catalog, specs.OUT / "building_specs.sql")
    if args.skip_open_data:
        print("\nNote: --skip-open-data was used, so walk times, nearby places and city records "
              "are missing.")


if __name__ == "__main__":
    main()
