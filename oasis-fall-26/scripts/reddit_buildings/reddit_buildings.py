#!/usr/bin/env python3
"""Find the buildings Northeastern students talk about on Reddit, then pull
what they say into SQL for public.buildings.

  python3 reddit_buildings.py discover
      -> out/candidates.csv, ranked by how many threads mention each place.
         Delete rows that aren't real buildings/streets, fill in neighborhood.
  python3 reddit_buildings.py collect out/candidates.csv --top 20
      -> out/buildings.sql (paste into the Supabase SQL Editor)
         out/buildings.json (same data, for review)

Uses Reddit's official API (the public .json pages return 403). Create a
"script" app at https://www.reddit.com/prefs/apps and put its keys in .env next
to this file (see .env.example). Comment text is copied verbatim, but authors
are never written out and u/ mentions, emails and phone numbers are scrubbed.

Stdlib only, Python 3.9+.
"""
import argparse
import base64
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

DEFAULT_SUBS = ["NEU"]
DISCOVER_QUERIES = [
    "apartment", "landlord", "sublet", "lease", "off campus housing",
    "management company", "roommates", "rent", "brownstone",
]

# Complexes near campus that the name patterns below can't spot on their own.
KNOWN_BUILDINGS = ["Trilogy", "Viridian", "Pierce Boston", "Van Ness", "Continuum"]

# On-campus residence halls can't be sublet, so they're never candidates.
DORMS = [
    "west village", "international village", "east village", "speare", "stetson",
    "lightview", "light view", "davenport", "willis", "kerr", "melvin", "white hall",
    "smith hall", "rubenstein", "burstein", "loftman", "kennedy", "hastings", "midtown",
]

SUFFIXES = {
    "st": "St", "street": "St", "ave": "Ave", "avenue": "Ave", "rd": "Rd", "road": "Rd",
    "dr": "Dr", "drive": "Dr", "pl": "Pl", "place": "Pl", "ter": "Ter", "terrace": "Ter",
    "way": "Way",
}
# One capitalized word (plus an optional St./Saint prefix) before a street suffix,
# so "Avoid Hemenway St" still counts as Hemenway St.
STREET_RE = re.compile(
    r"\b(?:(\d{1,4})\s+)?((?:St\.?\s+|Saint\s+)?[A-Z][a-z]+)\s+"
    r"(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Pl|Place|Ter|Terrace|Way)\b"
)
COMPLEX_RE = re.compile(
    r"\b((?:[A-Z][\w'&]+\s+){1,3})(Apartments|Apts|Residences|Tower|Towers|Lofts|Commons|Flats)\b"
)
# Capitalized words that start sentences rather than building names.
LEADING_STOPWORDS = {
    "the", "a", "an", "my", "our", "their", "your", "i", "we", "avoid", "any", "anyone",
    "has", "have", "does", "do", "is", "are", "was", "about", "at", "in", "on", "from",
    "near", "like", "re", "hi", "hey", "looking", "lived", "live", "living", "both",
    "these", "those", "this", "that", "which", "what", "how", "why", "where", "when",
    "also", "but", "and", "or", "if", "so", "not", "never", "stay", "try", "check",
}


# --- Reddit API ---------------------------------------------------------------

def load_env():
    env_file = HERE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())
    missing = [k for k in ("REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT") if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing {', '.join(missing)}. Copy .env.example to .env and fill it in.")


class Reddit:
    def __init__(self):
        load_env()
        self.user_agent = os.environ["REDDIT_USER_AGENT"]
        self.token = self._fetch_token()

    def _fetch_token(self):
        creds = f"{os.environ['REDDIT_CLIENT_ID']}:{os.environ['REDDIT_CLIENT_SECRET']}"
        req = urllib.request.Request(
            "https://www.reddit.com/api/v1/access_token",
            data=b"grant_type=client_credentials",
            headers={
                "Authorization": "Basic " + base64.b64encode(creds.encode()).decode(),
                "User-Agent": self.user_agent,
            },
        )
        with urllib.request.urlopen(req) as resp:
            body = json.load(resp)
        if "access_token" not in body:
            sys.exit(f"Reddit rejected the credentials: {body}")
        return body["access_token"]

    def get(self, path, **params):
        # raw_json=1 returns text without HTML entities (&amp; etc.)
        url = f"https://oauth.reddit.com{path}?{urllib.parse.urlencode({**params, 'raw_json': 1})}"
        for attempt in range(3):
            req = urllib.request.Request(
                url, headers={"Authorization": f"Bearer {self.token}", "User-Agent": self.user_agent}
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    self._respect_rate_limit(resp.headers)
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code == 401 and attempt == 0:
                    self.token = self._fetch_token()  # tokens last an hour
                elif e.code == 429:
                    time.sleep(60)
                else:
                    raise
        raise RuntimeError(f"Gave up on {url}")

    @staticmethod
    def _respect_rate_limit(headers):
        remaining = float(headers.get("x-ratelimit-remaining") or 10)
        reset = float(headers.get("x-ratelimit-reset") or 0)
        time.sleep(reset + 1 if remaining < 2 else 0.7)

    def search(self, sub, query, limit):
        data = self.get(f"/r/{sub}/search", q=query, restrict_sr=1, sort="relevance", t="all", limit=limit, type="link")
        return [child["data"] for child in data["data"]["children"]]

    def comments(self, sub, post_id):
        """Flat list of every loaded comment in the thread (skips 'load more' stubs)."""
        _, listing = self.get(f"/r/{sub}/comments/{post_id}", limit=200, depth=5, sort="top")
        out, stack = [], list(listing["data"]["children"])
        while stack:
            child = stack.pop()
            if child["kind"] != "t1":
                continue
            c = child["data"]
            out.append({
                "body": c.get("body", ""),
                "score": c.get("score", 0),
                "is_top_level": c.get("parent_id", "").startswith("t3_"),
                "is_bot": c.get("author") in ("AutoModerator", "[deleted]"),
                "created_utc": c.get("created_utc", 0),
            })
            replies = c.get("replies")
            if isinstance(replies, dict):
                stack.extend(replies["data"]["children"])
        return out


# --- discover -------------------------------------------------------------------

def find_places(text):
    """Return {key: display name} for every building/street mentioned in text."""
    found = {}

    def add(name):
        key = name.lower()
        if not any(dorm in key for dorm in DORMS):
            found.setdefault(key, name)

    for number, name, suffix in STREET_RE.findall(text):
        name = re.sub(r"^(St\.?|Saint)\s+", "St. ", name)
        street = f"{name} {SUFFIXES[suffix.lower()]}"
        add(street)
        if number:
            add(f"{number} {street}")
    for words, kind in COMPLEX_RE.findall(text):
        words = words.split()
        while words and words[0].lower() in LEADING_STOPWORDS:
            words.pop(0)
        if words:
            add(f"{' '.join(words)} {'Apartments' if kind == 'Apts' else kind}")
    for name in KNOWN_BUILDINGS:
        if re.search(rf"\b{re.escape(name)}\b", text, re.IGNORECASE):
            add(name)
    return found


def discover(args):
    reddit = Reddit()
    posts = {}
    for sub in args.subs:
        for query in DISCOVER_QUERIES:
            print(f"searching r/{sub} for '{query}'…", file=sys.stderr)
            for post in reddit.search(sub, query, limit=100):
                posts.setdefault(post["id"], {**post, "sub": sub})
    posts = sorted(posts.values(), key=lambda p: p.get("num_comments", 0), reverse=True)[: args.max_posts]
    print(f"reading comments on {len(posts)} threads…", file=sys.stderr)

    # Count threads, not raw mentions, so one long thread can't dominate.
    threads_mentioning = Counter()
    spellings = defaultdict(Counter)
    example = {}
    for i, post in enumerate(posts, 1):
        if i % 25 == 0:
            print(f"  {i}/{len(posts)}", file=sys.stderr)
        text = "\n".join([post["title"], post.get("selftext", "")] +
                         [c["body"] for c in reddit.comments(post["sub"], post["id"])])
        for key, name in find_places(text).items():
            threads_mentioning[key] += 1
            spellings[key][name] += 1
            example.setdefault(key, "https://www.reddit.com" + post["permalink"])

    OUT.mkdir(exist_ok=True)
    path = OUT / "candidates.csv"
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["name", "aliases", "neighborhood", "threads", "example_thread"])
        for key, count in threads_mentioning.most_common():
            if count < args.min_threads:
                break
            name = spellings[key].most_common(1)[0][0]
            # Streets usually come up without the suffix ("living on Hemenway").
            street = re.match(r"^([A-Z][\w.]*(?: \w+)?) (St|Ave|Rd|Dr|Pl|Ter|Way)$", name)
            aliases = street.group(1) if street and not name[0].isdigit() else ""
            writer.writerow([name, aliases, "", count, example[key]])
    print(f"wrote {path}", file=sys.stderr)


# --- collect --------------------------------------------------------------------

def scrub(text):
    text = re.sub(r"(?<![\w/])/?u/[A-Za-z0-9_-]{3,20}", "[user]", text)
    text = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[email]", text)
    text = re.sub(r"\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b", "[phone]", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def collect(args):
    with open(args.csv, newline="") as f:
        rows = [r for r in csv.DictReader(f) if r.get("name", "").strip()][: args.top]
    reddit = Reddit()
    buildings = []
    for row in rows:
        name = row["name"].strip()
        terms = [name] + [a.strip() for a in row.get("aliases", "").split("|") if a.strip()]
        term_re = re.compile("|".join(rf"\b{re.escape(t)}\b" for t in terms), re.IGNORECASE)
        query = " OR ".join(f'"{t}"' for t in terms)
        print(f"{name}…", file=sys.stderr)

        candidates, threads = [], {}
        for sub in args.subs:
            for post in reddit.search(sub, query, limit=25)[: args.threads]:
                url = "https://www.reddit.com" + post["permalink"]
                title_matches = bool(term_re.search(post["title"]))
                if title_matches and post.get("selftext"):
                    candidates.append((post["selftext"], post["score"], post["created_utc"], sub, url, post["title"]))
                for c in reddit.comments(sub, post["id"]):
                    if c["is_bot"] or c["body"] in ("[deleted]", "[removed]"):
                        continue
                    if term_re.search(c["body"]) or (title_matches and c["is_top_level"]):
                        candidates.append((c["body"], c["score"], c["created_utc"], sub, url, post["title"]))

        quotes = []
        for body, score, created, sub, url, title in sorted(candidates, key=lambda c: c[1], reverse=True):
            body = scrub(body)
            if score < args.min_score or not 40 <= len(body) <= args.max_chars or body in (q["text"] for q in quotes):
                continue
            when = datetime.fromtimestamp(created, tz=timezone.utc).strftime("%b %Y")
            quotes.append({"text": body, "sub": sub, "when": when, "url": url})
            threads.setdefault(url, title)
            if len(quotes) == args.quotes:
                break
        if not quotes:
            print(f"  no usable comments, skipping", file=sys.stderr)
            continue

        neighborhood = row.get("neighborhood", "").strip()
        if not neighborhood:
            print(f"  no neighborhood in the CSV, using 'Unknown'", file=sys.stderr)
        buildings.append({
            "name": name,
            "neighborhood": neighborhood or "Unknown",
            "summary": "\n\n".join(f"“{q['text']}”\n— r/{q['sub']}, {q['when']}" for q in quotes),
            "sources": [{"title": title, "url": url} for url, title in threads.items()],
        })

    OUT.mkdir(exist_ok=True)
    (OUT / "buildings.json").write_text(json.dumps(buildings, indent=2, ensure_ascii=False))
    (OUT / "buildings.sql").write_text(to_sql(buildings))
    print(f"wrote {len(buildings)} buildings to {OUT / 'buildings.sql'}", file=sys.stderr)


def sql_str(value):
    return "'" + value.replace("'", "''") + "'"


def to_sql(buildings):
    lines = [
        f"-- Generated by scripts/reddit_buildings on {date.today()}. Paste into the Supabase SQL Editor.",
        "-- Re-running refreshes summary/sources; other columns the team filled in are kept.",
        "begin;",
    ]
    for b in buildings:
        lines.append(
            "insert into public.buildings (name, neighborhood, summary, sources, updated_at) values ("
            f"{sql_str(b['name'])}, {sql_str(b['neighborhood'])}, {sql_str(b['summary'])}, "
            f"{sql_str(json.dumps(b['sources'], ensure_ascii=False))}::jsonb, current_date)\n"
            "on conflict (name) do update set summary = excluded.summary, sources = excluded.sources,\n"
            "  updated_at = excluded.updated_at,\n"
            "  neighborhood = case when excluded.neighborhood = 'Unknown'\n"
            "    then public.buildings.neighborhood else excluded.neighborhood end;"
        )
    lines.append("commit;")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--subs", nargs="+", default=DEFAULT_SUBS, help="subreddits to search (default: NEU)")
    commands = parser.add_subparsers(dest="command", required=True)

    d = commands.add_parser("discover", help="rank the buildings/streets students mention most")
    d.add_argument("--max-posts", type=int, default=300, help="threads to read comments from")
    d.add_argument("--min-threads", type=int, default=2, help="drop places mentioned in fewer threads")
    d.set_defaults(run=discover)

    c = commands.add_parser("collect", help="pull comments for each building into SQL")
    c.add_argument("csv", help="candidates.csv (columns: name, aliases, neighborhood)")
    c.add_argument("--top", type=int, default=20, help="use the first N rows")
    c.add_argument("--threads", type=int, default=10, help="threads to read per building")
    c.add_argument("--quotes", type=int, default=6, help="comments to keep per building")
    c.add_argument("--min-score", type=int, default=2, help="skip comments below this score")
    c.add_argument("--max-chars", type=int, default=800, help="skip comments longer than this")
    c.set_defaults(run=collect)

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
