#!/usr/bin/env python3
"""Command-line interface for standalone_crawler.

Contract (spec sections 16-17): stdout carries ONLY the JSON result;
all operational logs go to stderr. This makes the CLI safe to invoke from
another program (e.g. ``subprocess.run(..., capture_output=True)``) without
log lines corrupting the JSON on stdout.

This file contains no crawling/parsing/extraction logic -- it only parses
arguments, builds a CrawlerConfig, calls Crawler.crawl(), and prints JSON.
"""

from __future__ import annotations

import argparse
import sys

from standalone_crawler.config import CrawlerConfig
from standalone_crawler.crawler import Crawler
from standalone_crawler.logging_config import configure_logging


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="crawler_cli.py",
        description=(
            "Fetch a single URL with Scrapling and print structured JSON "
            "(title, headings, paragraphs, links, images, metadata) to stdout."
        ),
    )
    parser.add_argument("url", help="The URL to crawl (must be http:// or https://).")
    parser.add_argument(
        "--mode",
        dest="fetch_mode",
        choices=["http", "stealth", "browser"],
        default="http",
        help="Fetcher to use: 'http' (plain requests), 'stealth' (anti-bot browser), "
        "'browser' (Playwright browser). Default: http.",
    )
    parser.add_argument(
        "--timeout",
        dest="timeout",
        type=float,
        default=30.0,
        help="Request timeout in seconds. Default: 30.",
    )
    parser.add_argument(
        "--retries",
        dest="max_retries",
        type=int,
        default=2,
        help="Max retry attempts for transient failures. Default: 2.",
    )
    parser.add_argument(
        "--max-redirects",
        dest="max_redirects",
        type=int,
        default=5,
        help="Maximum redirect hops. Default: 5.",
    )
    parser.add_argument(
        "--max-response-size",
        dest="max_response_size",
        type=int,
        default=10 * 1024 * 1024,
        help="Maximum response body size in bytes. Default: 10485760.",
    )
    parser.add_argument(
        "--user-agent",
        dest="user_agent",
        default=None,
        help="Override the User-Agent header. Default: fetcher's built-in default.",
    )

    # Extraction toggles. Each has a --no-<x> counterpart, all default to enabled.
    parser.add_argument("--links", dest="extract_links", action="store_true", default=True)
    parser.add_argument("--no-links", dest="extract_links", action="store_false")
    parser.add_argument("--images", dest="extract_images", action="store_true", default=True)
    parser.add_argument("--no-images", dest="extract_images", action="store_false")
    parser.add_argument("--metadata", dest="extract_metadata", action="store_true", default=True)
    parser.add_argument("--no-metadata", dest="extract_metadata", action="store_false")
    parser.add_argument("--no-clean", dest="clean_text", action="store_false", default=True)

    parser.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        default=True,
        help="Print pure JSON to stdout (default behavior; flag kept for explicitness).",
    )
    parser.add_argument(
        "--browser-profile",
        dest="browser_profile",
        default=None,
        help="Path to persistent browser profile directory (browser/stealth modes only).",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        default=False,
        help="Run browser in headed (visible) mode.",
    )
    parser.add_argument(
        "--hold-open",
        dest="hold_open_seconds",
        type=float,
        default=None,
        help="Keep browser open for N seconds after page load (headed mode only).",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indentation level. Use 0 for compact single-line output.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging verbosity (written to stderr only). Default: INFO.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    configure_logging(args.log_level)

    config = CrawlerConfig(
        fetch_mode=args.fetch_mode,
        timeout=args.timeout,
        max_retries=args.max_retries,
        max_redirects=args.max_redirects,
        max_response_size=args.max_response_size,
        user_agent=args.user_agent,
        extract_links=args.extract_links,
        extract_images=args.extract_images,
        extract_metadata=args.extract_metadata,
        clean_text=args.clean_text,
        browser_profile=args.browser_profile,
        headed=args.headed,
        hold_open_seconds=args.hold_open_seconds,
    )

    crawler = Crawler()
    result = crawler.crawl(args.url, config)

    indent = args.indent if args.indent > 0 else None
    json_str = result.model_dump_json(indent=indent, exclude_none=False, ensure_ascii=False)
    sys.stdout.buffer.write(json_str.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()

    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())

