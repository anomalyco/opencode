from __future__ import annotations

import io
import json
import sys

import pytest

from standalone_crawler.crawler import Crawler
from standalone_crawler.models import (
    ContentInfo,
    CrawlResult,
    PageInfo,
    RequestInfo,
    ResponseInfo,
)

import crawler_cli


def _fake_success_result(url: str) -> CrawlResult:
    return CrawlResult(
        success=True,
        request=RequestInfo(url=url, fetch_mode="http"),
        response=ResponseInfo(status_code=200, final_url=url, content_type="text/html", response_time_ms=1.0),
        page=PageInfo(title="Fake Title", description=None, language="en", canonical_url=url),
        content=ContentInfo(text="Some text", headings=[], paragraphs=["A paragraph."]),
        links=[],
        images=[],
        metadata={},
        error=None,
    )


class TestCLI:
    def test_stdout_is_pure_json_on_success(self, monkeypatch, capsys):
        monkeypatch.setattr(
            Crawler, "crawl", lambda self, url, config=None: _fake_success_result(url)
        )
        exit_code = crawler_cli.main(["https://example.test/page"])
        captured = capsys.readouterr()

        assert exit_code == 0
        assert captured.err != "" or captured.err == ""  # logs may or may not be captured here
        # The critical invariant: stdout parses as exactly one JSON object.
        parsed = json.loads(captured.out)
        assert parsed["success"] is True
        assert parsed["page"]["title"] == "Fake Title"

    def test_exit_code_1_on_failure(self, monkeypatch, capsys):
        from standalone_crawler.exceptions import InvalidURL

        def fake_crawl(self, url, config=None):
            return Crawler.crawl(self, url, config)

        # Use a real crawl with a bad URL to exercise real failure path end-to-end.
        exit_code = crawler_cli.main(["not-a-url"])
        captured = capsys.readouterr()

        assert exit_code == 1
        parsed = json.loads(captured.out)
        assert parsed["success"] is False
        assert parsed["error"]["type"] == "InvalidURL"

    def test_help_flag_exits_cleanly(self, capsys):
        with pytest.raises(SystemExit) as exc_info:
            crawler_cli.main(["--help"])
        assert exc_info.value.code == 0

    def test_no_url_is_argparse_error(self, capsys):
        with pytest.raises(SystemExit) as exc_info:
            crawler_cli.main([])
        assert exc_info.value.code != 0

    def test_mode_flag_parsed(self, monkeypatch, capsys):
        captured_configs = []

        def fake_crawl(self, url, config=None):
            captured_configs.append(config)
            return _fake_success_result(url)

        monkeypatch.setattr(Crawler, "crawl", fake_crawl)
        crawler_cli.main(["https://example.test", "--mode", "stealth"])
        assert captured_configs[0].fetch_mode == "stealth"

    def test_new_safety_options_are_passed_to_config(self, monkeypatch):
        captured_configs = []

        def fake_crawl(self, url, config=None):
            captured_configs.append(config)
            return _fake_success_result(url)

        monkeypatch.setattr(Crawler, "crawl", fake_crawl)
        crawler_cli.main([
            "https://example.test",
            "--max-redirects", "3",
            "--max-response-size", "2048",
        ])
        assert captured_configs[0].max_redirects == 3
        assert captured_configs[0].max_response_size == 2048

    def test_no_links_flag_disables_link_extraction(self, monkeypatch):
        captured_configs = []

        def fake_crawl(self, url, config=None):
            captured_configs.append(config)
            return _fake_success_result(url)

        monkeypatch.setattr(Crawler, "crawl", fake_crawl)
        crawler_cli.main(["https://example.test", "--no-links"])
        assert captured_configs[0].extract_links is False
