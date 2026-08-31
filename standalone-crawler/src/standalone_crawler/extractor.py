"""Extraction layer.

Converts a parsed Scrapling ``Selector`` document into structured content:
title, headings, paragraphs, main text, links, images, videos, tables,
lists, structured data (JSON-LD), breadcrumbs, and metadata.

This layer has no knowledge of the CLI and no knowledge of how the page
was fetched -- it operates purely on the parsed document (spec section 27).
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urljoin, urlparse

from standalone_crawler.cleaners import clean_paragraphs, clean_text_block, dedupe_preserve_order
from standalone_crawler.exceptions import ExtractionError
from standalone_crawler.logging_config import get_logger
from standalone_crawler.models import (
    Breadcrumb,
    Heading,
    Image,
    Link,
    ListItem,
    OpenGraphMetadata,
    PageMetadata,
    StructuredDataItem,
    Table,
    TwitterCardMetadata,
    Video,
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

    def extract_tables(self, document) -> list[Table]:
        """Extract HTML tables into structured Table objects."""
        tables: list[Table] = []
        try:
            for table_node in document.css("table"):
                headers: list[str] = []
                rows: list[list[str]] = []

                # Extract headers from <thead> or first <tr> with <th> elements.
                th_nodes = table_node.css("thead th") or table_node.css("tr:first-child th")
                if not th_nodes:
                    # Fallback: first row th elements.
                    first_tr = table_node.css("tr")
                    if first_tr:
                        th_nodes = first_tr[0].css("th")
                for th in th_nodes:
                    headers.append(_text_of(th).strip())

                # Extract body rows.
                tbody_rows = table_node.css("tbody tr") or table_node.css("tr")
                for tr in tbody_rows:
                    cells = tr.css("td")
                    if not cells:
                        continue
                    row = [_text_of(cell).strip() for cell in cells]
                    if any(row):
                        rows.append(row)

                if headers or rows:
                    tables.append(Table(headers=headers, rows=rows))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to extract tables: %s", exc)
        return tables

    def _extract_list_node(self, node, level: int = 0) -> list[ListItem]:
        """Recursively extract items from a <ul> or <ol> node."""
        items: list[ListItem] = []
        for li in node.css(":scope > li"):
            text = _text_of(li).strip()
            # Remove nested list text from the parent item text.
            nested_items: list[ListItem] = []
            for child_list in li.css("ul, ol"):
                nested_items.extend(self._extract_list_node(child_list, level + 1))
            if nested_items:
                nested_texts = " ".join(n.text for n in nested_items)
                text = text.replace(nested_texts, "").strip()
            if text:
                items.append(ListItem(text=text, level=level, nested=nested_items))
        return items

    def extract_lists(self, document) -> list[ListItem]:
        """Extract ordered and unordered lists."""
        all_lists: list[ListItem] = []
        try:
            body = document.css("body")
            target = body[0] if body else document
            for list_node in target.css("ul, ol"):
                # Skip lists that are likely navigation or footer lists.
                parent_tag = getattr(list_node, "parent", None)
                parent_class = ""
                if parent_tag is not None:
                    parent_class = (getattr(parent_tag, "attrib", {}) or {}).get("class", "")
                items = self._extract_list_node(list_node)
                if items:
                    all_lists.extend(items)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to extract lists: %s", exc)
        return all_lists

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

    def extract_videos(self, document, base_url: str) -> list[Video]:
        """Extract video elements (HTML5 <video>, <source>, and iframe embeds)."""
        videos: list[Video] = []
        try:
            # HTML5 <video> elements.
            for node in document.css("video"):
                src = node.attrib.get("src")
                poster = node.attrib.get("poster")
                # Check child <source> elements if no direct src.
                if not src:
                    source_node = node.css("source")
                    if source_node:
                        src = source_node[0].attrib.get("src")
                if src:
                    videos.append(
                        Video(
                            src=_absolutize(base_url, src),
                            title=node.attrib.get("title"),
                            poster=_absolutize(base_url, poster) if poster else None,
                            type=None,
                        )
                    )

            # <iframe> embeds from known video platforms.
            video_iframe_domains = {"youtube.com", "www.youtube.com", "youtu.be", "vimeo.com", "player.vimeo.com"}
            for node in document.css("iframe"):
                src = node.attrib.get("src") or node.attrib.get("data-src")
                if not src:
                    continue
                try:
                    parsed = urlparse(src)
                    if parsed.netloc in video_iframe_domains:
                        videos.append(
                            Video(
                                src=src,
                                title=node.attrib.get("title"),
                                poster=None,
                                type="iframe",
                            )
                        )
                except Exception:  # noqa: BLE001
                    pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to extract videos: %s", exc)
        return videos

    def extract_structured_data(self, document) -> list[StructuredDataItem]:
        """Extract JSON-LD structured data blocks from <script type='application/ld+json'>."""
        items: list[StructuredDataItem] = []
        try:
            for script_node in document.css("script[type='application/ld+json']"):
                raw = _text_of(script_node).strip()
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    continue

                # Handle both single objects and arrays.
                entries = data if isinstance(data, list) else [data]
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    item_type = entry.get("@type")
                    name = entry.get("name")
                    items.append(
                        StructuredDataItem(
                            type=str(item_type) if item_type else None,
                            name=str(name) if name else None,
                            data=entry,
                        )
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to extract structured data: %s", exc)
        return items

    def extract_breadcrumbs(self, document) -> list[Breadcrumb]:
        """Extract breadcrumb navigation from common patterns.

        Looks for:
        - <nav aria-label='breadcrumb'> or <nav class='breadcrumb'>
        - <ol class='breadcrumb'> / <ul class='breadcrumb'>
        - Schema.org BreadcrumbList structured data (if already extracted).
        """
        breadcrumbs: list[Breadcrumb] = []
        try:
            # Pattern 1: <nav> with breadcrumb aria-label or class.
            nav_selectors = [
                "nav[aria-label='breadcrumb'] a",
                "nav[aria-label='Breadcrumb'] a",
                "nav.breadcrumb a",
                "nav.breadcrumbs a",
                "[itemtype*='BreadcrumbList'] a",
            ]
            for selector in nav_selectors:
                nodes = document.css(selector)
                if nodes:
                    for node in nodes:
                        text = _text_of(node).strip()
                        href = node.attrib.get("href")
                        url = _absolutize(document.css("html")[0].attrib.get("base", ""), href) if href else None
                        if text:
                            breadcrumbs.append(Breadcrumb(text=text, url=url))
                    if breadcrumbs:
                        return breadcrumbs

            # Pattern 2: <ol> or <ul> with breadcrumb class.
            list_selectors = [
                "ol.breadcrumb li a",
                "ul.breadcrumb li a",
                "ol.breadcrumbs li a",
                "ul.breadcrumbs li a",
                "[class*='breadcrumb'] li a",
            ]
            for selector in list_selectors:
                nodes = document.css(selector)
                if nodes:
                    for node in nodes:
                        text = _text_of(node).strip()
                        href = node.attrib.get("href")
                        url = _absolutize(document.css("html")[0].attrib.get("base", ""), href) if href else None
                        if text:
                            breadcrumbs.append(Breadcrumb(text=text, url=url))
                    if breadcrumbs:
                        return breadcrumbs
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to extract breadcrumbs: %s", exc)
        return breadcrumbs

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

            # Publication and modification dates from meta tags.
            published_time = (
                _meta_content(document, "meta[property='article:published_time']")
                or _meta_content(document, "meta[name='date']")
                or _meta_content(document, "meta[name='publish_date']")
                or _meta_content(document, "meta[name='pubdate']")
            )
            modified_time = (
                _meta_content(document, "meta[property='article:modified_time']")
                or _meta_content(document, "meta[name='last-modified']")
                or _meta_content(document, "meta[name='updated']")
            )

            return PageMetadata(
                description=_meta_content(document, "meta[name='description']"),
                keywords=_meta_content(document, "meta[name='keywords']"),
                canonical=_first_attr(document, "link[rel='canonical']", "href"),
                robots=_meta_content(document, "meta[name='robots']"),
                author=_meta_content(document, "meta[name='author']"),
                published_time=published_time,
                modified_time=modified_time,
                og=og,
                twitter=twitter,
            )
        except Exception as exc:  # noqa: BLE001
            raise ExtractionError(f"Failed to extract metadata: {exc}") from exc
