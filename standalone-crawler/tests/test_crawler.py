from __future__ import annotations

import json

from standalone_crawler.config import CrawlerConfig
from standalone_crawler.crawler import Crawler
from standalone_crawler.exceptions import FetchTimeout, HTTPError
from standalone_crawler.models import CrawlResult, PageResponse


def _fake_page_response(html: str, url: str = "https://example.test/sample") -> PageResponse:
    return PageResponse(
        url=url,
        status_code=200,
        content_type="text/html",
        html=html,
        final_url=url,
        response_time_ms=12.3,
        headers={"content-type": "text/html"},
    )


class TestCrawlerSuccess:
    def test_successful_crawl_returns_populated_result(self, monkeypatch, sample_html):
        crawler = Crawler()
        monkeypatch.setattr(
            crawler._fetcher, "fetch", lambda url, config: _fake_page_response(sample_html)
        )

        result = crawler.crawl("https://example.test/sample")

        assert isinstance(result, CrawlResult)
        assert result.success is True
        assert result.error is None
        assert result.page.title == "Sample Page Title"
        assert result.response.status_code == 200
        assert len(result.content.paragraphs) > 0
        assert len(result.links) > 0
        assert len(result.images) > 0
        assert result.metadata.description == "A sample page for testing extraction."

    def test_result_is_json_serializable(self, monkeypatch, sample_html):
        crawler = Crawler()
        monkeypatch.setattr(
            crawler._fetcher, "fetch", lambda url, config: _fake_page_response(sample_html)
        )
        result = crawler.crawl("https://example.test/sample")
        payload = result.to_json()
        parsed = json.loads(payload)
        assert parsed["success"] is True
        assert parsed["page"]["title"] == "Sample Page Title"

    def test_extraction_toggles_respected(self, monkeypatch, sample_html):
        crawler = Crawler()
        monkeypatch.setattr(
            crawler._fetcher, "fetch", lambda url, config: _fake_page_response(sample_html)
        )
        config = CrawlerConfig(extract_links=False, extract_images=False, extract_metadata=False)
        result = crawler.crawl("https://example.test/sample", config)
        assert result.links == []
        assert result.images == []
        assert result.metadata == {}

    def test_clean_text_false_is_actually_respected(self, monkeypatch):
        """Regression test: CrawlerConfig.clean_text was defined and exposed
        via the CLI's --no-clean flag but silently ignored by the crawler
        orchestration layer, so text was always cleaned regardless of the
        setting. This must now thread through to the extractor."""
        crawler = Crawler()
        html = "<html><body><p>Hello   \t  world</p></body></html>"
        monkeypatch.setattr(crawler._fetcher, "fetch", lambda url, config: _fake_page_response(html))

        dirty_config = CrawlerConfig(clean_text=False)
        result = crawler.crawl("https://example.test/sample", dirty_config)
        assert result.content.paragraphs == ["Hello   \t  world"]

        clean_config = CrawlerConfig(clean_text=True)
        result = crawler.crawl("https://example.test/sample", clean_config)
        assert result.content.paragraphs == ["Hello world"]


class TestCrawlerFailure:
    def test_invalid_url_returns_structured_failure_not_exception(self):
        crawler = Crawler()
        result = crawler.crawl("not-a-url")
        assert result.success is False
        assert result.error.type == "InvalidURL"
        assert result.page is None
        assert result.content is None
        assert result.links == []
        assert result.images == []

    def test_timeout_returns_structured_failure(self, monkeypatch):
        crawler = Crawler()

        def raise_timeout(url, config):
            raise FetchTimeout("Timed out fetching https://example.test")

        monkeypatch.setattr(crawler._fetcher, "fetch", raise_timeout)
        result = crawler.crawl("https://example.test")
        assert result.success is False
        assert result.error.type == "FetchTimeout"

    def test_http_error_returns_structured_failure(self, monkeypatch):
        crawler = Crawler()

        def raise_http_error(url, config):
            raise HTTPError("HTTP 404 for https://example.test", status_code=404)

        monkeypatch.setattr(crawler._fetcher, "fetch", raise_http_error)
        result = crawler.crawl("https://example.test")
        assert result.success is False
        assert result.error.type == "HTTPError"

    def test_unexpected_exception_does_not_propagate(self, monkeypatch):
        """A crawl must never raise -- even for totally unexpected errors,
        it must degrade to a structured failure result (spec section 13/23)."""
        crawler = Crawler()

        def raise_unexpected(url, config):
            raise RuntimeError("something totally unexpected")

        monkeypatch.setattr(crawler._fetcher, "fetch", raise_unexpected)
        result = crawler.crawl("https://example.test")
        assert result.success is False
        assert result.error.type == "RuntimeError"

    def test_failure_result_is_json_serializable(self):
        crawler = Crawler()
        result = crawler.crawl("not-a-url")
        payload = result.to_json()
        parsed = json.loads(payload)
        assert parsed["success"] is False
        assert parsed["error"]["type"] == "InvalidURL"

    def test_parsing_error_returns_structured_failure_with_response_info(self, monkeypatch):
        """Covers the parser-failure branch in Crawler.crawl(): the fetch
        succeeded (so `response` should still be populated in the result)
        but parsing raised."""
        from standalone_crawler.exceptions import ParsingError

        crawler = Crawler()
        monkeypatch.setattr(crawler._fetcher, "fetch", lambda url, config: _fake_page_response("<html></html>"))
        monkeypatch.setattr(
            crawler._parser,
            "parse",
            lambda html, url="": (_ for _ in ()).throw(ParsingError("boom")),
        )
        result = crawler.crawl("https://example.test/sample")
        assert result.success is False
        assert result.error.type == "ParsingError"
        assert result.response is not None
        assert result.response.status_code == 200
        assert result.page is None

    def test_extraction_error_returns_structured_failure_with_response_info(self, monkeypatch, sample_html):
        """Covers the extractor-failure branch in Crawler.crawl(): fetch and
        parse both succeeded, but a downstream extraction call raised."""
        from standalone_crawler.exceptions import ExtractionError

        crawler = Crawler()
        monkeypatch.setattr(
            crawler._fetcher, "fetch", lambda url, config: _fake_page_response(sample_html)
        )
        monkeypatch.setattr(
            crawler._extractor,
            "extract_title",
            lambda document: (_ for _ in ()).throw(ExtractionError("boom")),
        )
        result = crawler.crawl("https://example.test/sample")
        assert result.success is False
        assert result.error.type == "ExtractionError"
        assert result.response is not None
        assert result.page is None
