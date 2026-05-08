#!/usr/bin/env python3
"""
list-plugin-releases.py — Fetch compound-engineering plugin releases from GitHub.

Output: a single JSON object on stdout. Always exits 0; failures are encoded
in the contract, never raised.

Usage:
  python3 list-plugin-releases.py [--limit N] [--api-base URL]

Environment:
  CE_RELEASE_NOTES_GH_BIN  Override the gh binary path (default: "gh"). Used
                            by the test harness; leave unset in production.

Contract:
  Success:
    {"ok": true, "source": "gh"|"anon", "fetched_at": "ISO8601",
     "releases": [{tag, version, name, published_at, url, body, linked_prs}]}
  Failure:
    {"ok": false, "error": {"code": "rate_limit"|"network_outage",
                            "message": "...", "user_hint": "..."}}
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

OWNER = "EveryInc"
REPO = "compound-engineering-plugin"
TAG_PREFIX = "compound-engineering-v"
DEFAULT_API_BASE = "https://api.github.com"
GH_TIMEOUT_SECS = 10
ANON_TIMEOUT_SECS = 10
RELEASES_URL = "https://github.com/" + OWNER + "/" + REPO + "/releases"
PR_REGEX = re.compile(r"\[#(\d+)\]")


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _extract_linked_prs(body):
    if not body:
        return []
    seen = set()
    out = []
    for m in PR_REGEX.finditer(body):
        n = int(m.group(1))
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _version_from_tag(tag):
    if tag.startswith(TAG_PREFIX):
        return tag[len(TAG_PREFIX):]
    return tag


def _normalize_release(raw):
    """Coerce a raw release dict (gh shape OR API shape) into the contract shape."""
    tag = raw.get("tagName") or raw.get("tag_name") or ""
    if not tag:
        return None
    body = raw.get("body") or ""
    return {
        "tag": tag,
        "version": _version_from_tag(tag),
        "name": raw.get("name") or "",
        "published_at": raw.get("publishedAt") or raw.get("published_at") or "",
        "url": raw.get("html_url") or raw.get("url") or "",
        "body": body,
        "linked_prs": _extract_linked_prs(body),
    }


def _filter_and_sort(raw_list):
    out = []
    for raw in raw_list:
        if not isinstance(raw, dict):
            continue
        norm = _normalize_release(raw)
        if norm is None:
            continue
        if not norm["tag"].startswith(TAG_PREFIX):
            continue
        out.append(norm)
    out.sort(key=lambda r: r["published_at"], reverse=True)
    return out


def attempt_gh(limit):
    """
    Try to fetch via gh. Returns (success, releases).
      success=True  → caller emits the result with source="gh"
      success=False → caller falls back to attempt_anon
    Falls back when: gh missing, gh exits non-zero, gh times out, gh stdout is
    not parseable JSON, or gh returns zero plugin tags (covers the GitHub
    Enterprise silent-empty case).
    """
    gh_bin = os.environ.get("CE_RELEASE_NOTES_GH_BIN", "gh")
    # `gh release list --json` does NOT expose `body` or `url` (only metadata
    # fields). `gh api` returns the full GitHub Releases API response shape
    # (tag_name, html_url, body, published_at, ...) and uses gh's auth so
    # there is no rate limit. The normalizer already handles this shape.
    cmd = [
        gh_bin,
        "api",
        "/repos/" + OWNER + "/" + REPO + "/releases?per_page=" + str(limit),
    ]
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=GH_TIMEOUT_SECS,
            check=False,
        )
    except (FileNotFoundError, PermissionError, subprocess.TimeoutExpired):
        return False, None
    if result.returncode != 0:
        return False, None
    try:
        raw_list = json.loads(result.stdout)
    except json.JSONDecodeError:
        return False, None
    if not isinstance(raw_list, list):
        return False, None
    releases = _filter_and_sort(raw_list)
    if not releases:
        return False, None
    return True, releases


def _format_reset_hint(reset_unix):
    secs_until = max(0, reset_unix - int(time.time()))
    minutes = (secs_until + 59) // 60
    if minutes <= 1:
        return "less than a minute"
    return str(minutes) + " minutes"


def attempt_anon(limit, api_base):
    """
    Fetch via the anonymous GitHub API.
    Returns (status, payload):
      "ok"             → payload = {"releases": [...]}
      "rate_limit"     → payload = {"reset_hint": "N minutes"}
      "network_outage" → payload = {"detail": "..."}
    """
    url = api_base + "/repos/" + OWNER + "/" + REPO + "/releases?per_page=" + str(limit)
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "ce-release-notes-skill",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=ANON_TIMEOUT_SECS) as resp:
            body = resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 403:
            remaining = e.headers.get("X-RateLimit-Remaining")
            if remaining == "0":
                try:
                    reset_unix = int(e.headers.get("X-RateLimit-Reset") or "0")
                except ValueError:
                    reset_unix = 0
                return "rate_limit", {"reset_hint": _format_reset_hint(reset_unix)}
        return "network_outage", {"detail": "HTTP " + str(e.code)}
    except urllib.error.URLError as e:
        return "network_outage", {"detail": "network error: " + str(e.reason)}
    except Exception as e:
        return "network_outage", {"detail": "unexpected: " + type(e).__name__}

    try:
        raw_list = json.loads(body)
    except json.JSONDecodeError:
        return "network_outage", {"detail": "malformed JSON from API"}
    if not isinstance(raw_list, list):
        return "network_outage", {"detail": "unexpected API response shape"}
    return "ok", {"releases": _filter_and_sort(raw_list)}


def emit(obj):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.write("\n")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch compound-engineering plugin releases from GitHub."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=40,
        help="Number of raw releases to fetch (default: 40).",
    )
    parser.add_argument(
        "--api-base",
        default=DEFAULT_API_BASE,
        help="Override the GitHub API base URL (test harness use).",
    )
    args = parser.parse_args()

    success, releases = attempt_gh(args.limit)
    if success:
        emit(
            {
                "ok": True,
                "source": "gh",
                "fetched_at": _now_iso(),
                "releases": releases,
            }
        )
        return

    status, payload = attempt_anon(args.limit, args.api_base)
    if status == "ok":
        emit(
            {
                "ok": True,
                "source": "anon",
                "fetched_at": _now_iso(),
                "releases": payload["releases"],
            }
        )
        return

    if status == "rate_limit":
        message = (
            "GitHub anonymous API rate limit hit (resets in "
            + payload["reset_hint"]
            + ")."
        )
        user_hint = (
            "Install and authenticate `gh` to remove this limit, or open "
            + RELEASES_URL
            + " directly."
        )
        emit(
            {
                "ok": False,
                "error": {
                    "code": "rate_limit",
                    "message": message,
                    "user_hint": user_hint,
                },
            }
        )
        return

    message = "Could not reach the GitHub Releases API."
    user_hint = (
        "Check your network connection, or open " + RELEASES_URL + " directly."
    )
    emit(
        {
            "ok": False,
            "error": {
                "code": "network_outage",
                "message": message,
                "user_hint": user_hint,
            },
        }
    )


if __name__ == "__main__":
    main()
