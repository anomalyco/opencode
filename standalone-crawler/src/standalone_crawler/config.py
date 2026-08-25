"""Configuration model for standalone_crawler.

Fetch modes map directly onto the three fetchers Scrapling actually ships
(verified against the installed ``scrapling==0.4.14`` package):

    "http"    -> scrapling.Fetcher        (plain HTTP/HTTPS via curl_cffi)
    "stealth" -> scrapling.StealthyFetcher (Camoufox-based anti-bot browser)
    "browser" -> scrapling.DynamicFetcher  (Playwright/patchright browser)

No other fetch mode names exist in Scrapling; we do not invent any.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

FetchMode = Literal["http", "stealth", "browser"]


class CrawlerConfig(BaseModel):
    """Runtime configuration for a single crawl.

    All fields have sensible defaults so ``CrawlerConfig()`` is always
    valid. Nothing here holds secrets: no API keys, cookies, or auth
    tokens are modeled, per the project's security requirements.
    """

    model_config = ConfigDict(extra="forbid")

    # --- Fetching ---
    fetch_mode: FetchMode = Field(
        default="http",
        description="Which Scrapling fetcher to use: http, stealth, or browser.",
    )
    timeout: float = Field(
        default=30.0,
        gt=0,
        description="Request timeout in seconds.",
    )
    max_retries: int = Field(
        default=2,
        ge=0,
        le=10,
        description="Max retry attempts for transient fetch failures.",
    )
    max_redirects: int = Field(
        default=5,
        ge=0,
        le=50,
        description="Maximum number of HTTP/browser navigation redirects allowed.",
    )
    max_response_size: int | None = Field(
        default=10 * 1024 * 1024,
        ge=1,
        description="Maximum response body size in bytes. None disables the post-fetch size check.",
    )
    retry_backoff_base: float = Field(
        default=0.5,
        ge=0,
        description="Base seconds for exponential backoff between retries.",
    )
    user_agent: str | None = Field(
        default=None,
        description="Override User-Agent header. None = fetcher default.",
    )
    verify_tls: bool = Field(
        default=True,
        description="Whether to verify TLS certificates. Never disabled silently.",
    )
    headless: bool = Field(
        default=True,
        description="Run browser/stealth fetchers headless (browser/stealth modes only).",
    )
    network_idle: bool = Field(
        default=False,
        description="Wait for network idle before returning (browser/stealth modes only).",
    )
    browser_profile: str | None = Field(
        default=None,
        description=(
            "Path to a persistent browser profile directory. When set, "
            "the browser fetcher reuses an existing profile (via "
            "launch_persistent_context) so logged-in sessions persist "
            "across runs. Only used in browser/stealth modes."
        ),
    )
    headed: bool = Field(
        default=False,
        description="Run browser in headed mode (visible window). Requires browser_profile for interactive login.",
    )
    hold_open_seconds: float | None = Field(
        default=None,
        gt=0,
        description=(
            "If set, keep the browser window open for this many seconds "
            "after the page loads (headed mode only). Useful for manual "
            "interaction such as logging in."
        ),
    )

    # --- Extraction toggles ---
    extract_links: bool = Field(default=True)
    extract_images: bool = Field(default=True)
    extract_metadata: bool = Field(default=True)
    clean_text: bool = Field(default=True)

    # --- Ethics / safety ---
    allowed_schemes: tuple[str, ...] = Field(
        default=("http", "https"),
        description="URL schemes that are permitted to be fetched.",
    )
    block_private_networks: bool = Field(
        default=True,
        description=(
            "SSRF protection. When True (default), the target host is "
            "resolved via DNS before fetching and the request is rejected "
            "if any resolved address is loopback, private (RFC1918/RFC4193), "
            "link-local (incl. the 169.254.169.254 cloud metadata address), "
            "or otherwise reserved. Set False only for trusted, internal-use "
            "deployments that intentionally need to reach internal hosts."
        ),
    )

    @classmethod
    def from_cli_args(cls, args) -> "CrawlerConfig":  # type: ignore[no-untyped-def]
        """Build a config from an argparse.Namespace produced by the CLI."""
        kwargs = {}
        for field_name in cls.model_fields:
            if hasattr(args, field_name):
                value = getattr(args, field_name)
                if value is not None:
                    kwargs[field_name] = value
        return cls(**kwargs)
