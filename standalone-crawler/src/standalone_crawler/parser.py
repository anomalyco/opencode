"""HTML parsing layer.

Wraps Scrapling's ``Selector`` class -- the same parser Scrapling's
fetchers use internally -- so the extractor layer always works against a
consistent parsed-document interface, regardless of which fetcher produced
the raw HTML. This intentionally re-parses the HTML string rather than
reusing the fetcher's raw ``Response`` object, keeping the parser layer
decoupled from the fetcher layer per the architecture rule in the spec
(section 27).

Malformed HTML is handled gracefully: lxml (which Scrapling's Selector
uses under the hood) recovers from broken markup rather than raising, so
parse() only raises ParsingError for genuinely unparseable/empty input.
"""

from __future__ import annotations

from standalone_crawler.exceptions import ParsingError
from standalone_crawler.logging_config import get_logger

logger = get_logger("parser")


class HTMLParser:
    """Parses raw HTML into a Scrapling ``Selector`` document."""

    def parse(self, html: str, url: str = ""):
        """Parse ``html`` and return a Scrapling ``Selector``.

        Args:
            html: Raw HTML content.
            url: Base URL, used by the resulting Selector to resolve
                relative links via ``.urljoin()``.

        Raises:
            ParsingError: if the HTML cannot be parsed at all.
        """
        if html is None:
            raise ParsingError("Cannot parse HTML: content is None.")

        from scrapling import Selector

        try:
            document = Selector(content=html, url=url)
        except Exception as exc:  # noqa: BLE001 - normalize all parser errors
            raise ParsingError(f"Failed to parse HTML: {exc}") from exc

        logger.debug("Parsed HTML document (%d bytes) for %s", len(html or ""), url)
        return document
