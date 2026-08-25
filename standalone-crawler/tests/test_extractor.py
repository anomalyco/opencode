from __future__ import annotations

from standalone_crawler.extractor import ContentExtractor
from standalone_crawler.parser import HTMLParser

BASE_URL = "https://example.test/sample"


def _parse(html: str):
    return HTMLParser().parse(html, url=BASE_URL)


class TestTitleAndLanguage:
    def test_extract_title(self, sample_html):
        document = _parse(sample_html)
        assert ContentExtractor().extract_title(document) == "Sample Page Title"

    def test_extract_language(self, sample_html):
        document = _parse(sample_html)
        assert ContentExtractor().extract_language(document) == "en"

    def test_title_falls_back_to_h1_when_missing(self):
        html = "<html><body><h1>Fallback Heading</h1></body></html>"
        document = _parse(html)
        assert ContentExtractor().extract_title(document) == "Fallback Heading"


class TestHeadings:
    def test_extract_headings_in_order(self, sample_html):
        document = _parse(sample_html)
        headings = ContentExtractor().extract_headings(document)
        texts_levels = [(h.level, h.text) for h in headings]
        assert texts_levels == [
            (1, "Main Heading"),
            (2, "Sub Heading One"),
            (3, "Sub Heading Two"),
        ]


class TestParagraphs:
    def test_extract_paragraphs_cleans_whitespace(self, sample_html):
        document = _parse(sample_html)
        paragraphs = ContentExtractor().extract_paragraphs(document)
        assert "This is the first paragraph with extra whitespace." in paragraphs

    def test_extract_paragraphs_drops_empty(self, sample_html):
        document = _parse(sample_html)
        paragraphs = ContentExtractor().extract_paragraphs(document)
        assert all(p.strip() for p in paragraphs)

    def test_extract_paragraphs_dedupes(self, sample_html):
        document = _parse(sample_html)
        paragraphs = ContentExtractor().extract_paragraphs(document)
        assert paragraphs.count("This is the second paragraph.") == 1

    def test_clean_false_skips_whitespace_normalization(self):
        # A paragraph with irregular internal whitespace: clean=True should
        # collapse it, clean=False should leave it (only stripped) as-is.
        html = "<html><body><p>Hello   \t  world</p></body></html>"
        document = _parse(html)
        cleaned = ContentExtractor().extract_paragraphs(document, clean=True)
        raw = ContentExtractor().extract_paragraphs(document, clean=False)
        assert cleaned == ["Hello world"]
        assert raw == ["Hello   \t  world"]

    def test_clean_defaults_to_true(self, sample_html):
        # Regression test for the clean_text config flag being silently
        # ignored: extract_paragraphs()/extract_main_text() must clean by
        # default so existing callers that don't pass `clean` keep the
        # documented (whitespace-normalized) behavior.
        document = _parse(sample_html)
        assert ContentExtractor().extract_paragraphs(document) == ContentExtractor().extract_paragraphs(
            document, clean=True
        )


class TestMainText:
    def test_visible_text_semantics_include_page_chrome(self):
        html = """<html><body><header>Navigation</header><article>Article body</article><footer>Copyright</footer></body></html>"""
        document = _parse(html)
        text = ContentExtractor().extract_visible_text(document)
        assert "Navigation" in text
        assert "Article body" in text
        assert "Copyright" in text

    def test_old_main_text_name_remains_compatible_alias(self):
        html = "<html><body><article>Article body</article></body></html>"
        document = _parse(html)
        extractor = ContentExtractor()
        assert extractor.extract_main_text(document) == extractor.extract_visible_text(document)

    def test_excludes_script_and_style_content(self, sample_html):
        document = _parse(sample_html)
        text = ContentExtractor().extract_main_text(document)
        assert "should be ignored" not in text
        assert "color: red" not in text

    def test_includes_visible_text(self, sample_html):
        document = _parse(sample_html)
        text = ContentExtractor().extract_main_text(document)
        assert "Main Heading" in text

    def test_clean_false_skips_whitespace_normalization(self):
        html = "<html><body>Hello   \t  world</body></html>"
        document = _parse(html)
        cleaned = ContentExtractor().extract_main_text(document, clean=True)
        raw = ContentExtractor().extract_main_text(document, clean=False)
        assert cleaned == "Hello world"
        assert raw == "Hello   \t  world"


class TestLinks:
    def test_relative_links_made_absolute(self, sample_html):
        document = _parse(sample_html)
        links = ContentExtractor().extract_links(document, BASE_URL)
        urls = [link.url for link in links]
        assert "https://example.test/relative/link" in urls

    def test_external_link_flagged(self, sample_html):
        document = _parse(sample_html)
        links = ContentExtractor().extract_links(document, BASE_URL)
        external_link = next(link for link in links if link.url == "https://external.test/page")
        assert external_link.external is True

    def test_internal_link_not_flagged_external(self, sample_html):
        document = _parse(sample_html)
        links = ContentExtractor().extract_links(document, BASE_URL)
        internal_link = next(link for link in links if link.url == "https://example.test/relative/link")
        assert internal_link.external is False

    def test_anchor_only_and_javascript_links_skipped(self, sample_html):
        document = _parse(sample_html)
        links = ContentExtractor().extract_links(document, BASE_URL)
        urls = [link.url for link in links]
        assert not any(u.startswith("javascript:") for u in urls)
        assert not any(u.endswith("#section") for u in urls)

    def test_anchor_text_preserved(self, sample_html):
        document = _parse(sample_html)
        links = ContentExtractor().extract_links(document, BASE_URL)
        nav_link = next(link for link in links if link.url == "https://example.test/nav-link")
        assert nav_link.text == "Nav Link"


class TestImages:
    def test_relative_image_urls_made_absolute(self, sample_html):
        document = _parse(sample_html)
        images = ContentExtractor().extract_images(document, BASE_URL)
        srcs = [img.src for img in images]
        assert "https://example.test/images/pic1.jpg" in srcs

    def test_absolute_image_urls_preserved(self, sample_html):
        document = _parse(sample_html)
        images = ContentExtractor().extract_images(document, BASE_URL)
        srcs = [img.src for img in images]
        assert "https://cdn.example.test/pic2.jpg" in srcs

    def test_alt_and_title_captured(self, sample_html):
        document = _parse(sample_html)
        images = ContentExtractor().extract_images(document, BASE_URL)
        pic2 = next(img for img in images if img.src == "https://cdn.example.test/pic2.jpg")
        assert pic2.alt == "Picture two"
        assert pic2.title == "Second picture"

    def test_empty_src_skipped(self, sample_html):
        document = _parse(sample_html)
        images = ContentExtractor().extract_images(document, BASE_URL)
        assert all(img.src for img in images)


class TestMetadata:
    def test_description(self, sample_html):
        document = _parse(sample_html)
        metadata = ContentExtractor().extract_metadata(document)
        assert metadata.description == "A sample page for testing extraction."

    def test_canonical(self, sample_html):
        document = _parse(sample_html)
        metadata = ContentExtractor().extract_metadata(document)
        assert metadata.canonical == "https://example.test/sample"

    def test_open_graph(self, sample_html):
        document = _parse(sample_html)
        metadata = ContentExtractor().extract_metadata(document)
        assert metadata.og.title == "OG Sample Title"
        assert metadata.og.type == "article"

    def test_twitter_card(self, sample_html):
        document = _parse(sample_html)
        metadata = ContentExtractor().extract_metadata(document)
        assert metadata.twitter.card == "summary_large_image"

    def test_missing_metadata_is_none_not_error(self):
        html = "<html><head><title>No metadata</title></head><body></body></html>"
        document = _parse(html)
        metadata = ContentExtractor().extract_metadata(document)
        assert metadata.description is None
        assert metadata.og.title is None
