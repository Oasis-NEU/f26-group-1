"""Generate a starting list of buildings near campus, shaped like buildings.csv.

There is no public list of "buildings Northeastern students live in", so this builds
candidates from two sources and leaves the choosing to the team (or to reddit_mentions.py):
  - Property assessment -> apartment buildings (7+ units) and condo buildings (10+ units)
  - OpenStreetMap       -> building names ("Kenmore Tower"), which the city records lack
and drops dorms, university-owned buildings and subsidized/elderly housing, which students
can't sublet.

Writes output/candidates.csv: the buildings.csv columns (name, neighborhood, addresses,
aliases, management_company, notes) plus size, owner and distance columns for sorting.
It never overwrites buildings.csv.

  python3 find_candidates.py [--radius 2000] [--min-units 10] [--named-only]
  python3 reddit_mentions.py --input output/candidates.csv   # rank them by Reddit mentions
"""

import argparse
import csv
import re
import sys
import urllib.parse
from pathlib import Path

from boston_open_data import (ASSESSMENT, CAMPUS, CONDO_UNIT_USES, ENTITY_WORDS, HERE,
                              OVERPASS, SAM, Row, distance_m, fetch_json, lookup_address, q, sql)

NEIGHBORHOODS = (
    "https://data.boston.gov/dataset/bf1a7b50-4c72-4637-b0fa-11d632e3aff1/resource/"
    "e5849875-a6f6-4c9c-9d8a-5048b0fbd03e/download/boston_neighborhood_boundaries.geojson"
)
# ZIP codes that touch a 2-3 km circle around campus; the radius does the real filtering.
NEARBY_ZIPS = ["02115", "02120", "02215", "02118", "02116", "02119", "02130", "02199"]

# Assessment size classes for rentals, with a rough unit count for sorting.
APARTMENT_CLASSES = {"APT 7-30 UNITS": 15, "APT 31-99 UNITS": 60, "APT 100+ UNITS": 150,
                     "LUXURY APARTMENT": 100}
# Apartment and mixed-use rows have no unit count; estimate one from living area instead.
RENTAL_USES = set(APARTMENT_CLASSES) | {"RES /COMMERCIAL USE"}
SQFT_PER_UNIT = 850
EXCLUDED_USES = re.compile(r"SUBSD|DORM|ELDERLY|LODGING|ROOMING|NURSING", re.IGNORECASE)
INSTITUTION_OWNERS = re.compile(
    r"NORTHEASTERN|UNIVERSITY|COLLEGE|CONSERVATORY|BERKLEE|INSTITUTE|SCHOOL|"
    r"HOUSING AUTH|PRESIDENT AND FELLOWS|TRUSTEES OF",
    re.IGNORECASE,
)
INSTITUTION_OPERATORS = re.compile(r"university|college|conservatory|institute|school",
                                   re.IGNORECASE)

# OpenStreetMap spells street types out; the city's address list abbreviates them.
STREET_TYPES = {"avenue": "Ave", "street": "St", "road": "Rd", "place": "Pl",
                "terrace": "Ter", "court": "Ct", "square": "Sq", "boulevard": "Blvd",
                "parkway": "Pkwy", "lane": "Ln", "drive": "Dr", "way": "Way", "park": "Park",
                "east": "E", "west": "W", "north": "N", "south": "S"}
PLACE_BY_POINT_M = 60  # OSM buildings without an address match the nearest parcel this close
# "Landmark Square Apartments" is "Landmark Square" on Reddit; the short form becomes an alias.
NAME_SUFFIX = re.compile(r"\s+(luxury\s+)?(apartments|condominiums?|condos|residences|lofts)$",
                         re.IGNORECASE)


def chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """Ray casting: count how many polygon edges a ray from the point crosses."""
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def neighborhood_finder() -> "callable[[float, float], str]":
    features = fetch_json(NEIGHBORHOODS)["features"]

    def find(lon: float, lat: float) -> str:
        for f in features:
            geometry = f["geometry"]
            polygons = (geometry["coordinates"] if geometry["type"] == "MultiPolygon"
                        else [geometry["coordinates"]])
            for outer, *holes in polygons:
                if point_in_ring(lon, lat, outer) and not any(
                        point_in_ring(lon, lat, h) for h in holes):
                    return str(f["properties"]["name"])
        return ""

    return find


def summarize_parcel(rows: list[Row]) -> Row:
    """Unit estimate, size labels and company owners for one parcel's assessment rows."""
    units, size = 0, set()
    condo_units = sum(1 for r in rows if r["LU"] == "CD")
    for r in rows:
        if r["LU"] == "CM" and (r["RES_UNITS"] or "").isdigit():
            condo_units = max(condo_units, int(r["RES_UNITS"]))
        elif r["LU_DESC"] in RENTAL_USES:
            area = int(r["LIVING_AREA"]) if (r["LIVING_AREA"] or "").isdigit() else 0
            by_area = round(area / SQFT_PER_UNIT)
            units = max(units, by_area or APARTMENT_CLASSES.get(r["LU_DESC"], 0))
            label = ("Mixed residential/commercial" if r["LU_DESC"] == "RES /COMMERCIAL USE"
                     else r["LU_DESC"].title().replace("Apt", "Apartments"))
            size.add(f"{label} (~{by_area} units by floor area)" if by_area else label)
    if condo_units > 1:
        size.add(f"{condo_units} condo units")
    # Condo unit owners are private individuals; keep building-level company owners only.
    owners = {" ".join(r["OWNER"].split()) for r in rows
              if r["LU"] not in CONDO_UNIT_USES | {"CM"} and r["OWNER"]
              and ENTITY_WORDS.search(r["OWNER"])}
    return {"rows": rows, "units": max(units, condo_units), "size": size, "owners": owners}


def assessment_rows(where: str) -> dict[str, list[Row]]:
    rows = sql(
        f'select "GIS_ID", "LU", "LU_DESC", "OWNER", "RES_UNITS", "LIVING_AREA" '
        f'from "{ASSESSMENT}" '
        f"where {where}"
    )
    by_parcel: dict[str, list[Row]] = {}
    for r in rows:
        by_parcel.setdefault(r["GIS_ID"], []).append(r)
    return by_parcel


def assessment_parcels(min_units: int) -> dict[str, Row]:
    """Rental-sized parcels near campus, keyed by parcel id, before exclusions."""
    zips = ", ".join(q(z) for z in NEARBY_ZIPS)
    by_parcel = assessment_rows(f"\"ZIP_CODE\" in ({zips}) and \"LU\" in ('A', 'CM', 'RC')")
    parcels = {pid: summarize_parcel(rows) for pid, rows in by_parcel.items()}
    return {pid: p for pid, p in parcels.items() if p["units"] >= min_units}


def excluded(rows: list[Row]) -> str | None:
    """Why a parcel isn't something students sublet, or None if it's fine."""
    for r in rows:
        if EXCLUDED_USES.search(r["LU_DESC"] or ""):
            return r["LU_DESC"]
        if r["LU"] == "E":
            return "tax-exempt (institutional)"
        if INSTITUTION_OWNERS.search(r["OWNER"] or ""):
            return f"owned by {r['OWNER']}"
    return None


def osm_named_buildings(radius: int) -> list[Row]:
    lon, lat = CAMPUS
    query = (
        f"[out:json][timeout:60];"
        f'nwr["building"~"^(apartments|residential)$"]["name"](around:{radius},{lat},{lon});'
        f"out tags center;"
    )
    data = fetch_json(OVERPASS + "?" + urllib.parse.urlencode({"data": query}))
    buildings = []
    for el in data["elements"]:
        tags = el.get("tags", {})
        point = el.get("center", el)
        if "lat" not in point or INSTITUTION_OPERATORS.search(tags.get("operator", "")):
            continue
        buildings.append({"name": tags["name"], "lon": point["lon"], "lat": point["lat"],
                          "housenumber": tags.get("addr:housenumber", ""),
                          "street": tags.get("addr:street", "")})
    return buildings


def osm_address(building: Row) -> str | None:
    """'650' + 'Huntington Avenue' -> '650 Huntington Ave'. For '81;83' or '486-490' it uses
    the first number; lookup_address finds the range it belongs to."""
    number = re.split(r"[;,\-]", building["housenumber"])[0].strip()
    street = building["street"].strip()
    if not number or not street:
        return None
    words = [STREET_TYPES.get(w.lower(), w) if i in (0, len(street.split()) - 1) else w
             for i, w in enumerate(street.split())]
    if words[0] in ("E", "W", "N", "S") and len(words) == 1:
        words = street.split()  # a street literally named "East"
    return f"{number} {' '.join(words)}"


def sam_addresses(parcel_ids: list[str]) -> dict[str, list[Row]]:
    """Building-level city addresses (with coordinates) for each parcel."""
    by_parcel: dict[str, list[Row]] = {}
    for batch in chunks(sorted(parcel_ids), 100):
        rows = sql(
            f'select "PARCEL_ID", "FULL_ADDRESS", "POINT_X", "POINT_Y" from "{SAM}" '
            f'where "PARCEL_ID" in ({", ".join(q(p) for p in batch)}) and "UNIT" is null'
        )
        for r in rows:
            by_parcel.setdefault(r["PARCEL_ID"], []).append(r)
    return by_parcel


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n", maxsplit=1)[0])
    parser.add_argument("--radius", type=int, default=2000,
                        help="max straight-line meters from Curry Student Center (default 2000)")
    parser.add_argument("--min-units", type=int, default=10,
                        help="skip unnamed buildings smaller than this (default 10)")
    parser.add_argument("--named-only", action="store_true",
                        help="only buildings with an OpenStreetMap name")
    parser.add_argument("--out", default=HERE / "output" / "candidates.csv", type=Path)
    args = parser.parse_args()

    print("Loading city property records...", file=sys.stderr)
    parcels = assessment_parcels(args.min_units)
    names: dict[str, str] = {}  # parcel id -> OpenStreetMap name

    print("Loading OpenStreetMap building names...", file=sys.stderr)
    primary: dict[str, str] = {}  # parcel id -> the address OSM gives (listed first)
    unplaced = []
    for b in osm_named_buildings(args.radius):
        address = osm_address(b)
        match = lookup_address(address) if address else None
        if match:
            names.setdefault(match["PARCEL_ID"], b["name"])
            primary.setdefault(match["PARCEL_ID"], match["FULL_ADDRESS"])
        else:
            unplaced.append(b)

    # Named buildings below the size cutoff (or outside the assessment query) still count.
    missing = [p for p in names if p not in parcels]
    for batch in chunks(missing, 100):
        found = assessment_rows(f'"GIS_ID" in ({", ".join(q(p) for p in batch)})')
        parcels.update({pid: summarize_parcel(rows) for pid, rows in found.items()})

    print("Looking up addresses and neighborhoods...", file=sys.stderr)
    addresses = sam_addresses(list(parcels))
    neighborhood_of = neighborhood_finder()

    # OSM names with no usable address: take the nearest candidate building, if close.
    points = [(pid, float(a["POINT_X"]), float(a["POINT_Y"]))
              for pid, rows in addresses.items() for a in rows]
    for b in unplaced:
        dist, pid = min(((distance_m(b["lon"], b["lat"], x, y), pid) for pid, x, y in points),
                        default=(PLACE_BY_POINT_M + 1, ""))
        if dist <= PLACE_BY_POINT_M and pid not in names:
            names[pid] = b["name"]
        else:
            print(f"    ? couldn't place {b['name']!r} "
                  f"({osm_address(b) or 'no address'}); probably small, subsidized or a dorm",
                  file=sys.stderr)

    candidates: dict[str, Row] = {}  # keyed by name, so a complex on several parcels merges
    skipped = 0
    for pid, parcel in parcels.items():
        reason = excluded(parcel["rows"])
        if reason or pid not in addresses:
            skipped += 1
            continue
        if args.named_only and pid not in names:
            continue
        sam = addresses[pid]
        lon, lat = float(sam[0]["POINT_X"]), float(sam[0]["POINT_Y"])
        distance = distance_m(lon, lat, *CAMPUS)
        if distance > args.radius:
            continue
        name = names.get(pid) or sam[0]["FULL_ADDRESS"]
        c = candidates.setdefault(name, {
            "name": name, "neighborhood": neighborhood_of(lon, lat), "addresses": [],
            "aliases": NAME_SUFFIX.sub("", name) if pid in names and NAME_SUFFIX.search(name)
                       else "",
            "management_company": "", "units_estimate": 0, "size": set(),
            "owner_of_record": set(), "distance_m": distance, "parcels": [],
            "named_in_osm": pid in names,
        })
        # reddit_mentions.py only searches the first few addresses, so the known one goes first.
        ordered = sorted((a["FULL_ADDRESS"] for a in sam),
                         key=lambda a: a != primary.get(pid))
        c["addresses"] += [a for a in ordered if a not in c["addresses"]]
        c["units_estimate"] += parcel["units"]
        c["size"] |= parcel["size"]
        c["owner_of_record"] |= parcel["owners"]
        c["distance_m"] = min(c["distance_m"], distance)
        c["parcels"].append(pid)

    rows = sorted(candidates.values(),
                  key=lambda c: (not c["named_in_osm"], -c["units_estimate"], c["distance_m"]))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    columns = ["name", "neighborhood", "addresses", "aliases", "management_company", "notes",
               "named_in_osm", "units_estimate", "size", "owner_of_record", "distance_m",
               "parcels"]
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for c in rows:
            writer.writerow({
                **c,
                "addresses": "; ".join(c["addresses"]),
                "notes": "auto-generated by find_candidates.py",
                "size": "; ".join(sorted(c["size"])),
                "owner_of_record": "; ".join(sorted(c["owner_of_record"])),
                "parcels": "; ".join(c["parcels"]),
            })
    named = sum(1 for c in rows if c["named_in_osm"])
    print(f"\nWrote {len(rows)} candidates ({named} with names) to {args.out}; "
          f"skipped {skipped} dorm/university/subsidized parcels.", file=sys.stderr)


if __name__ == "__main__":
    main()
