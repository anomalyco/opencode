#!/usr/bin/env python3
"""Basic example of using the standalone_crawler package programmatically.

Run with:
    python examples/basic_crawl.py https://example.com
"""

from __future__ import annotations

import sys

from standalone_crawler import Crawler, CrawlerConfig
from standalone_crawler.logging_config import configure_logging


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"

    # Logs go to stderr; nothing here touches stdout except our own prints.
    configure_logging("INFO")

    config = CrawlerConfig(
        fetch_mode="http",
        timeout=30,
        extract_links=True,
        extract_images=True,
        extract_metadata=True,
    )

    crawler = Crawler()
    result = crawler.crawl(url, config)

    if result.success:
        print(f"Title: {result.page.title}")
        print(f"Status: {result.response.status_code}")
        print(f"Paragraphs found: {len(result.content.paragraphs)}")
        print(f"Links found: {len(result.links)}")
        print(f"Images found: {len(result.images)}")
    else:
        print(f"Crawl failed: {result.error.type}: {result.error.message}")

    # Full structured result, as JSON:
    print()
    print(result.to_json())


if __name__ == "__main__":
    main()
