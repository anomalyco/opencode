"""Data models for standalone_crawler.

Two families of models live here:

* Internal models (``PageResponse``) used to pass data between the
  fetcher/parser/extractor layers without leaking Scrapling's own
  ``Response``/``Selector`` objects outside the crawler package.
* Result models (``CrawlResult`` and friends) which form the stable,
  JSON-serializable public contract described in the spec (section 13).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Internal models
# ---------------------------------------------------------------------------


class PageResponse(BaseModel):
    """Normalized fetch result, independent of which Scrapling fetcher ran.

    The extractor/parser layers only ever see this model, never a raw
    Scrapling ``Response``.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    url: str
    status_code: int | None = None
    content_type: str | None = None
    html: str = ""
    final_url: str | None = None
    response_time_ms: float | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    # Opaque handle to the underlying Scrapling Selector/Response, used only
    # by the parser layer (which knows how to use it). Never serialized.
    _raw: Any = None


# ---------------------------------------------------------------------------
# Result sub-models
# ---------------------------------------------------------------------------


class Heading(BaseModel):
    level: int
    text: str


class Link(BaseModel):
    text: str
    url: str
    rel: list[str] = Field(default_factory=list)
    external: bool | None = None


class Image(BaseModel):
    src: str
    alt: str | None = None
    title: str | None = None


class Video(BaseModel):
    src: str
    title: str | None = None
    poster: str | None = None
    type: str | None = None


class Table(BaseModel):
    """An extracted HTML table."""
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)


class ListItem(BaseModel):
    """An item from an ordered or unordered list."""
    text: str
    level: int = 0
    nested: list["ListItem"] = Field(default_factory=list)


class Breadcrumb(BaseModel):
    """A single breadcrumb entry."""
    text: str
    url: str | None = None


class StructuredDataItem(BaseModel):
    """A parsed JSON-LD or Schema.org structured data block."""
    type: str | None = None
    name: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class OpenGraphMetadata(BaseModel):
    title: str | None = None
    description: str | None = None
    image: str | None = None
    type: str | None = None
    site_name: str | None = None
    url: str | None = None


class TwitterCardMetadata(BaseModel):
    card: str | None = None
    title: str | None = None
    description: str | None = None
    image: str | None = None
    site: str | None = None


class PageMetadata(BaseModel):
    description: str | None = None
    keywords: str | None = None
    canonical: str | None = None
    robots: str | None = None
    author: str | None = None
    published_time: str | None = None
    modified_time: str | None = None
    og: OpenGraphMetadata = Field(default_factory=OpenGraphMetadata)
    twitter: TwitterCardMetadata = Field(default_factory=TwitterCardMetadata)


class RequestInfo(BaseModel):
    url: str
    fetch_mode: str | None = None


class ResponseInfo(BaseModel):
    status_code: int | None = None
    final_url: str | None = None
    content_type: str | None = None
    response_time_ms: float | None = None


class PageInfo(BaseModel):
    title: str | None = None
    description: str | None = None
    language: str | None = None
    canonical_url: str | None = None


class ContentInfo(BaseModel):
    text: str = ""
    headings: list[Heading] = Field(default_factory=list)
    paragraphs: list[str] = Field(default_factory=list)
    lists: list[ListItem] = Field(default_factory=list)
    tables: list[Table] = Field(default_factory=list)


class ErrorInfo(BaseModel):
    type: str
    message: str


class CrawlResult(BaseModel):
    """Stable, JSON-serializable output of a single crawl.

    Mirrors the schema in the project spec exactly (section 13), including
    the "everything is null/empty but the shape is stable" failure case.
    """

    success: bool
    request: RequestInfo
    response: ResponseInfo | None = None
    page: PageInfo | None = None
    content: ContentInfo | None = None
    links: list[Link] = Field(default_factory=list)
    images: list[Image] = Field(default_factory=list)
    videos: list[Video] = Field(default_factory=list)
    metadata: PageMetadata | dict = Field(default_factory=dict)
    structured_data: list[StructuredDataItem] = Field(default_factory=list)
    breadcrumbs: list[Breadcrumb] = Field(default_factory=list)
    error: ErrorInfo | None = None
    raw_html: str = Field(
        default="",
        description="Raw HTML response for debugging. Empty when crawl fails before fetch.",
    )

    def to_json(self, indent: int = 2) -> str:
        return self.model_dump_json(indent=indent, exclude_none=False)
