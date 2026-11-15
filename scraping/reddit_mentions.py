"""Find Reddit threads that mention each building in buildings.csv.

For every building it searches r/NEU, r/boston and r/bostonhousing for the building's
name, aliases and street addresses, reads each matching thread's comments, and records:
  - which threads mention the building (link, title, date, score)
  - how many comments in those threads mention it
  - how many posts/comments touch each topic (pests, noise, maintenance, ...)

Post and comment text is only read in memory to count matches. It is never written to
disk: building summaries must be in the team's own words, and our Reddit API access
request says we only store links and metadata.

Writes output/reddit_threads.csv (one row per thread, for reading) and
output/reddit_ranking.csv (buildings ranked by mentions, for picking the 15-20).

Needs Reddit API credentials in scraping/.env (see .env.example).
  python3 reddit_mentions.py [--since 2021-01-01] [--no-comments] [--dry-run]
"""

import argparse
import base64
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from boston_open_data import SSL_CONTEXT, load_env

Row = dict[str, Any]

HERE = Path(__file__).parent
TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
API = "https://oauth.reddit.com"
SUBREDDITS = ["NEU", "boston", "bostonhousing"]
MAX_ADDRESS_TERMS = 3
MAX_QUERY_CHARS = 500  # Reddit rejects search queries over 512 characters

# Counted per post/comment that mentions the topic at least once. Keep these specific:
# a broad word like "neighbors" would tag half of all housing threads.
TOPICS = {
    "pests": r"mice|mouse|rats?|rodents?|roach(es)?|cockroach(es)?|bed ?bugs?|pests?|"
             r"exterminators?|infest(ed|ation)",
    "noise": r"noise|noisy|loud|thin walls|hear (everything|my neighbors)|soundproof",
    "maintenance": r"maintenance|repairs?|leak(s|ing|y)?|mold|mould|broken|work orders?",
    "responsiveness": r"(un)?responsive|never (respond|repl|answer|got back|fix)\w*|"
                      r"ignored|ghosted|took (weeks|months)|got back to (me|us)",
    "heat_ac": r"heat(ing|er)?|radiators?|freezing|air condition\w*|\bac\b|window units?",
    "laundry": r"laundry|washer|dryer|in-unit",
    "cost": r"rent (increase|hike|went up)|raised the rent|broker fees?|deposit|fees",
    "safety": r"break-?ins?|stolen|unsafe|sketchy|package theft",
}
TOPIC_PATTERNS = {t: re.compile(rf"\b({p})\b", re.IGNORECASE) for t, p in TOPICS.items()}

STREET_SUFFIX = re.compile(
    r"\s+(st|street|ave|avenue|rd|road|pl|place|ter|terrace|ct|court|way|sq|square|"
    r"pk|park|pkwy|parkway|blvd|boulevard|ln|lane|dr|drive|row|ext)\.?$",
    re.IGNORECASE,
)


class Reddit:
    """Tiny app-only OAuth client that respects Reddit's rate-limit headers."""

    def __init__(self, client_id: str, client_secret: str, username: str) -> None:
        self.user_agent = f"script:nusublet-building-research:v0.1 (by /u/{username})"
        auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        if client_secret:
            grant = {"grant_type": "client_credentials"}
        else:  # "installed app" credentials have no secret
            grant = {"grant_type": "https://oauth.reddit.com/grants/installed_client",
                     "device_id": "DO_NOT_TRACK_THIS_DEVICE"}
        req = urllib.request.Request(
            TOKEN_URL,
            data=urllib.parse.urlencode(grant).encode(),
            headers={"Authorization": f"Basic {auth}", "User-Agent": self.user_agent},
        )
        with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as resp:
            token = json.load(resp)
        if "access_token" not in token:
            raise RuntimeError(f"Reddit refused the credentials: {token}")
        self.token = token["access_token"]

    def get(self, path: str, params: dict[str, Any]) -> Any:
        url = f"{API}{path}?{urllib.parse.urlencode({**params, 'raw_json': 1})}"
        req = urllib.request.Request(
            url, headers={"Authorization": f"bearer {self.token}", "User-Agent": self.user_agent})
        with urllib.request.urlopen(req, timeout=60, context=SSL_CONTEXT) as resp:
            remaining = float(resp.headers.get("x-ratelimit-remaining") or 10)
            reset = float(resp.headers.get("x-ratelimit-reset") or 0)
            data = json.load(resp)
        if remaining < 2:
            print(f"    (rate limit: waiting {reset:.0f}s)", file=sys.stderr)
            time.sleep(reset + 1)
        else:
            time.sleep(0.7)  # stay well under 100 requests/minute
        return data

    def search(self, subreddit: str, query: str, since: float) -> Iterator[Row]:
        """Posts in a subreddit matching the query, newest first, back to `since`."""
        after = None
        while True:
            params = {"q": query, "restrict_sr": 1, "sort": "new", "t": "all",
                      "type": "link", "limit": 100}
            if after:
                params["after"] = after
            listing = self.get(f"/r/{subreddit}/search", params)["data"]
            for child in listing["children"]:
                post = child["data"]
                if post["created_utc"] < since:
                    return
                yield post
            after = listing.get("after")
            if not after:
                return

    def comments(self, post_id: str) -> list[str]:
        """Bodies of every loaded comment in a thread ('load more' stubs are skipped)."""
        _, tree = self.get(f"/comments/{post_id}", {"limit": 500, "depth": 10, "sort": "top"})
        bodies: list[str] = []

        def walk(listing: Row) -> None:
            for child in listing.get("data", {}).get("children", []):
                if child.get("kind") != "t1":
                    continue
                bodies.append(child["data"].get("body") or "")
                replies = child["data"].get("replies")
                if isinstance(replies, dict):
                    walk(replies)

        walk(tree)
        return bodies


def search_terms(building: Row) -> list[str]:
    """Name, aliases and short addresses ('409 Huntington Ave' -> '409 Huntington').

    Only the first MAX_ADDRESS_TERMS addresses are used: a complex can have dozens, and
    Reddit's search box takes about 500 characters. List the address students use first.
    """
    terms = [building["name"].strip()]
    terms += [a.strip() for a in (building.get("aliases") or "").split(";")]
    for address in building["addresses"].split(";")[:MAX_ADDRESS_TERMS]:
        short = STREET_SUFFIX.sub("", address.strip())
        terms.append(short)
        if re.search(r"\bMassachusetts\b", short, re.IGNORECASE):  # everyone writes "Mass Ave"
            terms.append(re.sub(r"Massachusetts", "Mass Ave", short, flags=re.IGNORECASE))
    seen: dict[str, str] = {}
    for term in terms:
        if term and not term.upper().startswith("EXAMPLE"):
            seen.setdefault(term.lower(), term)
    return list(seen.values())


def mention_pattern(terms: list[str]) -> re.Pattern[str]:
    escaped = (re.escape(t).replace(r"\ ", r"\s+") for t in terms)
    return re.compile(r"\b(" + "|".join(escaped) + r")\b", re.IGNORECASE)


def topic_counts(texts: list[str]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for text in texts:
        for topic, pattern in TOPIC_PATTERNS.items():
            if pattern.search(text):
                counts[topic] += 1
    return counts


def collect(reddit: Reddit, building: Row, since: float, with_comments: bool) -> list[Row]:
    terms = search_terms(building)
    if not terms:
        return []
    pattern = mention_pattern(terms)
    query = " OR ".join(f'"{t}"' for t in terms)
    while len(query) > MAX_QUERY_CHARS and len(terms) > 1:
        terms = terms[:-1]
        query = " OR ".join(f'"{t}"' for t in terms)
    threads: dict[str, Row] = {}
    for subreddit in SUBREDDITS:
        for post in reddit.search(subreddit, query, since):
            if post["id"] in threads:
                continue
            post_text = f"{post['title']}\n{post.get('selftext') or ''}"
            in_post = bool(pattern.search(post_text))
            comments = reddit.comments(post["id"]) if with_comments else []
            mentioning = [c for c in comments if pattern.search(c)]
            # Reddit search is fuzzy; keep only threads that really name the building.
            if not in_post and not mentioning:
                continue
            # A thread that names the building in its post is about it, so all comments
            # count toward topics; otherwise only comments that name it.
            about = [post_text] + comments if in_post else mentioning
            matched = sorted({" ".join(m.group(0).lower().split()) for m in pattern.finditer(
                post_text + "\n" + "\n".join(mentioning))})
            created = datetime.fromtimestamp(post["created_utc"], timezone.utc)
            threads[post["id"]] = {
                "building": building["name"].strip(),
                "subreddit": post["subreddit"],
                "date": created.date().isoformat(),
                "title": post["title"],
                "url": "https://www.reddit.com" + post["permalink"],
                "score": post["score"],
                "num_comments": post["num_comments"],
                "named_in_post": in_post,
                "comments_mentioning": len(mentioning),
                "matched_terms": "; ".join(matched),
                **{f"topic_{t}": n for t, n in topic_counts(about).items()},
            }
    return sorted(threads.values(), key=lambda t: t["date"], reverse=True)


def write_outputs(buildings: list[Row], threads: list[Row], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    topic_cols = [f"topic_{t}" for t in TOPICS]
    thread_cols = ["building", "subreddit", "date", "title", "url", "score", "num_comments",
                   "named_in_post", "comments_mentioning", "matched_terms", *topic_cols]
    with open(out_dir / "reddit_threads.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=thread_cols, restval=0)
        writer.writeheader()
        writer.writerows(threads)

    ranking = []
    for b in buildings:
        name = b["name"].strip()
        mine = [t for t in threads if t["building"] == name]
        ranking.append({
            "building": name,
            "neighborhood": b["neighborhood"].strip(),
            "threads": len(mine),
            "threads_named_in_post": sum(1 for t in mine if t["named_in_post"]),
            "comment_mentions": sum(t["comments_mentioning"] for t in mine),
            "latest_thread": max((t["date"] for t in mine), default=""),
            "search_terms": "; ".join(search_terms(b)),
            **{c: sum(t.get(c, 0) for t in mine) for c in topic_cols},
        })
    ranking.sort(key=lambda r: (r["threads"], r["comment_mentions"]), reverse=True)
    with open(out_dir / "reddit_ranking.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(ranking[0]) if ranking else ["building"])
        writer.writeheader()
        writer.writerows(ranking)


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n", maxsplit=1)[0])
    parser.add_argument("--input", default=HERE / "buildings.csv", type=Path)
    parser.add_argument("--out", default=HERE / "output", type=Path)
    parser.add_argument("--since", default="2021-01-01",
                        help="ignore threads older than this date (default 2021-01-01)")
    parser.add_argument("--no-comments", action="store_true",
                        help="skip reading comments: much faster, but misses most mentions")
    parser.add_argument("--dry-run", action="store_true",
                        help="print each building's search query without calling Reddit")
    args = parser.parse_args()

    with open(args.input, newline="", encoding="utf-8") as f:
        buildings = [b for b in csv.DictReader(f) if (b.get("name") or "").strip()]

    if args.dry_run:
        for b in buildings:
            terms = search_terms(b)
            print(f"{b['name']}: " + (" OR ".join(f'"{t}"' for t in terms) or "(no terms)"))
        return

    load_env(HERE / ".env")
    missing = [k for k in ("REDDIT_CLIENT_ID", "REDDIT_USERNAME") if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing {', '.join(missing)}. Copy .env.example to .env and fill it in.")
    reddit = Reddit(os.environ["REDDIT_CLIENT_ID"], os.environ.get("REDDIT_CLIENT_SECRET", ""),
                    os.environ["REDDIT_USERNAME"])

    since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc).timestamp()
    threads: list[Row] = []
    for b in buildings:
        print(f"- {b['name']}", file=sys.stderr)
        found = collect(reddit, b, since, with_comments=not args.no_comments)
        print(f"    {len(found)} threads", file=sys.stderr)
        threads += found

    write_outputs(buildings, threads, args.out)
    print(f"\nWrote {len(threads)} threads for {len(buildings)} buildings to {args.out}/",
          file=sys.stderr)


if __name__ == "__main__":
    main()
