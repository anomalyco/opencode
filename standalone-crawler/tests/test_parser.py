from __future__ import annotations

import pytest

from standalone_crawler.exceptions import ParsingError
from standalone_crawler.parser import HTMLParser


class TestHTMLParser:
    def test_parses_well_formed_html(self, sample_html):
        parser = HTMLParser()
        document = parser.parse(sample_html, url="https://example.test/sample")
        assert document.css("title::text").get() == "Sample Page Title"

    def test_parses_malformed_html_without_raising(self, malformed_html):
        """lxml recovers from broken markup rather than raising -- this is
        the 'handle malformed HTML gracefully' requirement (spec section 10)."""
        parser = HTMLParser()
        document = parser.parse(malformed_html, url="https://example.test/broken")
        assert document.css("title::text").get() == "Broken Page"
        assert document.css("h1")

    def test_none_html_raises_parsing_error(self):
        parser = HTMLParser()
        with pytest.raises(ParsingError):
            parser.parse(None, url="https://example.test")  # type: ignore[arg-type]

    def test_empty_html_does_not_raise(self):
        parser = HTMLParser()
        document = parser.parse("", url="https://example.test")
        assert document is not None
