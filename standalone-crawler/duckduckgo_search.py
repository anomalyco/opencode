#!/usr/bin/env python3
"""DuckDuckGo search CLI for OpenCode websearch tool.

Usage:
    python duckduckgo_search.py <query> [--max-results N] [--region REGION] [--time-period TIME]

Outputs JSON to stdout:
    {
      "results": [
        {"title": "...", "url": "...", "snippet": "..."},
        ...
      ],
      "query": "...",
      "provider": "duckduckgo"
    }

Uses the `ddgs` package (formerly `duckduckgo-search`) for reliable
DuckDuckGo access without API keys.  Rate limiting is handled internally
by the package.  The script adds a minimum interval between requests and
bounded retry/backoff for transient failures.
"""

import argparse
import json
import sys
import time
from typing import List, Dict, Optional

# ---------------------------------------------------------------------------
# Rate-limiting configuration
# ---------------------------------------------------------------------------

MIN_INTERVAL_S = 2.0          # minimum seconds between requests
MAX_RETRIES = 3               # retry count on transient errors
BACKOFF_BASE_S = 4.0          # exponential backoff base
MAX_BACKOFF_S = 60.0          # cap on backoff

_last_request_ts: float = 0.0


def _throttle() -> None:
    """Enforce minimum interval between consecutive requests."""
    global _last_request_ts
    now = time.monotonic()
    elapsed = now - _last_request_ts
    if elapsed < MIN_INTERVAL_S:
        time.sleep(MIN_INTERVAL_S - elapsed)
    _last_request_ts = time.monotonic()


# ---------------------------------------------------------------------------
# DuckDuckGo search via ddgs package
# ---------------------------------------------------------------------------

def _ddgs_available() -> bool:
    try:
        from ddgs import DDGS  # noqa: F401
        return True
    except ImportError:
        return False


def _search_with_ddgs(
    query: str,
    max_results: int,
    region: str,
    time_period: Optional[str],
) -> Dict:
    """Search using the ddgs package."""
    from ddgs import DDGS

    # Map our time_period codes to ddgs timelimit parameter
    timelimit_map = {"d": "d", "w": "w", "m": "m", "y": "y"}
    timelimit = timelimit_map.get(time_period) if time_period else None

    results = DDGS().text(query, region=region, max_results=max_results, timelimit=timelimit)
    return {
        "results": [
            {"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
            for r in results
        ],
        "query": query,
        "provider": "duckduckgo",
    }


def search_ddg(
    query: str,
    max_results: int = 8,
    region: str = "wt-wt",
    time_period: Optional[str] = None,
) -> Dict:
    """Execute a DuckDuckGo search with automatic rate-limit handling.

    Args:
        query: The search query.
        max_results: Maximum number of results to return.
        region: DuckDuckGo region code (e.g. 'us-en', 'wt-wt' for worldwide).
        time_period: Time period filter ('d' day, 'w' week, 'm' month, 'y' year).

    Returns:
        Dict with 'results', 'query', and 'provider' keys.
    """
    if not _ddgs_available():
        return {
            "results": [],
            "query": query,
            "provider": "duckduckgo",
            "error": "ddgs package not installed. Run: pip install ddgs",
        }

    last_error: Optional[str] = None

    for attempt in range(MAX_RETRIES + 1):
        _throttle()

        try:
            return _search_with_ddgs(query, max_results, region, time_period)
        except Exception as e:
            err_str = str(e)
            # Detect rate limiting / captcha
            is_rate_limit = any(kw in err_str.lower() for kw in ["429", "rate limit", "captcha", "too many"])
            if is_rate_limit and attempt < MAX_RETRIES:
                backoff = min(BACKOFF_BASE_S * (2 ** attempt), MAX_BACKOFF_S)
                last_error = f"rate limited (attempt {attempt + 1}/{MAX_RETRIES + 1}), backing off {backoff:.0f}s"
                print(json.dumps({"warning": last_error}), file=sys.stderr)
                time.sleep(backoff)
                continue
            last_error = f"{type(e).__name__}: {e}"
            break

    return {
        "results": [],
        "query": query,
        "provider": "duckduckgo",
        "error": last_error or "max retries exceeded",
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="DuckDuckGo search for OpenCode")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--max-results", type=int, default=8, help="Max results (default: 8)")
    parser.add_argument("--region", default="wt-wt", help="DuckDuckGo region code (default: wt-wt)")
    parser.add_argument("--time-period", default=None, choices=["d", "w", "m", "y"],
                        help="Time filter: d=day, w=week, m=month, y=year")
    args = parser.parse_args()

    result = search_ddg(args.query, args.max_results, args.region, args.time_period)
    print(json.dumps(result, indent=0))


if __name__ == "__main__":
    main()
