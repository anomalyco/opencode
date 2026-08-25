"""Extraction layer.

Converts a parsed Scrapling ``Selector`` document into structured content:
title, headings, paragraphs, main text, links, images, and metadata.

This layer has no knowledge of the CLI and no knowledge of how the page
was fetched -- it operates purely on the parsed document (spec section 27).
"""

from __future__ import annotations

from urllib.parse import urljoin, urlparse

from standalone_crawler.cleaners import clean_paragraphs, clean_text_block, dedupe_preserve_order
from standalone_crawler.exceptions import ExtractionError
from standalone_crawler.logging_config import get_logger
from standalone_crawler.models import (
    Heading,
    Image,
    Link,
    OpenGraphMetadata,
    PageMetadata,
    TwitterCardMetadata,
)

logger = get_logger("extractor")

# Tags whose text content is noise, not article content.
_NOISE_TAGS = ("script", "style", "noscript", "template", "svg")

_HEADING_SELECTORS = ["h1", "h2", "h3", "h4", "h5", "h6"]


def _text_of(node) -> str:
    """Best-effort plain text of a single element, ignoring script/style."""
    try:
        return str(node.get_all_text(separator=" ", strip=True, ignore_tags=_NOISE_TAGS))
    except Exception:  # noqa: BLE001
        return ""


def _first_attr(document, selector: str, attr: str) -> str | None:
    nodes = document.css(selector)
    if not nodes:
        return None
    value = nodes[0].attrib.get(attr)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _meta_content(document, selector: str) -> str | None:
    return _first_attr(document, selector, "content")


def _absolutize(base_url: str, maybe_relative: str) -> str:
    if not maybe_relative:
        return maybe_relative
    try:
        return urljoin(base_url, maybe_relative)
    except Exception:  # noqa: BLE001
        return maybe_relative


class ContentExtractor:
    """Extracts structured content from a parsed document."""

    def extract_title(self, document) -> str | None:
        title = document.css("title::text").get()
        if title:
            return title.strip()
        # Fall back to first h1 if <title> is missing.
        h1 = document.css("h1")
        if h1:
            text = _text_of(h1[0])
            return text or None
        return None

    def extract_language(self, document) -> str | None:
        lang = _first_attr(document, "html", "lang")
        if lang:
            return lang
        return _meta_content(document, "meta[http-equiv='content-language']")

    def extract_headings(self, document) -> list[Heading]:
        headings: list[Heading] = []
        try:
            for level, tag in enumerate(_HEADING_SELECTORS, start=1):
                for node in document.css(tag):
                    text = _text_of(node)
                    if text:
                        headings.append(Heading(level=level, text=text))
        except Exception as exc:  # noqa: BLE001
            raise ExtractionError(f"Failed to extract headings: {exc}") from exc

        # Restore document order (we iterated tag-by-tag above, not in
        # document order), using the elements' source position.
        try:
            ordered_nodes = document.css(",".join(_HEADING_SELECTORS))
            ordered: list[Heading] = []
            for node in ordered_nodes:
                text = _text_of(node)
                if not text:
                    continue
                tag_name = getattr(node, "tag", None)
                level = int(tag_name[1]) if tag_name and tag_name[0] == "h" and tag_name[1:].isdigit() else 1
                ordered.append(Heading(level=level, text=text))
            if ordered:
                return ordered
        except Exception:  # noqa: BLE001
            pass
        return headings

    def extract_paragraphs(self, document, clean: bool = True) -> list[str]:
        try:
            raw_paragraphs = [_text_of(node) for node in document.css("p")]
        except Exception as exc:  # noqa: BLE001
            raise ExtractionError(f"Failed to extract paragraphs: {exc}") from exc
        if not clean:
            return [p for p in (p.strip() for p in raw_paragraphs) if p]
        return clean_paragraphs(raw_paragraphs)

    def extract_visible_text(self, document, clean: bool = True) -> str:
        """Extract visible body text, excluding non-visible/noise elements.

        This is deliberately *visible-text extraction*, not semantic article
        extraction. Navigation, headers, footers, sidebars, and other visible
        page chrome may therefore be present.
        """
        try:
            body = document.css("body")
            target = body[0] if body else document
            text = _text_of(target)
        except Exception as exc:  # noqa: BLE001
            raise ExtractionError(f"Failed to extract visible text: {exc}") from exc
        return clean_text_block(text) if clean else text

    def extract_main_text(self, document, clean: bool = True) -> str:
        """Backward-compatible alias for :meth:`extract_visible_text`.

        The old name is retained to avoid breaking callers, but it does not
        claim semantic main-article extraction.
        """
        return self.extract_visible_text(document, clean=clean)

    def extract_links(self, document, base_url: str) -> list[Link]:
        links: list[Link] = []
        base_host = urlparse(base_url).netloc.lower()
        try:
            for node in document.css("a"):
                href = node.attrib.get("href")
                if not href:
                    continue
                href = href.strip()
                if not href or href.startswith("#") or href.lower().startswith("javascript:"):
                    continue
                absolute = _absolutize(base_url, href)
                parsed = urlparse(absolute)
                if parsed.scheme not in ("http", "https"):
                    continue
                text = _text_of(node)
                rel_attr = node.attrib.get("rel")
                rel = rel_attr.split() if isinstance(rel_attr, str) else list(rel_attr or [])
                external = bool(base_host) and parsed.netloc.lower() != base_host
                links.append(Link(text=text, url=absolute, rel=rel, external=external))
        except Exception as exc:  # noqa: BLE001
            raise ExtractionError(f"Failed to extract links: {exc}") from exc

        # De-duplicate identical (url, text) pairs while preserving order.
        seen: set[tuple[str, str]] = set()
        deduped: list[Link] = []
        for link in links:
            key = (link.url, link.text)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(link)
        return deduped

    def extract_images(self, document, base_url: str) -> list[Image]:
        images: list[Image] = []
        try:
            for node in document.css("img"):
                src = node.attrib.get("src") or node.attrib.get("data-src")
                if not src:
                    continue
                src = src.strip()
                if not src:
                    continue
                absolute = _absolutize(base_url, src)
                alt = node.attrib.get("alt")
                title = node.attrib.get("title")
                images.append(
                    Image(
                        src=absolute,
                        alt=alt.strip() if isinstance(alt, str) and alt.strip() else None,
                        title=title.strip() if isinstance(title, str) and title.strip() else None,
                    )
                )
        except Exception as exc:  # noqa: BLE001
            raise ExtractionError(f"Failed to extract images: {exc}") from exc
        return images

    def extract_metadata(self, document) -> PageMetadata:
        try:
            og = OpenGraphMetadata(
                title=_meta_content(document, "meta[property='og:title']"),
                description=_meta_content(document, "meta[property='og:description']"),
                image=_meta_content(document, "meta[property='og:image']"),
                type=_meta_content(document, "meta[property='og:type']"),
                site_name=_meta_content(document, "meta[property='og:site_name']"),
                url=_meta_content(document, "meta[property='og:url']"),
            )
            twitter = TwitterCardMetadata(
                card=_meta_content(document, "meta[name='twitter:card']"),
                title=_meta_content(document, "meta[name='twitter:title']"),
                description=_meta_content(document, "meta[name='twitter:description']"),
                image=_meta_content(document, "meta[name='twitter:image']"),
                site=_meta_content(document, "meta[name='twitter:site']"),
            )
            return PageMetadata(
                description=_meta_content(document, "meta[name='description']"),
                keywords=_meta_content(document, "meta[name='keywords']"),
                canonical=_first_attr(document, "link[rel='canonical']", "href"),
                robots=_meta_content(document, "meta[name='robots']"),
                author=_meta_content(document, "meta[name='author']"),
                og=og,
                twitter=twitter,
            )
        except Exception as exc:  # noqa: BLE001
            raise ExtractionError(f"Failed to extract metadata: {exc}") from exc
        