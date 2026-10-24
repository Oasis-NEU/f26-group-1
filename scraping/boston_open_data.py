"""Pull public data for each building in buildings.csv.

For every address it looks up:
  - SAM addresses       -> coordinates and parcel id (ranges like "8-16 Stoneholm St" included)
  - Property assessment -> building type, size, year built, heat/AC, owner (companies only)
  - 311 requests        -> pest, heat and living-condition complaints (2024 onward)
  - Building violations -> ISD violations since 2021
  - Building permits    -> renovations and other work since 2021
  - OSRM foot routing   -> walk time to Curry Student Center and to the nearby places below
  - MBTA                -> subway and Green Line stations nearby
  - OpenStreetMap       -> laundromats, supermarkets and pharmacies nearby
  - Bluebikes           -> nearest bike-share dock

Writes output/buildings_enriched.json (full detail), output/buildings_enriched.csv
(one row per building, for the team sheet) and output/buildings_draft.sql (rows
shaped like public.buildings, to review before copying into seed.sql).

Standard library only:  python3 boston_open_data.py [--input buildings.csv]
Optional: MBTA_API_KEY in scraping/.env (free) raises the MBTA rate limit.
"""

import argparse
import csv
import hashlib
import json
import math
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

Row = dict[str, Any]

HERE = Path(__file__).parent
USER_AGENT = "NUSublet-scraper/0.1 (Northeastern student club project)"
CKAN_SQL = "https://data.boston.gov/api/3/action/datastore_search_sql"
OSRM_FOOT = "https://routing.openstreetmap.de/routed-foot/route/v1/foot"
MBTA_STOPS = "https://api-v3.mbta.com/stops"
OVERPASS = "https://overpass-api.de/api/interpreter"
BLUEBIKES = "https://gbfs.lyft.com/gbfs/1.1/bos/en/station_information.json"

# Curry Student Center, 346 Huntington Ave (from SAM).
CAMPUS = (-71.087983, 42.339691)

SAM = "6d6cfc99-6f26-4974-bbb3-17b5dbad49a9"
ASSESSMENT = "ee73430d-96c0-423e-ad21-c4cfb54c8961"  # FY2026
VIOLATIONS = "800a2663-1d6a-46e7-9356-bedb70f5332c"
PERMITS = "6ddcd912-32a0-43df-9908-63574f8c7e77"
# Housing complaints still go through the legacy 311 system, one resource per year.
# Add the new year's resource id here each January.
REQUESTS_311 = {
    "2024": "dff4d804-5031-443a-8409-8344efd0e5c8",
    "2025": "9d7c2214-4709-478a-a2e8-fb2020a5bb94",
    "2026": "1a0b420d-99f1-4887-9851-990b2a5a6e17",
}
VIOLATIONS_SINCE = "2021-01-01"
PERMITS_SINCE = "2021-01-01"

# 311 types grouped into the topics building pages talk about.
COMPLAINT_TOPICS = {
    "pests": ["Pest Infestation - Residential", "Bed Bugs"],
    "rodents_outdoor": ["Rodent Activity"],  # mostly trash/street sightings
    "heat": ["Heat - Excessive  Insufficient"],  # two spaces is the city's spelling
    "living_conditions": [
        "Unsatisfactory Living Conditions",
        "Squalid Living Conditions",
        "Chronic Dampness/Mold",
        "Poor Conditions of Property",
    ],
}

# Permit work types that change what living there is like (vs. routine electrical/plumbing).
RENOVATION_WORK = {"INTREN", "INTEXT", "EXTREN", "ROOF", "ADDITION", "INTDEM", "INSUL"}
NOTABLE_PERMIT_VALUE = 25_000  # dollars; smaller jobs are listed in the counts only

NEARBY_RADIUS_M = 1000  # search radius for T stations, shops and docks
# A shop=laundry in OpenStreetMap is often a dry cleaner; skip names like these.
NOT_A_LAUNDROMAT = re.compile(r"clean|dry|tailor|alteration", re.IGNORECASE)

SOURCES = [
    {"title": "City of Boston Property Assessment FY2026",
     "url": "https://data.boston.gov/dataset/property-assessment"},
    {"title": "Boston 311 Service Requests",
     "url": "https://data.boston.gov/dataset/311-service-requests"},
    {"title": "Boston Building and Property Violations",
     "url": "https://data.boston.gov/dataset/building-and-property-violations1"},
    {"title": "Boston Approved Building Permits",
     "url": "https://data.boston.gov/dataset/approved-building-permits"},
    {"title": "MBTA V3 API", "url": "https://www.mbta.com/developers/v3-api"},
    {"title": "© OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright"},
    {"title": "Bluebikes system data", "url": "https://bluebikes.com/system-data"},
]

# Assessment land uses that describe individual condo units, not the building.
CONDO_UNIT_USES = {"CD", "CP"}
# Owners of record are often private individuals; only report companies and trusts.
ENTITY_WORDS = re.compile(
    r"\b(LLC|L\.L\.C|INC|CORP|CORPORATION|LP|LTD|TRUST|TR|REALTY|PROPERTIES|"
    r"PROPERTY|PARTNERS|ASSOC|ASSOCIATES|HOLDINGS|MANAGEMENT|MGMT|CO|COMPANY|"
    r"APARTMENTS|HOUSING|LEASEHOLD|UNIVERSITY|COLLEGE)\b"
)

CACHE = HERE / "output" / "cache"

# python.org installs on macOS ship without root certificates; fall back to the system bundle.
_default_cafile = ssl.get_default_verify_paths().cafile
SSL_CONTEXT = ssl.create_default_context(
    cafile=None if _default_cafile and os.path.exists(_default_cafile)
    else "/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None
)


class _StripDefaultPort(urllib.request.HTTPRedirectHandler):
    """data.boston.gov downloads redirect to signed S3 URLs written as 's3.amazonaws.com:443'.
    Python sends that port in the Host header, which breaks the signature (403)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return super().redirect_request(req, fp, code, msg, headers,
                                        newurl.replace(":443/", "/", 1))


_OPENER = urllib.request.build_opener(_StripDefaultPort,
                                      urllib.request.HTTPSHandler(context=SSL_CONTEXT))


def load_env(path: Path) -> None:
    """Minimal .env reader so the scripts need no packages."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def fetch_json(url: str, headers: dict[str, str] | None = None) -> Any:
    """GET a URL as JSON, cached on disk so reruns don't hit the APIs again.

    Retries rate limits (429) and server hiccups (5xx), which free APIs like
    Overpass and MBTA return under load.
    """
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest()[:24] + ".json")
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    for attempt in range(4):
        try:
            with _OPENER.open(req, timeout=60) as resp:
                data = json.load(resp)
            break
        except urllib.error.HTTPError as err:
            if (err.code != 429 and err.code < 500) or attempt == 3:
                raise
            wait = int(err.headers.get("Retry-After") or 0) or 20 * (attempt + 1)
            print(f"    ({urllib.parse.urlparse(url).netloc} returned {err.code}; "
                  f"retrying in {wait}s)", file=sys.stderr)
            time.sleep(wait)
    path.write_text(json.dumps(data), encoding="utf-8")
    time.sleep(0.5)  # be polite to free public services
    return data


def sql(query: str) -> list[Row]:
    """Run a read-only query against data.boston.gov's CKAN datastore."""
    data = fetch_json(CKAN_SQL + "?" + urllib.parse.urlencode({"sql": query}))
    if not data.get("success"):
        raise RuntimeError(f"data.boston.gov query failed: {data.get('error')}\n{query}")
    return data["result"]["records"]


def q(value: object) -> str:
    """Quote a string literal for the CKAN SQL endpoint."""
    return "'" + str(value).replace("'", "''") + "'"


SAM_COLUMNS = ('"FULL_ADDRESS", "FULL_STREET_NAME", "STREET_BODY", "IS_RANGE", '
               '"RANGE_FROM", "RANGE_TO", "PARCEL_ID", "POINT_X", "POINT_Y"')


def lookup_address(address: str) -> Row | None:
    """Find a building-level SAM address. '12 Stoneholm St' also finds '8-16 Stoneholm St'."""
    rows = sql(
        f'select {SAM_COLUMNS} from "{SAM}" '
        f'where lower("FULL_ADDRESS") = lower({q(address)}) and "UNIT" is null limit 1'
    )
    if rows:
        return rows[0]
    match = re.match(r"\s*(\d+)\s+(.+)", address)
    if not match:
        return None
    number, street = int(match.group(1)), match.group(2)
    ranges = sql(
        f'select {SAM_COLUMNS} from "{SAM}" '
        f'where lower("FULL_STREET_NAME") = lower({q(street)}) '
        f"and \"IS_RANGE\" = '1' and \"UNIT\" is null"
    )
    for r in ranges:
        if r["RANGE_FROM"].isdigit() and r["RANGE_TO"].isdigit():
            if int(r["RANGE_FROM"]) <= number <= int(r["RANGE_TO"]):
                return r
    return None


def street_numbers(sam_row: Row) -> list[str]:
    """Every street number a building answers to, so '8-16' also matches '12' in 311 data."""
    if sam_row["IS_RANGE"] != "1":
        return [sam_row["FULL_ADDRESS"].split(" ", 1)[0]]
    low, high = int(sam_row["RANGE_FROM"]), int(sam_row["RANGE_TO"])
    step = 2 if low % 2 == high % 2 else 1  # Boston ranges usually stay on one side of the street
    return [f"{low}-{high}"] + [str(n) for n in range(low, high + 1, step)]


def describe(code_value: str | None) -> str | None:
    """'W - Ht Water/Steam' -> 'Ht Water/Steam'."""
    if not code_value:
        return None
    return code_value.split(" - ", 1)[-1].strip()


def summarize_assessment(parcel_ids: list[str]) -> Row:
    ids = ", ".join(q(p) for p in parcel_ids)
    rows = sql(
        f'select "PID", "LU", "LU_DESC", "OWNER", "YR_BUILT", '
        f'"HEAT_TYPE", "AC_TYPE", "OVERALL_COND" from "{ASSESSMENT}" '
        f'where "GIS_ID" in ({ids})'
    )
    if not rows:
        return {}
    condo_units = sum(1 for r in rows if r["LU"] == "CD")
    building_rows = [r for r in rows if r["LU"] not in CONDO_UNIT_USES]
    uses = sorted({r["LU_DESC"] for r in building_rows if r["LU"] != "CM" and r["LU_DESC"]})
    if condo_units:
        uses.insert(0, f"{condo_units} residential condo units")

    def most_common(field: str) -> str | None:
        values = [describe(r[field]) for r in rows if r[field]]
        return Counter(values).most_common(1)[0][0] if values else None

    owners = set()
    for r in building_rows:
        owner = " ".join((r["OWNER"] or "").split())
        if owner and ENTITY_WORDS.search(owner):
            owners.add(owner)

    years = [int(r["YR_BUILT"]) for r in rows if (r["YR_BUILT"] or "").isdigit()]
    years = [y for y in years if y > 0]
    return {
        "building_type": "; ".join(uses),
        "year_built": min(years) if years else None,
        "heat_type": most_common("HEAT_TYPE"),
        "ac_type": most_common("AC_TYPE"),
        "overall_condition": most_common("OVERALL_COND"),
        "owner_of_record": sorted(owners),
    }


def count_311(sam_rows: list[Row]) -> Row:
    """Complaint counts per topic per year, matched on exact street address."""
    addresses = {f"{n} {r['FULL_STREET_NAME']}".lower()
                 for r in sam_rows for n in street_numbers(r)}
    names = ", ".join(q(a) for a in sorted(addresses))
    wanted = {t: topic for topic, types in COMPLAINT_TOPICS.items() for t in types}
    types = ", ".join(q(t) for t in wanted)
    counts: dict[str, dict[str, int]] = {topic: {} for topic in COMPLAINT_TOPICS}
    for year, resource in REQUESTS_311.items():
        rows = sql(
            f'select type, count(*) as n from "{resource}" '
            f"where lower(location_street_name) in ({names}) and type in ({types}) "
            f"group by type"
        )
        for r in rows:
            topic = wanted[r["type"]]
            counts[topic][year] = counts[topic].get(year, 0) + int(r["n"])
    return {topic: {"total": sum(by_year.values()), "by_year": by_year}
            for topic, by_year in counts.items()}


def violations(sam_rows: list[Row]) -> Row:
    conditions = " or ".join(
        f"(violation_stno in ({', '.join(q(n) for n in street_numbers(r))}) "
        f"and lower(violation_street) = lower({q(r['STREET_BODY'])}))"
        for r in sam_rows
    )
    rows = sql(
        f'select status_dttm, status, description from "{VIOLATIONS}" '
        f"where ({conditions}) and status_dttm >= {q(VIOLATIONS_SINCE)} "
        f"order by status_dttm desc"
    )
    return {
        "since": VIOLATIONS_SINCE,
        "total": len(rows),
        "open": sum(1 for r in rows if r["status"] == "Open"),
        "by_description": dict(Counter(r["description"] for r in rows).most_common()),
    }


def dollars(value: str | None) -> int:
    """'$44,550.00' -> 44550."""
    digits = re.sub(r"[^\d.]", "", value or "")
    return int(float(digits)) if digits else 0


def permits(parcel_ids: list[str]) -> Row:
    """Permits since PERMITS_SINCE. Applicant names and free-text comments are left out."""
    # The permits dataset drops the parcel id's leading zero.
    ids = ", ".join(q(v) for p in parcel_ids for v in {p, p.lstrip("0")})
    rows = sql(
        f"select worktype, description, declared_valuation, issued_date, status "
        f'from "{PERMITS}" where parcel_id in ({ids}) and issued_date >= {q(PERMITS_SINCE)} '
        f"order by issued_date desc"
    )
    renovations = [r for r in rows if r["worktype"] in RENOVATION_WORK]
    notable = [
        {"date": r["issued_date"][:10], "work": r["description"],
         "declared_value": dollars(r["declared_valuation"])}
        for r in renovations if dollars(r["declared_valuation"]) >= NOTABLE_PERMIT_VALUE
    ]
    return {
        "since": PERMITS_SINCE,
        "total": len(rows),
        "renovation_permits": len(renovations),
        "by_work": dict(Counter(r["description"] for r in rows).most_common()),
        "notable_renovations": notable,
    }


def distance_m(lon1: float, lat1: float, lon2: float, lat2: float) -> int:
    """Straight-line distance in meters (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(6_371_000 * 2 * math.asin(math.sqrt(a)))


def walk_minutes(start: tuple[float, float], end: tuple[float, float] = CAMPUS) -> int | None:
    """Walking time along streets, from OSRM's foot profile. Points are (lon, lat)."""
    coords = f"{start[0]},{start[1]};{end[0]},{end[1]}"
    data = fetch_json(f"{OSRM_FOOT}/{coords}?overview=false")
    if data.get("code") != "Ok":
        return None
    return round(data["routes"][0]["duration"] / 60)


def nearby_stations(lon: float, lat: float) -> list[Row]:
    """Subway and Green Line stations within NEARBY_RADIUS_M, nearest first."""
    params = {
        "filter[latitude]": lat, "filter[longitude]": lon,
        "filter[radius]": NEARBY_RADIUS_M / 111_000 * 1.5,  # degrees; trimmed by distance below
        "filter[route_type]": "0,1", "include": "parent_station",
    }
    key = os.environ.get("MBTA_API_KEY")
    data = fetch_json(MBTA_STOPS + "?" + urllib.parse.urlencode(params),
                      headers={"x-api-key": key} if key else None)
    names = {i["id"]: i["attributes"]["name"] for i in data.get("included", [])}
    stations: dict[str, Row] = {}
    for stop in data["data"]:
        attrs = stop["attributes"]
        parent = (stop["relationships"].get("parent_station") or {}).get("data") or {}
        station_id = parent.get("id") or stop["id"]
        # "Symphony - Green Line - (E) Heath Street" -> line "Green Line", branch "E"
        parts = (attrs.get("description") or "").split(" - ")
        line = parts[1] if len(parts) > 1 else ""
        branches = re.findall(r"\(([A-E])\)", attrs.get("description") or "")
        station = stations.setdefault(station_id, {
            "name": names.get(station_id, attrs["name"]), "lines": set(), "branches": set(),
            "lon": attrs["longitude"], "lat": attrs["latitude"],
            "distance_m": distance_m(lon, lat, attrs["longitude"], attrs["latitude"]),
        })
        if line:
            station["lines"].add(line)
        station["branches"].update(branches)
    result = []
    for s in sorted(stations.values(), key=lambda s: s["distance_m"]):
        if s["distance_m"] > NEARBY_RADIUS_M:
            continue
        lines = sorted(s["lines"])
        if "Green Line" in lines and s["branches"]:
            lines[lines.index("Green Line")] = "Green Line " + "/".join(sorted(s["branches"]))
        result.append({"name": s["name"], "lines": ", ".join(lines),
                       "distance_m": s["distance_m"], "lon": s["lon"], "lat": s["lat"]})
    return result


def nearby_places(lon: float, lat: float) -> dict[str, list[Row]]:
    """Laundromats, supermarkets and pharmacies from OpenStreetMap, nearest first."""
    around = f"(around:{NEARBY_RADIUS_M},{lat},{lon})"
    query = (
        "[out:json][timeout:25];("
        f'nwr["shop"="laundry"]{around};'
        f'nwr["shop"="supermarket"]{around};'
        f'nwr["amenity"="pharmacy"]{around};'
        ");out tags center;"
    )
    data = fetch_json(OVERPASS + "?" + urllib.parse.urlencode({"data": query}))
    places: dict[str, list[Row]] = {"laundromats": [], "supermarkets": [], "pharmacies": []}
    for el in data["elements"]:
        tags = el.get("tags", {})
        point = el.get("center", el)
        if "lat" not in point:
            continue
        name = tags.get("name") or tags.get("brand") or "(unnamed)"
        if tags.get("shop") == "laundry":
            if tags.get("self_service") != "yes" and NOT_A_LAUNDROMAT.search(name):
                continue
            kind = "laundromats"
        elif tags.get("shop") == "supermarket":
            kind = "supermarkets"
        else:
            kind = "pharmacies"
        places[kind].append({"name": name, "lon": point["lon"], "lat": point["lat"],
                             "distance_m": distance_m(lon, lat, point["lon"], point["lat"])})
    for found in places.values():
        found.sort(key=lambda p: p["distance_m"])
    return places


def nearest_bluebikes(lon: float, lat: float) -> Row | None:
    stations = fetch_json(BLUEBIKES)["data"]["stations"]
    if not stations:
        return None
    best = min(stations, key=lambda s: distance_m(lon, lat, s["lon"], s["lat"]))
    return {"name": best["name"], "distance_m": distance_m(lon, lat, best["lon"], best["lat"])}


def surroundings(lon: float, lat: float) -> Row:
    """What's within walking distance. Walk minutes are routed for the two nearest T stations
    and the nearest of everything else; the rest only get straight-line distance."""
    result: Row = {"t_stations": nearby_stations(lon, lat), **nearby_places(lon, lat),
                   "bluebikes": nearest_bluebikes(lon, lat)}
    for kind in ("t_stations", "laundromats", "supermarkets", "pharmacies"):
        for place in result[kind][:2 if kind == "t_stations" else 1]:
            place["walk_minutes"] = walk_minutes((lon, lat), (place["lon"], place["lat"]))
        for place in result[kind]:
            del place["lon"], place["lat"]
    return result


def enrich(building: Row) -> Row:
    addresses = [a.strip() for a in building["addresses"].split(";") if a.strip()]
    found: dict[str, Row] = {}  # keyed by SAM address so a range listed twice counts once
    missing = []
    for address in addresses:
        row = lookup_address(address)
        if row:
            found[row["FULL_ADDRESS"]] = row
        else:
            missing.append(address)

    result: Row = {
        "name": building["name"].strip(),
        "neighborhood": building["neighborhood"].strip(),
        "management_company": (building.get("management_company") or "").strip() or None,
        "addresses": addresses,
        "matched_city_addresses": list(found),
        "unmatched_addresses": missing,
    }
    if not found:
        return result

    sam_rows = list(found.values())
    parcel_ids = sorted({r["PARCEL_ID"] for r in sam_rows})
    lon, lat = float(sam_rows[0]["POINT_X"]), float(sam_rows[0]["POINT_Y"])
    result["walk_minutes_to_campus"] = walk_minutes((lon, lat))
    result["assessment"] = summarize_assessment(parcel_ids)
    result["complaints_311"] = count_311(sam_rows)
    result["violations"] = violations(sam_rows)
    result["permits"] = permits(parcel_ids)
    result["nearby"] = surroundings(lon, lat)
    return result


def heat_ac_draft(assessment: Row) -> str | None:
    parts = []
    if assessment.get("heat_type") and assessment["heat_type"] != "None":
        parts.append(f"{assessment['heat_type']} heat")
    if assessment.get("ac_type"):
        parts.append("no central AC" if assessment["ac_type"] == "None" else assessment["ac_type"])
    return "; ".join(parts) or None


def amenities_draft(nearby: Row) -> list[str]:
    """Factual amenity lines for buildings.amenities; the team adds in-building ones."""
    lines = []
    for station in nearby.get("t_stations", [])[:2]:
        walk = station.get("walk_minutes")
        when = f"{walk} min walk" if walk is not None else f"{station['distance_m']} m"
        lines.append(f"{station['name']} T ({station['lines']}), {when}")
    for kind, label, max_minutes in (("laundromats", "Laundromat", 10),
                                     ("supermarkets", "Supermarket", 15)):
        places = nearby.get(kind, [])
        if places and (places[0].get("walk_minutes") or 99) <= max_minutes:
            lines.append(f"{label} ({places[0]['name']}), {places[0]['walk_minutes']} min walk")
    bike = nearby.get("bluebikes")
    if bike and bike["distance_m"] <= 400:
        lines.append(f"Bluebikes dock {bike['distance_m']} m away")
    return lines


def sql_literal(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return "array[" + ", ".join(q(v) for v in value) + "]::text[]" if value else "'{}'"
    return q(value)


def write_outputs(results: list[Row], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "buildings_enriched.json").write_text(
        json.dumps(results, indent=2) + "\n", encoding="utf-8")

    def nearest(r: Row, kind: str) -> Row:
        places = r.get("nearby", {}).get(kind) or [{}]
        return places[0]

    with open(out_dir / "buildings_enriched.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "name", "neighborhood", "matched_city_addresses", "unmatched_addresses",
            "walk_minutes", "building_type", "year_built", "heat_ac_draft", "owner_of_record",
            "311_pests", "311_rodents_outdoor", "311_heat", "311_living_conditions",
            "violations_since_2021", "violations_open", "permits_since_2021",
            "renovation_permits", "notable_renovations",
            "nearest_t", "nearest_t_walk_min", "nearest_laundromat", "laundromat_walk_min",
            "nearest_supermarket", "supermarket_walk_min", "bluebikes_m", "amenities_draft",
        ])
        for r in results:
            a, c, v = r.get("assessment", {}), r.get("complaints_311", {}), r.get("violations", {})
            p = r.get("permits", {})
            t, laundry, market = (nearest(r, k) for k in ("t_stations", "laundromats",
                                                           "supermarkets"))
            bike = r.get("nearby", {}).get("bluebikes") or {}
            writer.writerow([
                r["name"], r["neighborhood"], "; ".join(r["matched_city_addresses"]),
                "; ".join(r["unmatched_addresses"]), r.get("walk_minutes_to_campus"),
                a.get("building_type"), a.get("year_built"), heat_ac_draft(a),
                "; ".join(a.get("owner_of_record", [])),
                *(c.get(t, {}).get("total") for t in COMPLAINT_TOPICS),
                v.get("total"), v.get("open"), p.get("total"), p.get("renovation_permits"),
                "; ".join(f"{n['date'][:7]} {n['work']} (${n['declared_value']:,})"
                          for n in p.get("notable_renovations", [])),
                f"{t['name']} ({t['lines']})" if t else None, t.get("walk_minutes"),
                laundry.get("name"), laundry.get("walk_minutes"),
                market.get("name"), market.get("walk_minutes"), bike.get("distance_m"),
                "; ".join(amenities_draft(r.get("nearby", {}))),
            ])

    lines = [
        "-- DRAFT generated by scraping/boston_open_data.py. Review before copying into seed.sql:",
        "-- check walk times, fill in rent_range/laundry, add in-building amenities, and write",
        "-- summary in the team's own words. management_company comes from buildings.csv,",
        "-- not the owner of record.",
        "insert into public.buildings (",
        "  name, neighborhood, management_company, walk_minutes_to_campus, heat_ac,",
        "  amenities, sources",
        ")",
        "values",
    ]
    rows = []
    for r in results:
        if not r["matched_city_addresses"]:
            continue
        values = [
            sql_literal(r["name"]),
            sql_literal(r["neighborhood"]),
            sql_literal(r["management_company"]),
            sql_literal(r.get("walk_minutes_to_campus")),
            sql_literal(heat_ac_draft(r.get("assessment", {}))),
            sql_literal(amenities_draft(r.get("nearby", {}))),
            sql_literal(json.dumps(SOURCES)) + "::jsonb",
        ]
        rows.append("  (\n    " + ",\n    ".join(values) + "\n  )")
    lines.append(",\n".join(rows) + ";")
    (out_dir / "buildings_draft.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n", maxsplit=1)[0])
    parser.add_argument("--input", default=HERE / "buildings.csv", type=Path)
    parser.add_argument("--out", default=HERE / "output", type=Path)
    args = parser.parse_args()
    load_env(HERE / ".env")

    with open(args.input, newline="", encoding="utf-8") as f:
        buildings = [b for b in csv.DictReader(f) if (b.get("name") or "").strip()]

    results = []
    for b in buildings:
        print(f"- {b['name']}", file=sys.stderr)
        r = enrich(b)
        for address in r["unmatched_addresses"]:
            print(f"    ! not found in Boston's address list: {address!r} "
                  f"(use the city's spelling, e.g. '409 Huntington Ave')", file=sys.stderr)
        results.append(r)

    write_outputs(results, args.out)
    print(f"\nWrote {len(results)} buildings to {args.out}/", file=sys.stderr)


if __name__ == "__main__":
    main()
