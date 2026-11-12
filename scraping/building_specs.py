"""Collect comparable specs (cost, rooms, amenities, location, city records) for every
building in nusublet_buildings.json, for the building comparison page.

  python3 building_specs.py fetch      # snapshot official web pages (robots.txt-aware)
  python3 building_specs.py extract    # pages + NU rate chart + Boston open data -> facts
  python3 building_specs.py build      # facts + data/overrides.csv -> clean dataset + review sheets
  python3 building_specs.py build --sql [--with-buildings]   # + SQL to load into Supabase
  python3 building_specs.py all        # the three in order

Common options: --only id1,id2 (a few buildings), --skip-open-data (fast, no city lookups),
--refresh (fetch pages again). Standard library only; city data comes from boston_open_data.py.
Everything is written to output/specs/ (gitignored). The team reviews review.csv, records
corrections in data/overrides.csv, and reruns `build`.
"""

import argparse
import csv
import hashlib
import json
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.robotparser import RobotFileParser

import boston_open_data as city

Row = dict[str, Any]

HERE = Path(__file__).parent
DATA = HERE / "data"
OUT = HERE / "output" / "specs"
PAGES = OUT / "pages"
DEFAULT_INPUT = HERE.parent / "oasis-fall-26" / "nusublet_buildings.json"
CATALOG = DATA / "field_catalog.json"
NU_RATES = DATA / "nu_rates_2026-27.csv"
OVERRIDES = DATA / "overrides.csv"

USER_AGENT = city.USER_AGENT
MIN_DELAY_S = 3.0  # between requests to the same site, unless robots.txt asks for more
MONTHS_PER_SEMESTER = 4  # NU rates are per semester (Sep-Dec, Jan-Apr)

# Listing portals and search sites: their terms forbid automated collection or they block
# bots (403). Never fetch these, even if the building list marks them "official"; the
# team reads them by hand and records values in data/overrides.csv.
NO_FETCH_DOMAINS = {
    "apartments.com", "homes.com", "redfin.com", "zillow.com", "trulia.com",
    "aptsearch.northeastern.edu", "offcampus.bu.edu", "forrent.com", "forrentuniversity.com",
    "bostonpads.com", "uhomes.com", "veryapt.com", "southcoastrealtors.com",
}

NU_RATE_CHARTS = {
    "upperclass_2026_27":
        "https://housing.northeastern.edu/wp-content/uploads/2026/06/Upperclass-Rates-26-27.pdf",
    "first_year_2026_27":
        "https://housing.northeastern.edu/wp-content/uploads/2026/06/First-Year-Rates-26-27.pdf",
}
RATE_YEAR = "2026–27"

SOURCES: dict[str, Row] = {
    "manual": {"title": "Checked by the NUSublet team", "rank": 0},
    "nu_rates": {"title": "Northeastern Undergraduate Housing Rates 2026–2027",
                 "url": "https://housing.northeastern.edu/rates/", "rank": 1},
    "nu_housing": {"title": "Northeastern Housing and Residential Life building pages",
                   "url": "https://housing.northeastern.edu/", "rank": 2},
    "boston_open_data": {"title": "City of Boston open data, MBTA, OpenStreetMap, Bluebikes",
                         "url": "https://data.boston.gov/", "credits": city.SOURCES, "rank": 3},
    "building_list": {"title": "NUSublet building list (nusublet_buildings.json)", "rank": 4},
    "official_site": {"title": "The building's own website (keyword match, needs review)",
                      "rank": 5},
}

KIND = {
    "residence_hall_traditional": "residence_hall", "residence_hall_suite": "residence_hall",
    "residence_hall_apartment": "residence_hall", "complex": "apartment_building",
    "address": "address", "street": "street", "planned": "planned",
}
STYLE = {"residence_hall_traditional": "traditional", "residence_hall_suite": "suite",
         "residence_hall_apartment": "apartment"}
# What the NU rate charts say each style means (quoted in the evidence column).
STYLE_FACTS = {
    "traditional": ({"unit.bathroom": "shared_floor", "unit.kitchen": "none",
                     "cost.meal_plan": "required"},
                    "Traditional Style Halls: Bedrooms with shared floor bathrooms. Meal plan required."),
    "suite": ({"unit.bathroom": "in_suite", "cost.meal_plan": "some"},
              "Suite-Style Halls: Bedrooms with bathroom. Some meal plan required."),
    "apartment": ({"unit.bathroom": "in_unit", "cost.meal_plan": "not_required"},
                  "Apartment Style Halls: Bedrooms with kitchen/kitchenette and bathroom."),
}

# Keyword rules for official websites. Marketing copy is loose, so every match is stored
# as "unverified" with the sentence it came from; the team accepts or fixes it.
KEYWORD_RULES: list[tuple[str, Any, str]] = [
    ("amenities.laundry", "in_unit",
     r"in[- ](unit|home|apartment) (washer|laundry)|washer (and|&) dryer in (every|each|your|all)"),
    ("amenities.laundry", "in_building", r"on[- ]site laundry|laundry (room|facilit|center|lounge)"),
    ("amenities.fitness_center", True, r"fitness (center|studio|room)|\bgym\b"),
    ("amenities.parking", True, r"parking (garage|available|spaces?)|garage parking|covered parking"),
    ("amenities.pets_allowed", True, r"pet[- ]friendly|pets (are )?welcome|dog park|pet (spa|wash)"),
    ("amenities.roof_deck", True, r"roof ?(top|deck)|courtyard"),
    ("amenities.bike_storage", True, r"bike (storage|room)|bicycle (storage|room)"),
    ("amenities.package_room", True, r"package (room|lockers?|concierge)|parcel lockers?"),
    ("amenities.lounge", True, r"(study|resident|residents'?) (lounge|room|space)s?|clubhouse"),
    ("amenities.elevator", True, r"\belevators?\b"),
    ("amenities.security", "staffed_24h",
     r"24[- /]?(hour|hr|7)[^.]{0,20}(concierge|security|doorman|front desk)"),
    ("unit.ac", "central", r"central (air|a/?c\b)"),
    ("unit.furnished", True, r"fully[- ]furnished|furnished (apartments|units|rooms)"),
    ("cost.lease_type", "individual", r"individual lease"),
]


# --------------------------------------------------------------------------- inputs

def load_buildings(path: Path, only: set[str] | None) -> list[Row]:
    buildings = json.loads(path.read_text(encoding="utf-8"))
    seen: set[str] = set()
    for b in buildings:
        if b["id"] in seen:
            sys.exit(f"duplicate building id in {path}: {b['id']}")
        seen.add(b["id"])
        if b.get("type") not in KIND:
            print(f"  ! {b['id']}: unknown type {b.get('type')!r}", file=sys.stderr)
    if only:
        missing = only - seen
        if missing:
            sys.exit(f"--only: not in {path.name}: {', '.join(sorted(missing))}")
        buildings = [b for b in buildings if b["id"] in only]
    return buildings


def load_catalog() -> dict[str, Row]:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    return {f["key"]: {**f, "section": s["key"]} for s in catalog["sections"] for f in s["fields"]}


def domain(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def fact(building: str, field: str, value: Any, source: str, url: str | None = None,
         status: str = "verified", evidence: str | None = None) -> Row:
    return {"building": building, "field": field, "value": value, "source": source,
            "url": url or SOURCES[source].get("url"), "status": status, "evidence": evidence}


# --------------------------------------------------------------------------- fetch

OPENER = urllib.request.build_opener(urllib.request.HTTPSHandler(context=city.SSL_CONTEXT))


def http_get(url: str) -> tuple[int, str, str, bytes]:
    """(status, final_url, content_type, body). HTTP errors are returned, not raised."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"})
    try:
        with OPENER.open(req, timeout=30) as resp:
            return resp.status, resp.geturl(), resp.headers.get("Content-Type", ""), resp.read()
    except urllib.error.HTTPError as err:
        return err.code, url, "", b""


class Robots:
    """robots.txt per site, plus the wait between requests it asks for."""

    def __init__(self) -> None:
        self.parsers: dict[str, RobotFileParser] = {}
        self.last_request: dict[str, float] = {}

    def parser(self, url: str) -> RobotFileParser:
        parts = urllib.parse.urlparse(url)
        site = f"{parts.scheme}://{parts.netloc}"
        if site not in self.parsers:
            rp = RobotFileParser()
            try:
                status, _, _, body = http_get(site + "/robots.txt")
            except (urllib.error.URLError, TimeoutError, OSError):
                status, body = 0, b""
            if status == 200:
                rp.parse(body.decode("utf-8", "replace").splitlines())
            elif status in (401, 403) or status == 0 or status >= 500:
                rp.disallow_all = True  # type: ignore[attr-defined]  # blocked or unreachable: don't guess
            else:
                rp.allow_all = True  # type: ignore[attr-defined]  # 404 etc.: no rules
            self.parsers[site] = rp
        return self.parsers[site]

    def allowed(self, url: str) -> bool:
        return self.parser(url).can_fetch(USER_AGENT, url)

    def wait(self, url: str) -> None:
        site = urllib.parse.urlparse(url).netloc
        delay = max(float(self.parser(url).crawl_delay(USER_AGENT) or 0), MIN_DELAY_S)
        elapsed = time.monotonic() - self.last_request.get(site, -1e9)
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self.last_request[site] = time.monotonic()


def page_path(url: str) -> Path:
    return PAGES / (hashlib.sha256(url.encode()).hexdigest()[:16] + ".html")


def load_page_index() -> Row:
    path = PAGES / "index.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def cmd_fetch(buildings: list[Row], refresh: bool) -> None:
    PAGES.mkdir(parents=True, exist_ok=True)
    index = load_page_index()
    robots = Robots()
    urls: dict[str, list[str]] = defaultdict(list)
    for b in buildings:
        if b.get("website"):
            urls[b["website"]].append(b["id"])

    for url, ids in urls.items():
        entry: Row = {"buildings": ids}
        types = {b["website_type"] for b in buildings if b["id"] in ids}
        site = domain(url)
        if any(site == d or site.endswith("." + d) for d in NO_FETCH_DOMAINS):
            entry["skipped"] = "listing site: read by hand"
        elif "official" not in types:
            entry["skipped"] = f"not the building's own page ({', '.join(sorted(types))})"
        elif not refresh and url in index and index[url].get("status") == 200 \
                and page_path(url).exists():
            index[url]["buildings"] = ids
            continue
        elif not robots.allowed(url):
            entry["skipped"] = "robots.txt disallows"
        else:
            robots.wait(url)
            print(f"- {url}", file=sys.stderr)
            try:
                status, final_url, ctype, body = http_get(url)
            except (urllib.error.URLError, TimeoutError, OSError) as err:
                status, final_url, ctype, body = 0, url, "", b""
                entry["error"] = str(err)
            entry.update(status=status, final_url=final_url,
                         fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
            if domain(final_url) != site:
                entry["skipped"] = f"redirected to another site ({domain(final_url)})"
            elif status != 200 or "html" not in ctype:
                entry["skipped"] = f"HTTP {status} {ctype}".strip()
            else:
                charset = re.search(r"charset=([\w-]+)", ctype)
                page_path(url).write_text(
                    body.decode(charset.group(1) if charset else "utf-8", "replace"),
                    encoding="utf-8")
        if entry.get("skipped"):
            print(f"  skip {url}: {entry['skipped']}", file=sys.stderr)
        index[url] = entry

    (PAGES / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    fetched = sum(1 for e in index.values() if not e.get("skipped"))
    print(f"\n{fetched} pages saved, {len(index) - fetched} skipped -> {PAGES}/", file=sys.stderr)


# --------------------------------------------------------------------------- page parsing

class Blocks(HTMLParser):
    """Visible text as a list of (tag, text) blocks: headings, paragraphs, list items."""

    BLOCK = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "td", "th", "button"}
    SKIP = {"script", "style", "noscript", "svg", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str, str]] = []
        self.jsonld: list[str] = []
        self.tag = "text"
        self.buf: list[str] = []
        self.skip = 0
        self.in_jsonld = False

    def flush(self) -> None:
        text = " ".join("".join(self.buf).split())
        if text:
            self.blocks.append((self.tag, text))
        self.buf, self.tag = [], "text"

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and dict(attrs).get("type") == "application/ld+json":
            self.in_jsonld = True
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.flush()
            self.tag = tag
        elif tag == "br":
            self.buf.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
            self.in_jsonld = False
        elif tag in self.BLOCK:
            self.flush()

    def handle_data(self, data: str) -> None:
        if self.in_jsonld:
            self.jsonld.append(data)
        elif not self.skip:
            self.buf.append(data)


def parse_page(html: str) -> Blocks:
    parser = Blocks()
    parser.feed(html)
    parser.flush()
    return parser


def nu_details(blocks: list[tuple[str, str]]) -> tuple[dict[str, list[str]], str | None]:
    """Northeastern housing pages: the h3 -> values list under 'Building Details', and the
    street address."""
    details: dict[str, list[str]] = {}
    address = None
    in_details, label = False, None
    for i, (tag, text) in enumerate(blocks):
        if tag == "h3" and text == "Address" and address is None and i + 1 < len(blocks):
            address = blocks[i + 1][1].split(",")[0].strip()
        if tag == "h2":
            in_details = text.strip().lower() == "building details"
            label = None
        elif in_details and tag == "h3":
            label = text.strip()
            details[label] = []
        elif in_details and label and tag in ("p", "li"):
            if text.lower().startswith("mailing address"):
                in_details = False  # the details list ends here
            else:
                details[label].append(unescape(text).replace("\xa0", " ").strip())
    return details, address


def yes(values: list[str]) -> bool | None:
    joined = " ".join(values).strip().lower()
    if not joined:
        return None
    return not joined.startswith(("no", "none", "n/a"))


def nu_page_facts(b: Row, url: str, page: Blocks) -> tuple[list[Row], str | None]:
    details, address = nu_details(page.blocks)
    bid = b["id"]
    out: list[Row] = []

    def add(field: str, value: Any, label: str) -> None:
        evidence = f"{label}: {'; '.join(details.get(label, []))}"[:200]
        out.append(fact(bid, field, value, "nu_housing", url, evidence=evidence))

    if details.get("Bedroom Types"):
        add("unit.bedroom_types", details["Bedroom Types"], "Bedroom Types")
    if details.get("Apartment Types"):
        add("unit.apartment_sizes", "; ".join(details["Apartment Types"]), "Apartment Types")
    security = " ".join(details.get("Security", [])).lower()
    if security:
        add("amenities.security", "staffed_24h" if "24" in security else "secured_entry", "Security")
    if "resnet" in " ".join(details.get("Connections", [])).lower():
        add("cost.internet_included", True, "Connections")
    if "Lounges" in details and yes(details["Lounges"]) is not None:
        add("amenities.lounge", yes(details["Lounges"]), "Lounges")
    laundry = " ".join(details.get("Laundry facilities", [])).lower()
    if laundry:
        value = ("in_unit" if re.search(r"in[- ]unit|in each apartment", laundry)
                 else "none" if not yes([laundry]) else "in_building")
        add("amenities.laundry", value, "Laundry facilities")
    for label in details:
        if label.lower() == "elevator" and yes(details[label]) is not None:
            add("amenities.elevator", yes(details[label]), label)
    if details.get("Furniture provided"):
        add("unit.furnished", bool(yes(details["Furniture provided"])), "Furniture provided")
    appliances = [a for a in details.get("Kitchen appliances", []) if yes([a])]
    if appliances:
        add("unit.kitchen_appliances", appliances, "Kitchen appliances")
        full = any(re.search(r"oven|stove|range", a, re.I) for a in appliances)
        add("unit.kitchen", "full" if full else "kitchenette", "Kitchen appliances")
    extra = " ".join(details.get("Additional amenities", [])).lower()
    if "air condition" in extra:
        add("unit.ac", "central" if "central" in extra else "unit", "Additional amenities")
    if re.search(r"dining hall|marketplace", extra):
        add("amenities.dining_in_building", True, "Additional amenities")
    if re.search(r"fitness|\bgym\b", extra):
        add("amenities.fitness_center", True, "Additional amenities")

    text = " ".join(t for _, t in page.blocks)
    stories = [int(n) for n in re.findall(r"\b(\d{1,2})[- ]stor(?:y|ies)\b", text, re.I)]
    if stories:
        out.append(fact(bid, "overview.stories", max(stories), "nu_housing", url,
                        evidence=f"page mentions {', '.join(f'{n}-story' for n in stories)}"))
    return out, address


def keyword_facts(b: Row, url: str, page: Blocks, shared: bool) -> list[Row]:
    out: list[Row] = []
    found: set[str] = set()
    for field, value, pattern in KEYWORD_RULES:
        if field in found:
            continue  # first rule wins (in-unit laundry beats in-building)
        for _, text in page.blocks:
            m = re.search(pattern, text, re.I)
            if m:
                start = max(0, m.start() - 80)
                snippet = ("…" if start else "") + text[start:m.end() + 100].strip()
                if shared:
                    snippet = "[page covers several buildings] " + snippet
                out.append(fact(b["id"], field, value, "official_site", url,
                                status="unverified", evidence=snippet[:240]))
                found.add(field)
                break
    return out


def jsonld_address(page: Blocks) -> str | None:
    for raw in page.jsonld:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                addr = node.get("address")
                if isinstance(addr, dict) and addr.get("streetAddress") and \
                        "boston" in str(addr.get("addressLocality", "")).lower():
                    return str(addr["streetAddress"])
                stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
    return None


# --------------------------------------------------------------------------- NU rate chart

def rate_facts(campus: dict[str, str]) -> list[Row]:
    """NU rates per building. campus maps building id -> on/affiliated/off."""
    by_building: dict[str, list[Row]] = defaultdict(list)
    with open(NU_RATES, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r["building_id"]:
                continue  # leased properties not on the building list yet
            if r["building_id"] not in campus:
                print(f"  ! {NU_RATES.name}: unknown building_id {r['building_id']!r}",
                      file=sys.stderr)
                continue
            by_building[r["building_id"]].append(r)

    out: list[Row] = []
    for bid, rows in by_building.items():
        rates, seen = [], set()
        for r in rows:
            key = (r["chart"], r["style"], r["tier"], r["room_type"], r["semester_usd"])
            if key in seen:
                continue  # e.g. West Village A North and South share a price list
            seen.add(key)
            rates.append({"chart": r["chart"].split("_20")[0], "style": r["style"],
                          "tier": r["tier"], "room_type": r["room_type"],
                          "semester_usd": int(r["semester_usd"]),
                          "accommodation_only": r["accommodation_only"] == "yes"})
        prices = [x["semester_usd"] for x in rates if not x["accommodation_only"]] or \
                 [x["semester_usd"] for x in rates]
        charts = sorted({r["chart"] for r in rows})
        url = NU_RATE_CHARTS[charts[0]]
        names = ", ".join(sorted({r["chart_name"] for r in rows}))
        # A leased property listed as off campus: the rates are for NU-leased units only.
        leased = campus[bid] != "on" and any(r["chart_name"].startswith("LP-") for r in rows)
        status = "unverified" if leased else "verified"
        labels = {"upperclass_2026_27": "upperclass", "first_year_2026_27": "first-year"}
        evidence = f"{names} on the {RATE_YEAR} {' and '.join(labels[c] for c in charts)} rate chart"
        if leased:
            evidence += " (Northeastern-leased units only, not the whole building)"
        for field, value in (
            ("cost.nu_rates", rates),
            ("cost.nu_semester_min", min(prices)), ("cost.nu_semester_max", max(prices)),
            ("cost.rent_pp_month_min", round(min(prices) / MONTHS_PER_SEMESTER)),
            ("cost.rent_pp_month_max", round(max(prices) / MONTHS_PER_SEMESTER)),
            ("cost.rate_year", RATE_YEAR),
        ):
            out.append(fact(bid, field, value, "nu_rates", url, status, evidence))
    return out


# --------------------------------------------------------------------------- Boston open data

SUFFIXES = {"street": "St", "avenue": "Ave", "road": "Rd", "place": "Pl", "drive": "Dr",
            "terrace": "Ter", "boulevard": "Blvd", "court": "Ct", "square": "Sq", "park": "Park"}
NEAR_CAMPUS_ZIPS = ("02115", "02215", "02120", "02119", "02116", "02118")


def city_spelling(address: str) -> str:
    """'122 St. Stephen Street, Boston' -> '122 Saint Stephen St' (how Boston's SAM spells it)."""
    a = address.split(",")[0].strip().rstrip(".")
    a = re.sub(r"\bSt\.?\s+(?=[A-Z][a-z]+\s+\S)", "Saint ", a)  # St. Stephen St, St Botolph St
    words = a.split()
    if words and words[-1].lower().rstrip(".") in SUFFIXES:
        words[-1] = SUFFIXES[words[-1].lower().rstrip(".")]
    return " ".join(words)


def address_candidates(b: Row, extra: list[str | None]) -> list[str]:
    raw = [b.get("street_address"), *extra,
           *(a for a in b.get("aliases", []) if re.match(r"\d", a))]
    if re.match(r"\d", b["name"]):
        raw.append(b["name"])
    seen: list[str] = []
    for a in raw:
        if a and re.match(r"\d", a):
            spelled = city_spelling(a)
            # '1325 Boylston' -> also try '1325 Boylston St', '1325 Boylston Ave'
            guesses = [spelled] if spelled.split()[-1] in SUFFIXES.values() \
                else [spelled, spelled + " St", spelled + " Ave"]
            seen += [g for g in guesses if g not in seen]
    return seen


def street_point(b: Row) -> tuple[str, tuple[float, float]] | None:
    """Median of the city's address points on a street near campus."""
    zips = ", ".join(city.q(z) for z in NEAR_CAMPUS_ZIPS)
    for name in [b["name"], *b.get("aliases", [])]:
        street = city_spelling("0 " + name)[2:]
        rows = city.sql(
            f'select "POINT_X", "POINT_Y" from "{city.SAM}" '
            f'where lower("FULL_STREET_NAME") = lower({city.q(street)}) and "UNIT" is null '
            f'and "ZIP_CODE" in ({zips})')
        points = [(float(r["POINT_X"]), float(r["POINT_Y"])) for r in rows
                  if r["POINT_X"] and r["POINT_Y"]]
        if points:
            return street, (statistics.median(p[0] for p in points),
                            statistics.median(p[1] for p in points))
    return None


def place(p: Row, detail: str | None = None) -> Row:
    return {k: v for k, v in {"name": p["name"], "detail": detail,
                              "walk_minutes": p.get("walk_minutes"),
                              "distance_m": p["distance_m"]}.items() if v is not None}


def surroundings_facts(bid: str, nearby: Row, basis: str, evidence: str) -> list[Row]:
    def f(field: str, value: Any) -> Row:
        return fact(bid, field, value, "boston_open_data", evidence=evidence)

    out = [f("location.basis", basis)]
    if nearby.get("t_stations"):
        out.append(f("location.t_stations", [place(s, s["lines"]) for s in nearby["t_stations"][:2]]))
    for kind, field in (("supermarkets", "location.supermarket"),
                        ("laundromats", "location.laundromat"), ("pharmacies", "location.pharmacy")):
        if nearby.get(kind):
            out.append(f(field, [place(nearby[kind][0])]))
    if nearby.get("bluebikes"):
        out.append(f("location.bluebikes_m", nearby["bluebikes"]["distance_m"]))
    return out


def open_data_facts(b: Row, extra_addresses: list[str | None]) -> tuple[list[Row], Row]:
    bid = b["id"]
    if b["type"] == "planned":
        return [], {"skipped": "planned building"}
    if b["type"] == "street":
        found = street_point(b)
        if not found:
            print(f"    ! street not found in the city's address list: {b['name']}", file=sys.stderr)
            return [], {"skipped": "street not found"}
        street, (lon, lat) = found
        out = []
        walk = city.walk_minutes((lon, lat))
        if walk is not None:
            out.append(fact(bid, "location.walk_min_campus", walk, "boston_open_data",
                            evidence=f"middle of {street}"))
        out += surroundings_facts(bid, city.surroundings(lon, lat), "street_midpoint",
                                  f"middle of {street}")
        return out, {"street": street, "point": [lon, lat]}

    candidates = address_candidates(b, extra_addresses)
    matched = next((a for a in candidates if city.lookup_address(a)), None)
    if not matched:
        if candidates:
            print(f"    ! no city address match for {b['id']}: tried {candidates}", file=sys.stderr)
        return [], {"skipped": "no address match", "tried": candidates}

    r = city.enrich({"name": b["name"], "neighborhood": b["neighborhood"], "addresses": matched})
    ev = f"city records for {matched}"
    # University parcels often hold several buildings, so year built and permits may describe
    # a neighbor (Stetson East's parcel says 1899).
    parcel_wide = {"overview.year_built", "record.renovation_permits", "record.last_major_renovation"}

    def f(field: str, value: Any) -> Row:
        if b["campus"] == "on" and field in parcel_wide:
            return fact(bid, field, value, "boston_open_data", status="unverified",
                        evidence=ev + " (university parcel: may cover several buildings)")
        return fact(bid, field, value, "boston_open_data", evidence=ev)

    out = []
    if r.get("walk_minutes_to_campus") is not None:
        out.append(f("location.walk_min_campus", r["walk_minutes_to_campus"]))
    a = r.get("assessment", {})
    if a.get("year_built"):
        out.append(f("overview.year_built", a["year_built"]))
    if a.get("building_type"):
        out.append(f("overview.city_land_use", " ".join(a["building_type"].split())))
    if a.get("heat_type") and a["heat_type"] != "None":
        out.append(f("unit.heat", a["heat_type"]))
    ac = (a.get("ac_type") or "").lower()
    if ac:
        out.append(f("unit.ac", "central" if "central" in ac else "none" if ac == "none" else "unit"))
    c = r.get("complaints_311", {})
    for topic, field in (("pests", "record.complaints_pests"), ("heat", "record.complaints_heat"),
                         ("living_conditions", "record.complaints_conditions")):
        if topic in c:
            out.append(f(field, c[topic]["total"]))
    if "violations" in r:
        out.append(f("record.violations", r["violations"]["total"]))
        out.append(f("record.violations_open", r["violations"]["open"]))
    if "permits" in r:
        out.append(f("record.renovation_permits", r["permits"]["renovation_permits"]))
        notable = r["permits"]["notable_renovations"]
        if notable:
            out.append(f("record.last_major_renovation", notable[0]["date"][:7]))
    out += surroundings_facts(bid, r.get("nearby", {}), "building", ev)
    return out, r


# --------------------------------------------------------------------------- extract

def cmd_extract(buildings: list[Row], all_buildings: list[Row], skip_open_data: bool) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = load_page_index()
    url_counts: dict[str, int] = defaultdict(int)  # pages shared by several buildings
    for b in all_buildings:
        url_counts[b.get("website") or ""] += 1

    facts: list[Row] = []
    open_data: Row = {}
    selected = {b["id"] for b in buildings}
    facts += [f for f in rate_facts({b["id"]: b["campus"] for b in all_buildings}) if f["building"] in selected]

    for n, b in enumerate(buildings, 1):
        bid = b["id"]
        print(f"[{n}/{len(buildings)}] {b['name']}", file=sys.stderr)
        facts.append(fact(bid, "overview.kind", KIND.get(b["type"]), "building_list"))
        facts.append(fact(bid, "overview.campus", b["campus"], "building_list"))
        facts.append(fact(bid, "overview.neighborhood", b["neighborhood"], "building_list"))
        if b["campus"] == "on":
            facts.append(fact(bid, "cost.lease_type", "nu_housing", "building_list"))
        style = STYLE.get(b["type"])
        if style:
            facts.append(fact(bid, "overview.housing_style", style, "building_list"))
            values, quote = STYLE_FACTS[style]
            for field, value in values.items():
                facts.append(fact(bid, field, value, "nu_rates", NU_RATE_CHARTS["upperclass_2026_27"],
                                  evidence=quote))

        extra_addresses: list[str | None] = []
        url = b.get("website") or ""
        entry = index.get(url, {})
        if url and not entry.get("skipped") and page_path(url).exists():
            page = parse_page(page_path(url).read_text(encoding="utf-8"))
            if domain(url) == "housing.northeastern.edu":
                page_facts, address = nu_page_facts(b, url, page)
                facts += page_facts
                extra_addresses.append(address)
            else:
                facts += keyword_facts(b, url, page, shared=url_counts[url] > 1)
                extra_addresses.append(jsonld_address(page))

        if not skip_open_data:
            od_facts, raw = open_data_facts(b, extra_addresses)
            facts += od_facts
            open_data[bid] = raw

    with open(OUT / "facts.jsonl", "w", encoding="utf-8") as f:
        for x in facts:
            f.write(json.dumps(x, ensure_ascii=False) + "\n")
    if open_data:
        (OUT / "open_data.json").write_text(json.dumps(open_data, indent=1, default=list) + "\n",
                                            encoding="utf-8")
    print(f"\n{len(facts)} facts for {len(buildings)} buildings -> {OUT / 'facts.jsonl'}",
          file=sys.stderr)


# --------------------------------------------------------------------------- build

def check_value(spec: Row, value: Any) -> str | None:
    """None if value fits the catalog type, else a reason."""
    t = spec["type"]
    number = isinstance(value, int) and not isinstance(value, bool)
    if t == "text":
        ok = isinstance(value, str) and 0 < len(value) <= 300
    elif t == "int":
        ok = number and value >= 0
    elif t == "money":
        ok = number and 0 < value < 100_000
    elif t == "bool":
        ok = isinstance(value, bool)
    elif t == "enum":
        ok = isinstance(value, str) and value in spec.get("values", {})
    elif t == "list":
        ok = isinstance(value, list) and all(isinstance(v, str) and v for v in value)
    elif t == "places":
        ok = isinstance(value, list) and all(isinstance(v, dict) and "name" in v for v in value)
    elif t == "rates":
        ok = isinstance(value, list) and all(isinstance(v, dict) and "semester_usd" in v
                                             for v in value)
    else:
        ok = False
    return None if ok else f"{value!r} is not a valid {t}"


def parse_override(spec: Row, raw: str) -> Any:
    t, raw = spec["type"], raw.strip()
    if t == "bool":
        if raw.lower() in ("yes", "true", "y"):
            return True
        if raw.lower() in ("no", "false", "n"):
            return False
        raise ValueError("use yes or no")
    if t in ("int", "money"):
        return int(re.sub(r"[$,\s]", "", raw))
    if t == "list":
        return [v.strip() for v in raw.split(";") if v.strip()]
    if t in ("places", "rates"):
        return json.loads(raw)
    return raw


def load_overrides(catalog: dict[str, Row]) -> list[Row]:
    """data/overrides.csv: value ACCEPT confirms the scraped value, UNKNOWN clears the field,
    anything else replaces it."""
    if not OVERRIDES.exists():
        return []
    out = []
    with open(OVERRIDES, newline="", encoding="utf-8") as f:
        for line, r in enumerate(csv.DictReader(f), start=2):
            if not (r.get("building_id") or "").strip():
                continue
            field, raw = r["field"].strip(), (r.get("value") or "").strip()
            where = f"{OVERRIDES.name}:{line}"
            if field not in catalog:
                print(f"  ! {where}: unknown field {field!r}", file=sys.stderr)
                continue
            if raw in ("ACCEPT", "UNKNOWN"):
                value: Any = raw
            else:
                try:
                    value = parse_override(catalog[field], raw)
                except (ValueError, json.JSONDecodeError) as err:
                    print(f"  ! {where}: bad value {raw!r} for {field}: {err}", file=sys.stderr)
                    continue
            out.append({"building": r["building_id"].strip(), "field": field, "value": value,
                        "source": "manual", "url": (r.get("source_url") or "").strip() or None,
                        "status": "verified",
                        "evidence": " — ".join(x for x in (r.get("source_title", "").strip(),
                                                           r.get("note", "").strip()) if x)})
    return out


def display(value: Any) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            if "semester_usd" in value[0]:
                return "; ".join(f"{v['tier']} {v['room_type']} ${v['semester_usd']:,}" for v in value)
            return "; ".join(f"{v['name']} ({v.get('walk_minutes', '?')} min)" for v in value)
        return "; ".join(value)
    return str(value)


def cmd_build(buildings: list[Row], include_unverified: bool) -> Row:
    catalog = load_catalog()
    facts_path = OUT / "facts.jsonl"
    if not facts_path.exists():
        sys.exit("run `extract` first")
    facts = [json.loads(line) for line in facts_path.read_text(encoding="utf-8").splitlines()]
    overrides = load_overrides(catalog)
    ids = {b["id"] for b in buildings}
    for o in overrides:
        if o["building"] not in ids:
            print(f"  ! overrides.csv: building {o['building']!r} not in this run", file=sys.stderr)

    grouped: dict[tuple[str, str], list[Row]] = defaultdict(list)
    for x in facts:
        if x["field"] not in catalog:
            print(f"  ! fact for unknown field {x['field']}", file=sys.stderr)
            continue
        problem = check_value(catalog[x["field"]], x["value"])
        if problem:
            print(f"  ! {x['building']} {x['field']}: {problem} (from {x['source']})", file=sys.stderr)
            continue
        grouped[(x["building"], x["field"])].append(x)
    for group in grouped.values():  # most trusted source first
        group.sort(key=lambda f: SOURCES[f["source"]]["rank"])

    review_rows: list[list[Any]] = []
    out_buildings = []
    field_order = list(catalog)
    for b in buildings:
        specs: Row = {}
        for field in field_order:
            candidates = grouped.get((b["id"], field), [])
            manual = [o for o in overrides if o["building"] == b["id"] and o["field"] == field]
            chosen: Row | None = candidates[0] if candidates else None
            if manual:
                m = manual[-1]
                if m["value"] == "UNKNOWN":
                    chosen = None
                elif m["value"] == "ACCEPT":
                    chosen = {**chosen, "status": "verified"} if chosen else None
                else:
                    problem = check_value(catalog[field], m["value"])
                    if problem:
                        print(f"  ! overrides.csv {b['id']} {field}: {problem}", file=sys.stderr)
                    else:
                        chosen = m
            others = [c for c in candidates if chosen is None or c["value"] != chosen["value"]]
            conflicts = "; ".join(f"{c['source']}: {display(c['value'])}" for c in others)
            if chosen:
                review_rows.append([b["id"], b["name"], catalog[field]["section"], field,
                                    display(chosen["value"]), chosen["source"], chosen["status"],
                                    chosen.get("evidence") or "", chosen.get("url") or "",
                                    conflicts])
                if chosen["status"] == "verified" or include_unverified:
                    specs[field] = {k: v for k, v in {
                        "value": chosen["value"], "source": chosen["source"],
                        "url": chosen.get("url"), "status": chosen["status"],
                        "note": chosen.get("evidence") if chosen["source"] == "manual" else None,
                    }.items() if v is not None}
        out_buildings.append({
            "id": b["id"], "name": b["name"], "aliases": b.get("aliases", []),
            "specs": specs,
            "coverage": {"filled": len(specs), "of": len(catalog)},
        })

    OUT.mkdir(parents=True, exist_ok=True)
    dataset = {
        "generated_at": date.today().isoformat(),
        "catalog_version": json.loads(CATALOG.read_text(encoding="utf-8"))["version"],
        "months_per_semester": MONTHS_PER_SEMESTER,
        "includes_unverified": include_unverified,
        "sources": {k: {kk: vv for kk, vv in v.items() if kk != "rank"} for k, v in SOURCES.items()},
        "buildings": out_buildings,
    }
    (OUT / "buildings_compare.json").write_text(
        json.dumps(dataset, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    with open(OUT / "review.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["building_id", "name", "section", "field", "value", "source", "status",
                    "evidence", "url", "other_values"])
        w.writerows(sorted(review_rows, key=lambda r: (r[6] != "unverified", r[0],
                                                       field_order.index(r[3]))))

    index = load_page_index()
    od_path = OUT / "open_data.json"
    open_data = json.loads(od_path.read_text(encoding="utf-8")) if od_path.exists() else {}
    with open(OUT / "manual_todo.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["building_id", "name", "url", "why"])
        for b in buildings:
            entry = index.get(b.get("website") or "", {})
            if not b.get("website"):
                w.writerow([b["id"], b["name"], "", "no website in the building list"])
            elif entry.get("skipped"):
                w.writerow([b["id"], b["name"], b["website"], entry["skipped"]])
            od = open_data.get(b["id"], {})
            if od.get("skipped") in ("no address match", "street not found"):
                tried = ", ".join(od.get("tried", [])) or "no street address in the building list"
                w.writerow([b["id"], b["name"], b.get("maps_url", ""),
                            f"{od['skipped']} (tried: {tried}); fix street_address in the list"])

    with open(OUT / "coverage.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["building_id", "name", "kind", "campus", "filled", "of", "cost", "location"])
        kinds = {b["id"]: b for b in buildings}
        for ob in sorted(out_buildings, key=lambda x: -x["coverage"]["filled"]):
            src = kinds[ob["id"]]
            w.writerow([ob["id"], ob["name"], src["type"], src["campus"], ob["coverage"]["filled"],
                        ob["coverage"]["of"], "cost.rent_pp_month_min" in ob["specs"],
                        "location.walk_min_campus" in ob["specs"]])

    unverified = sum(1 for r in review_rows if r[6] == "unverified")
    per_field: defaultdict[str, int] = defaultdict(int)
    for ob in out_buildings:
        for k in ob["specs"]:
            per_field[k] += 1
    print(f"{len(out_buildings)} buildings -> {OUT / 'buildings_compare.json'}", file=sys.stderr)
    print(f"{unverified} unverified values to review in review.csv "
          f"({'included' if include_unverified else 'left out of the dataset'})", file=sys.stderr)
    print("fields filled (buildings):", file=sys.stderr)
    for k in field_order:
        print(f"  {per_field.get(k, 0):4d}  {k}", file=sys.stderr)
    return dataset


PAGE_COLUMNS = ("management_company", "walk_minutes_to_campus", "rent_range", "laundry",
                "heat_ac", "amenities", "sources")
AC_TEXT = {"central": "central A/C", "unit": "window/wall A/C", "none": "no A/C"}


def page_columns(specs: Row, catalog: dict[str, Row]) -> Row:
    """Values for the building page columns of public.buildings, from verified specs only.
    Same style as the team-written rows in seed.sql. Missing = leave the column alone."""
    v = {k: s["value"] for k, s in specs.items() if s.get("status") == "verified"}
    out: Row = {"management_company": v.get("overview.management"),
                "walk_minutes_to_campus": v.get("location.walk_min_campus")}
    lo, hi = v.get("cost.rent_pp_month_min"), v.get("cost.rent_pp_month_max")
    if lo is not None:
        out["rent_range"] = (f"${lo:,}" + (f"–${hi:,}" if hi and hi != lo else "")
                             + "/mo per person")
    if "amenities.laundry" in v:
        out["laundry"] = catalog["amenities.laundry"]["values"][v["amenities.laundry"]]
    heat_ac = [f"{v['unit.heat']} heat"] if v.get("unit.heat") else []
    if v.get("unit.ac") in AC_TEXT:
        heat_ac.append(AC_TEXT[v["unit.ac"]])
    if heat_ac:
        out["heat_ac"] = "; ".join(heat_ac)
        out["heat_ac"] = out["heat_ac"][0].upper() + out["heat_ac"][1:]
    out["amenities"] = [catalog[k]["label"].lower() for k, val in v.items()
                        if k.startswith("amenities.") and val is True]
    # Every source behind a filled column, so the page's Sources box links them.
    used = {"management_company": ["overview.management"],
            "walk_minutes_to_campus": ["location.walk_min_campus"],
            "rent_range": ["cost.rent_pp_month_min", "cost.rent_pp_month_max"],
            "laundry": ["amenities.laundry"], "heat_ac": ["unit.heat", "unit.ac"],
            "amenities": [k for k, val in v.items() if k.startswith("amenities.") and val is True]}
    links: dict[str, str] = {}
    for column, keys in used.items():
        if not out.get(column):
            continue
        for k in keys:
            s = specs.get(k)
            if not s:
                continue
            url = s.get("url") or SOURCES.get(s["source"], {}).get("url")
            if url and url not in links:
                links[url] = SOURCES.get(s["source"], {}).get("title", s["source"])
    out["sources"] = [{"title": t, "url": u} for u, t in links.items()]
    return out


def write_sql(dataset: Row, buildings: list[Row], with_buildings: bool) -> None:
    """output/specs/building_specs.sql: loads specs into public.building_specs, matched on
    buildings.slug. With --with-buildings it first links existing rows by name, adds rows
    for buildings the table doesn't have yet, and fills building page columns that are still
    empty (walk time, rent, laundry, heat/AC, management, amenities, sources). Columns the
    team already filled are never overwritten."""
    source = {b["id"]: b for b in buildings}
    catalog = load_catalog()
    rows = []
    for ob in dataset["buildings"]:
        if not ob["specs"]:
            continue
        b = source[ob["id"]]
        specs = json.dumps(ob["specs"], ensure_ascii=False, separators=(",", ":"))
        page = page_columns(ob["specs"], catalog)
        page_sql = ", ".join(city.sql_literal(page.get(c)) for c in PAGE_COLUMNS[:-1])
        sources = json.dumps(page["sources"], ensure_ascii=False, separators=(",", ":"))
        rows.append(f"  ({city.q(ob['id'])}, {city.q(b['name'])}, {city.q(b['neighborhood'])}, "
                    f"{city.q(specs)}::jsonb, {page_sql}, {city.q(sources)}::jsonb)")
    lines = [
        f"-- Generated by scraping/building_specs.py build --sql on {dataset['generated_at']}.",
        "-- Loads comparison specs into public.building_specs for buildings whose slug matches.",
        "-- Run it in the Supabase SQL editor (production) or with psql (local). Safe to rerun:",
        "-- each building's specs are replaced. The last query lists slugs that didn't load.",
        "begin;",
        "",
        "create temp table scraped (slug text primary key, name text, neighborhood text, "
        "specs jsonb, management_company text, walk_minutes_to_campus smallint, "
        "rent_range text, laundry text, heat_ac text, amenities text[], sources jsonb) "
        "on commit drop;",
        f"insert into scraped (slug, name, neighborhood, specs, {', '.join(PAGE_COLUMNS)}) values",
        ",\n".join(rows) + ";",
        "",
    ]
    if with_buildings:
        lines += [
            "-- Link team-written buildings that have the same name but no slug yet.",
            "update public.buildings b set slug = s.slug",
            "from scraped s where b.name = s.name and b.slug is null",
            "  and not exists (select 1 from public.buildings x where x.slug = s.slug);",
            "",
            "-- Add buildings the table doesn't have (no summary yet; the team writes those).",
            "insert into public.buildings (slug, name, neighborhood)",
            "select slug, name, neighborhood from scraped",
            "on conflict do nothing;",
            "",
            "-- Fill building page columns that are still empty. Never overwrites a value the team",
            "-- entered; to refresh one from new data, clear it in the dashboard and rerun.",
            "update public.buildings b set",
            "  management_company = coalesce(b.management_company, s.management_company),",
            "  walk_minutes_to_campus = coalesce(b.walk_minutes_to_campus, "
            "s.walk_minutes_to_campus),",
            "  rent_range = coalesce(b.rent_range, s.rent_range),",
            "  laundry = coalesce(b.laundry, s.laundry),",
            "  heat_ac = coalesce(b.heat_ac, s.heat_ac),",
            "  amenities = case when cardinality(b.amenities) = 0 then s.amenities "
            "else b.amenities end,",
            "  sources = case when b.sources = '[]'::jsonb then s.sources else b.sources end",
            "from scraped s where b.slug = s.slug;",
            "",
        ]
    lines += [
        "insert into public.building_specs (building_id, specs, catalog_version, scraped_at)",
        f"select b.id, s.specs, {int(dataset['catalog_version'])}, "
        f"{city.q(dataset['generated_at'])}::date",
        "from scraped s join public.buildings b on b.slug = s.slug",
        "on conflict (building_id) do update",
        "  set specs = excluded.specs, catalog_version = excluded.catalog_version,",
        "      scraped_at = excluded.scraped_at;",
        "",
        "select s.slug as not_loaded, s.name from scraped s",
        "where not exists (select 1 from public.buildings b where b.slug = s.slug)",
        "order by s.slug;",
        "",
        "commit;",
    ]
    path = OUT / "building_specs.sql"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(rows)} buildings -> {path}"
          f"{' (also adds missing buildings)' if with_buildings else ''}", file=sys.stderr)


# --------------------------------------------------------------------------- main

def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n", maxsplit=1)[0])
    parser.add_argument("stage", choices=["fetch", "extract", "build", "all"])
    parser.add_argument("--input", default=DEFAULT_INPUT, type=Path)
    parser.add_argument("--only", help="comma-separated building ids")
    parser.add_argument("--refresh", action="store_true", help="fetch pages again")
    parser.add_argument("--skip-open-data", action="store_true",
                        help="skip Boston open data, walk times and nearby places")
    parser.add_argument("--include-unverified", action="store_true",
                        help="put keyword matches nobody has checked into buildings_compare.json")
    parser.add_argument("--sql", action="store_true",
                        help="also write output/specs/building_specs.sql for Supabase")
    parser.add_argument("--with-buildings", action="store_true",
                        help="with --sql: also add buildings rows that don't exist yet")
    args = parser.parse_args()
    city.load_env(HERE / ".env")

    only = {s.strip() for s in args.only.split(",")} if args.only else None
    all_buildings = load_buildings(args.input, None)
    buildings = load_buildings(args.input, only)
    if args.stage in ("fetch", "all"):
        cmd_fetch(buildings, args.refresh)
    if args.stage in ("extract", "all"):
        cmd_extract(buildings, all_buildings, args.skip_open_data)
    if args.stage in ("build", "all"):
        dataset = cmd_build(buildings, args.include_unverified)
        if args.sql:
            write_sql(dataset, buildings, args.with_buildings)


if __name__ == "__main__":
    main()
