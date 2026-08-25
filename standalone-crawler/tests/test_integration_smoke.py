"""Integration smoke test against a single real, stable public page.

Per spec section 24: the test suite must not be dependent on external
websites as a whole, and must not aggressively crawl. This file makes
exactly one real network request (skipped automatically if the network is
unavailable) purely as a smoke test that the full fetch -> parse -> extract
pipeline works against a real server. All other correctness tests use the
local static/malformed HTML fixtures in test_extractor.py/test_parser.py.
"""

from __future__ import annotations

import pytest

from standalone_crawler.config import CrawlerConfig
from standalone_crawler.crawler import Crawler

# A stable, low-churn public page. In this sandbox only a small allowlist of
# domains has network egress (pypi.org, github.com, npm/crates registries,
# etc.) -- pypi.org's own project page is used here for that reason. Outside
# this sandbox, any stable HTTPS page works equally well.
SMOKE_TEST_URL = "https://pypi.org/project/scrapling/"


@pytest.mark.integration
def test_real_smoke_crawl():
    crawler = Crawler()
    config = CrawlerConfig(timeout=20, max_retries=1)

    try:
        result = crawler.crawl(SMOKE_TEST_URL, config)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Network unavailable in this environment: {exc}")

    if not result.success and result.error and result.error.type in {"FetchError", "FetchTimeout"}:
        pytest.skip(f"Network unavailable in this environment: {result.error.message}")

    assert result.success is True
    assert result.response.status_code == 200
    assert result.page.title
    assert isinstance(result.content.paragraphs, list)
    assert result.to_json()  # must be JSON-serializable
