"""Custom exceptions for standalone_crawler.

Kept intentionally small: every exception maps to a distinct failure mode
that the CLI/programmatic API needs to report back as structured JSON.
"""

from __future__ import annotations


class CrawlerError(Exception):
    """Base class for all crawler-raised errors."""


class InvalidURL(CrawlerError):
    """Raised when a supplied URL is malformed or uses an unsupported scheme."""


class SSRFBlocked(InvalidURL):
    """Raised when a URL resolves to a private/loopback/link-local/reserved
    address and ``CrawlerConfig.block_private_networks`` is enabled.

    Subclasses InvalidURL: from the caller's point of view this is the same
    category of failure ("this URL will not be fetched"), just with a more
    specific reason. It is never retried, same as InvalidURL.
    """


class FetchError(CrawlerError):
    """Raised for generic, non-timeout fetch failures (DNS, connection reset, etc.)."""


class FetchTimeout(FetchError):
    """Raised when a fetch exceeds the configured timeout."""


class RedirectLimitExceeded(FetchError):
    """Raised when the configured redirect hop limit is exceeded."""


class ResponseTooLarge(FetchError):
    """Raised when a fetched response exceeds the configured size limit."""


class HTTPError(FetchError):
    """Raised when the server responds with an error status code.

    Attributes:
        status_code: The HTTP status code returned by the server.
    """

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ParsingError(CrawlerError):
    """Raised when the fetched HTML cannot be parsed."""


class ExtractionError(CrawlerError):
    """Raised when structured content cannot be extracted from parsed HTML."""
