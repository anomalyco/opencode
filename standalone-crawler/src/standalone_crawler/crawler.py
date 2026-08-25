"""Main crawler orchestration.

Wires together the fetcher, parser, extractor, and cleaners into a single
``Crawler.crawl()`` call, per the flow in spec section 12:

    URL -> validate -> fetch -> normalize -> parse -> extract -> clean -> CrawlResult

A crawl NEVER raises for expected failure modes (invalid URL, timeout,
HTTP error, parse error, extraction error); it always returns a
``CrawlResult`` with ``success=False`` and a populated ``error`` field.
Unexpected exceptions are also caught at the top level so a batch caller
(or Phase 2 agent) never sees an unhandled traceback from a single URL.
"""

from __future__ import annotations

from standalone_crawler.config import CrawlerConfig
from standalone_crawler.exceptions import CrawlerError
from standalone_crawler.extractor import ContentExtractor
from standalone_crawler.fetcher import PageFetcher
from standalone_crawler.logging_config import get_logger
from standalone_crawler.models import (
    ContentInfo,
    CrawlResult,
    ErrorInfo,
    PageInfo,
    RequestInfo,
    ResponseInfo,
)
from standalone_crawler.parser import HTMLParser

logger = get_logger("crawler")


class Crawler:
    """Standalone, single-page crawler.

    Example:
        >>> crawler = Crawler()
        >>> result = crawler.crawl("https://example.com")
        >>> result.success
        True
    """

    def __init__(
        self,
        fetcher: PageFetcher | None = None,
        parser: HTMLParser | None = None,
        extractor: ContentExtractor | None = None,
    ) -> None:
        self._fetcher = fetcher or PageFetcher()
        self._parser = parser or HTMLParser()
        self._extractor = extractor or ContentExtractor()

    def crawl(self, url: str, config: CrawlerConfig | None = None) -> CrawlResult:
        """Crawl a single URL and return a structured, JSON-serializable result.

        This method does not raise for expected crawl failures -- it always
        returns a ``CrawlResult``. Callers that need exceptions should catch
        them from the lower-level ``PageFetcher`` / ``HTMLParser`` /
        ``ContentExtractor`` directly instead.
        """
        config = config or CrawlerConfig()
        request_info = RequestInfo(url=url, fetch_mode=config.fetch_mode)

        try:
            page = self._fetcher.fetch(url, config)
        except CrawlerError as exc:
            logger.warning("Fetch failed for %s: %s", url, exc)
            return self._failure_result(request_info, exc)
        except Exception as exc:  # noqa: BLE001 - never let a bad URL crash a batch run
            logger.exception("Unexpected error fetching %s", url)
            return self._failure_result(request_info, exc)

        response_info = ResponseInfo(
            status_code=page.status_code,
            final_url=page.final_url,
            content_type=page.content_type,
            response_time_ms=page.response_time_ms,
        )

        try:
            document = self._parser.parse(page.html, url=page.final_url or page.url)
        except CrawlerError as exc:
            logger.warning("Parsing failed for %s: %s", url, exc)
            return self._failure_result(request_info, exc, response=response_info)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected parsing error for %s", url)
            return self._failure_result(request_info, exc, response=response_info)

        base_url = page.final_url or page.url

        try:
            title = self._extractor.extract_title(document)
            language = self._extractor.extract_language(document)
            headings = self._extractor.extract_headings(document)
            paragraphs = self._extractor.extract_paragraphs(document, clean=config.clean_text)
            main_text = self._extractor.extract_visible_text(document, clean=config.clean_text)

            metadata = (
                self._extractor.extract_metadata(document) if config.extract_metadata else None
            )
            links = self._extractor.extract_links(document, base_url) if config.extract_links else []
            images = (
                self._extractor.extract_images(document, base_url) if config.extract_images else []
            )
        except CrawlerError as exc:
            logger.warning("Extraction failed for %s: %s", url, exc)
            return self._failure_result(request_info, exc, response=response_info)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected extraction error for %s", url)
            return self._failure_result(request_info, exc, response=response_info)

        description = metadata.description if metadata else None
        canonical = metadata.canonical if metadata else None

        page_info = PageInfo(
            title=title,
            description=description,
            language=language,
            canonical_url=canonical or base_url,
        )
        content_info = ContentInfo(text=main_text, headings=headings, paragraphs=paragraphs)

        logger.info("Extracted %d links", len(links))
        logger.info("Extracted %d paragraphs", len(paragraphs))

        return CrawlResult(
            success=True,
            request=request_info,
            response=response_info,
            page=page_info,
            content=content_info,
            links=links,
            images=images,
            metadata=metadata if metadata else {},
            error=None,
            raw_html=page.html,
        )

    @staticmethod
    def _failure_result(
        request_info: RequestInfo,
        exc: Exception,
        response: ResponseInfo | None = None,
    ) -> CrawlResult:
        return CrawlResult(
            success=False,
            request=request_info,
            response=response,
            page=None,
            content=None,
            links=[],
            images=[],
            metadata={},
            error=ErrorInfo(type=type(exc).__name__, message=str(exc)),
        )
