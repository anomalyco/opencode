"""Fetcher layer.

Responsible ONLY for obtaining a page: URL validation, dispatching to the
correct Scrapling fetcher, retrying transient failures, timing the request,
and returning a normalized :class:`~standalone_crawler.models.PageResponse`.

No HTML parsing or content extraction happens here (see architecture rule
in the project spec, section 27).

Verified against the installed ``scrapling==0.4.14`` package:

* ``scrapling.Fetcher.get(url, timeout=..., headers=..., verify=..., retries=...)``
  -> plain HTTP/HTTPS request (curl_cffi under the hood).
* ``scrapling.StealthyFetcher.fetch(url, timeout=..., headless=..., network_idle=...)``
  -> Camoufox-based anti-bot browser fetch.
* ``scrapling.DynamicFetcher.fetch(url, timeout=..., headless=..., network_idle=...)``
  -> Playwright/patchright browser fetch.

Timeout units: Scrapling's ``Fetcher.get`` timeout is in **seconds** (it is
forwarded to curl_cffi), while ``StealthyFetcher.fetch`` /
``DynamicFetcher.fetch`` accept timeout in **milliseconds** (forwarded to
Playwright). This module converts accordingly so ``CrawlerConfig.timeout``
is always expressed in seconds regardless of fetch mode.
"""

from __future__ import annotations

import ipaddress
import socket
import time
from urllib.parse import urljoin, urlparse

from standalone_crawler.config import CrawlerConfig
from standalone_crawler.exceptions import (
    FetchError,
    FetchTimeout,
    HTTPError,
    InvalidURL,
    RedirectLimitExceeded,
    ResponseTooLarge,
    SSRFBlocked,
)
from standalone_crawler.logging_config import get_logger
from standalone_crawler.models import PageResponse

logger = get_logger("fetcher")

# Status codes that are worth retrying (transient/server-side).
_RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}

# Status codes we explicitly must NOT retry (spec section 22).
_NON_RETRYABLE_STATUS_CODES = {401, 403, 404}


def validate_url(url: str, allowed_schemes: tuple[str, ...] = ("http", "https")) -> str:
    """Validate a URL, raising :class:`InvalidURL` if it's unsafe or malformed.

    This only rejects clearly invalid input (bad scheme, missing host).
    It does NOT implement SSRF protection (no DNS resolution / private-IP
    blocking) -- see the README "Limitations" section for why, and for the
    configurable allow/deny hook a production deployment should add.
    """
    if not url or not isinstance(url, str):
        raise InvalidURL("URL must be a non-empty string.")

    url = url.strip()
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        raise InvalidURL(f"Could not parse URL: {exc}") from exc

    if parsed.scheme.lower() not in allowed_schemes:
        raise InvalidURL(
            f"Unsupported URL scheme '{parsed.scheme}'. "
            f"Allowed schemes: {', '.join(allowed_schemes)}."
        )

    if not parsed.netloc:
        raise InvalidURL(f"URL has no host: {url!r}")

    return url


def _is_disallowed_address(ip_str: str) -> bool:
    """True if ``ip_str`` is loopback/private/link-local/reserved/multicast.

    This covers RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8,
    ::1), link-local (169.254/16, incl. the 169.254.169.254 cloud metadata
    endpoint, and fe80::/10), unique-local IPv6 (fc00::/7), and other
    reserved ranges (0.0.0.0/8, etc.). ``ipaddress`` classifies all of
    these via its built-in ``is_private`` / ``is_loopback`` / etc. flags.
    """
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return False  # not a literal IP; nothing to classify here
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def check_ssrf_safe(url: str, config: CrawlerConfig) -> None:
    """Resolve ``url``'s host and reject it if it points at a private,
    loopback, link-local, or otherwise reserved address.

    This is a best-effort, resolve-then-check SSRF guard (spec section 22):
    it does a real DNS lookup and inspects every resolved address, so a
    hostname that merely *looks* public but resolves to an internal IP
    (DNS rebinding at request time is a separate, unresolvable TOCTOU
    concern for any single-shot resolve-then-check approach) is still
    caught. It intentionally does NOT reject on DNS failure -- a
    non-resolving host is left to fail naturally at the fetch layer with a
    normal connection error, so this function's only job is "would this
    resolve into somewhere it shouldn't."

    No-op when ``config.block_private_networks`` is False.
    """
    if not config.block_private_networks:
        return

    host = urlparse(url).hostname
    if not host:
        return

    # Fast path: the host is already a literal IP.
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if _is_disallowed_address(str(literal)):
            raise SSRFBlocked(f"Refusing to fetch {url!r}: host resolves to a non-public address ({literal}).")
        return

    try:
        addrinfo = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # DNS failure: not our concern here, let the real fetch fail normally.
        return

    resolved_ips = {info[4][0] for info in addrinfo}
    for ip_str in resolved_ips:
        if _is_disallowed_address(ip_str):
            raise SSRFBlocked(
                f"Refusing to fetch {url!r}: host {host!r} resolves to a "
                f"non-public address ({ip_str})."
            )


class PageFetcher:
    """Fetches a single page using the Scrapling fetcher selected by config."""

    @staticmethod
    def _scroll_page_action(config: CrawlerConfig):
        """Return a page_action callback that incrementally scrolls the page.

        Scrolls in viewport-sized steps, waiting for lazy-loaded content to
        appear after each step. Stops when the scroll height stabilizes for
        several iterations or the bottom of the page is reached.
        """
        import time as _time

        def _scroll(page):
            max_stable_iterations = 3
            scroll_step_ms = 800

            previous_height = 0
            stable_iterations = 0

            for _ in range(100):  # hard cap at 100 iterations
                current_height = page.evaluate("document.body.scrollHeight")
                scroll_position = page.evaluate("window.scrollY + window.innerHeight")

                if current_height == previous_height:
                    stable_iterations += 1
                else:
                    stable_iterations = 0

                if stable_iterations >= max_stable_iterations:
                    logger.info(
                        "Scroll stabilized after %s iterations (height=%s)",
                        _,
                        current_height,
                    )
                    break

                if scroll_position >= current_height and previous_height > 0:
                    logger.info("Reached page bottom at iteration %s", _)
                    _time.sleep(scroll_step_ms / 1000)
                    new_height = page.evaluate("document.body.scrollHeight")
                    if new_height <= current_height:
                        logger.info("No additional content loaded at bottom")
                        break

                page.evaluate("window.scrollBy(0, window.innerHeight)")
                _time.sleep(scroll_step_ms / 1000)
                previous_height = current_height

        return _scroll

    def fetch(self, url: str, config: CrawlerConfig) -> PageResponse:
        """Fetch ``url`` according to ``config`` and return a PageResponse.

        Raises:
            InvalidURL: if the URL fails validation.
            SSRFBlocked: if the URL resolves to a private/internal address
                and ``config.block_private_networks`` is enabled (subclass
                of InvalidURL; never retried, same as InvalidURL).
            FetchTimeout: if the request times out on every attempt.
            HTTPError: if the server returns a non-retryable error status.
            FetchError: for other connection-level failures.
        """
        validated_url = validate_url(url, config.allowed_schemes)
        check_ssrf_safe(validated_url, config)

        attempts = config.max_retries + 1
        last_exc: Exception | None = None

        for attempt in range(1, attempts + 1):
            try:
                return self._fetch_once(validated_url, config)
            except HTTPError as exc:
                if exc.status_code in _NON_RETRYABLE_STATUS_CODES:
                    logger.warning(
                        "Non-retryable HTTP status %s for %s; not retrying.",
                        exc.status_code,
                        validated_url,
                    )
                    raise
                last_exc = exc
                if exc.status_code not in _RETRYABLE_STATUS_CODES:
                    raise
            except FetchTimeout as exc:
                last_exc = exc
            except FetchError as exc:
                last_exc = exc

            if attempt < attempts:
                backoff = config.retry_backoff_base * (2 ** (attempt - 1))
                logger.info(
                    "Attempt %s/%s failed for %s (%s). Retrying in %.2fs.",
                    attempt,
                    attempts,
                    validated_url,
                    last_exc,
                    backoff,
                )
                time.sleep(backoff)

        assert last_exc is not None
        logger.error("All %s attempt(s) failed for %s: %s", attempts, validated_url, last_exc)
        raise last_exc

    def _fetch_once(self, url: str, config: CrawlerConfig) -> PageResponse:
        logger.info("Fetching URL: %s", url)
        logger.info("Fetch mode: %s", config.fetch_mode)

        start = time.monotonic()
        try:
            if config.fetch_mode == "http":
                response = self._fetch_http(url, config)
            elif config.fetch_mode == "stealth":
                response = self._fetch_stealth(url, config)
            elif config.fetch_mode == "browser":
                response = self._fetch_browser(url, config)
            else:  # pragma: no cover - guarded by pydantic Literal validation
                raise FetchError(f"Unknown fetch mode: {config.fetch_mode}")
        except (FetchTimeout, HTTPError, RedirectLimitExceeded, ResponseTooLarge):
            raise
        except TimeoutError as exc:
            raise FetchTimeout(f"Timed out fetching {url}: {exc}") from exc
        except Exception as exc:  # noqa: BLE001 - normalize all fetcher errors
            message = str(exc)
            if "timeout" in message.lower() or "timed out" in message.lower():
                raise FetchTimeout(f"Timed out fetching {url}: {message}") from exc
            raise FetchError(f"Failed to fetch {url}: {message}") from exc

        elapsed_ms = (time.monotonic() - start) * 1000
        status = getattr(response, "status", None)
        headers = dict(getattr(response, "headers", {}) or {})
        content_type = headers.get("content-type") or headers.get("Content-Type")
        final_url = getattr(response, "url", url)
        html = getattr(response, "html_content", None)
        if html is None:
            body = getattr(response, "body", b"")
            html = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body)

        body_size = self._response_body_size(response, html)
        self._enforce_response_size(url, body_size, config.max_response_size)

        logger.info("HTTP status: %s", status)

        if status is not None and status >= 400:
            raise HTTPError(f"HTTP {status} for {url}", status_code=status)

        page_response = PageResponse(
            url=url,
            status_code=status,
            content_type=content_type,
            html=html,
            final_url=final_url,
            response_time_ms=round(elapsed_ms, 2),
            headers=headers,
        )
        page_response._raw = response
        return page_response

    @staticmethod
    def _response_body_size(response, html) -> int:
        """Return received body size in bytes when available."""
        body = getattr(response, "body", None)
        if isinstance(body, (bytes, bytearray, memoryview)):
            return len(body)
        if isinstance(html, str):
            return len(html.encode("utf-8"))
        if html is None:
            return 0
        return len(str(html).encode("utf-8"))

    @staticmethod
    def _content_length(headers: dict) -> int | None:
        value = headers.get("content-length") or headers.get("Content-Length")
        if value is None:
            return None
        try:
            parsed = int(str(value).strip())
        except (TypeError, ValueError):
            return None
        return parsed if parsed >= 0 else None

    @classmethod
    def _enforce_declared_response_size(cls, url: str, response, max_size: int | None) -> None:
        """Reject an oversized response before body processing when declared."""
        if max_size is None:
            return
        headers = dict(getattr(response, "headers", {}) or {})
        declared = cls._content_length(headers)
        if declared is not None and declared > max_size:
            raise ResponseTooLarge(
                f"Response for {url} declares {declared} bytes, exceeding "
                f"the configured maximum of {max_size} bytes."
            )

    @staticmethod
    def _enforce_response_size(url: str, actual_size: int, max_size: int | None) -> None:
        if max_size is not None and actual_size > max_size:
            raise ResponseTooLarge(
                f"Response for {url} was {actual_size} bytes, exceeding "
                f"the configured maximum of {max_size} bytes."
            )

    def _fetch_http(self, url: str, config: CrawlerConfig):
        """Fetch HTTP with explicit per-hop redirect validation.

        Scrapling's HTTP fetcher is instructed not to follow redirects so this
        layer can inspect every Location target before following it. This
        avoids validating only the final URL after a redirect chain.
        """
        from scrapling import Fetcher

        current_url = url
        redirects = 0
        headers = {"User-Agent": config.user_agent} if config.user_agent else None

        while True:
            response = Fetcher.get(
                current_url,
                timeout=config.timeout,
                headers=headers,
                verify=config.verify_tls,
                follow_redirects=False,
                retries=1,
            )
            self._enforce_declared_response_size(current_url, response, config.max_response_size)
            intermediate_html = getattr(response, "html_content", None)
            if intermediate_html is None:
                intermediate_body = getattr(response, "body", b"")
                intermediate_html = (
                    intermediate_body.decode("utf-8", errors="replace")
                    if isinstance(intermediate_body, bytes)
                    else str(intermediate_body)
                )
            self._enforce_response_size(
                current_url,
                self._response_body_size(response, intermediate_html),
                config.max_response_size,
            )

            status = getattr(response, "status", None)
            response_headers = dict(getattr(response, "headers", {}) or {})
            location = response_headers.get("location") or response_headers.get("Location")

            if status in {301, 302, 303, 307, 308} and location:
                if redirects >= config.max_redirects:
                    raise RedirectLimitExceeded(
                        f"Redirect limit of {config.max_redirects} exceeded while fetching {url}."
                    )
                target = urljoin(current_url, str(location).strip())
                validate_url(target, config.allowed_schemes)
                check_ssrf_safe(target, config)
                redirects += 1
                logger.info("Following validated redirect %s/%s: %s", redirects, config.max_redirects, target)
                current_url = target
                continue

            return response

    @staticmethod
    def _browser_ssrf_page_setup(config: CrawlerConfig):
        """Return a Playwright page_setup hook that blocks private navigation/resources.

        Scrapling's browser fetchers expose page_setup. Blocking at the route
        layer means redirect requests are stopped before the browser follows
        them. The same guard also blocks private subresources, which is safer
        than allowing a page to pivot into an internal network.
        """
        def setup(page):
            navigation_requests = {"count": 0}

            def handle_route(route, request):
                request_url = request.url
                parsed = urlparse(request_url)
                if request.is_navigation_request() and parsed.scheme in {"http", "https"}:
                    navigation_requests["count"] += 1
                    # The first navigation is the requested URL. Every later
                    # navigation is a redirect or a browser-triggered
                    # top-level navigation. Bound them all to prevent loops.
                    if navigation_requests["count"] > config.max_redirects + 1:
                        logger.warning(
                            "Blocked browser navigation after redirect limit %s.",
                            config.max_redirects,
                        )
                        route.abort()
                        return
                if parsed.scheme in {"http", "https"}:
                    try:
                        check_ssrf_safe(request_url, config)
                    except SSRFBlocked as exc:
                        logger.warning("Blocked browser request by SSRF policy: %s", exc)
                        route.abort()
                        return
                route.continue_()
            page.route("**/*", handle_route)
        return setup

    def _fetch_stealth(self, url: str, config: CrawlerConfig):
        from scrapling import StealthyFetcher

        kwargs: dict = {
            "timeout": config.timeout * 1000,
            "headless": config.headless,
            "network_idle": config.network_idle,
        }
        if config.user_agent:
            kwargs["useragent"] = config.user_agent
        if config.block_private_networks:
            kwargs["page_setup"] = self._browser_ssrf_page_setup(config)
        if config.browser_profile:
            kwargs["user_data_dir"] = config.browser_profile
        if config.scroll:
            kwargs["page_action"] = self._scroll_page_action(config)
        elif config.hold_open_seconds is not None:
            import time as _time

            def _wait_after_load(page):
                _time.sleep(config.hold_open_seconds)

            kwargs["page_action"] = _wait_after_load
        return StealthyFetcher.fetch(url, **kwargs)

    def _fetch_browser(self, url: str, config: CrawlerConfig):
        from scrapling import DynamicFetcher

        kwargs: dict = {
            "timeout": config.timeout * 1000,
            "headless": config.headless,
            "network_idle": config.network_idle,
        }
        if config.user_agent:
            kwargs["useragent"] = config.user_agent
        if config.block_private_networks:
            kwargs["page_setup"] = self._browser_ssrf_page_setup(config)
        if config.browser_profile:
            kwargs["user_data_dir"] = config.browser_profile
        if config.scroll:
            kwargs["page_action"] = self._scroll_page_action(config)
        elif config.hold_open_seconds is not None:
            import time as _time

            def _wait_after_load(page):
                _time.sleep(config.hold_open_seconds)

            kwargs["page_action"] = _wait_after_load
        return DynamicFetcher.fetch(url, **kwargs)
