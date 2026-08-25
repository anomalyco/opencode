from __future__ import annotations

import pytest

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
from standalone_crawler.fetcher import PageFetcher, check_ssrf_safe, validate_url
from standalone_crawler.models import PageResponse


class TestValidateURL:
    def test_valid_http_url(self):
        assert validate_url("http://example.com") == "http://example.com"

    def test_valid_https_url(self):
        assert validate_url("https://example.com/page?x=1") == "https://example.com/page?x=1"

    def test_strips_whitespace(self):
        assert validate_url("  https://example.com  ") == "https://example.com"

    def test_invalid_url_empty(self):
        with pytest.raises(InvalidURL):
            validate_url("")

    def test_invalid_url_none(self):
        with pytest.raises(InvalidURL):
            validate_url(None)  # type: ignore[arg-type]

    def test_invalid_url_no_host(self):
        with pytest.raises(InvalidURL):
            validate_url("https://")

    def test_unsupported_scheme_ftp(self):
        with pytest.raises(InvalidURL):
            validate_url("ftp://example.com/file")

    def test_unsupported_scheme_javascript(self):
        with pytest.raises(InvalidURL):
            validate_url("javascript:alert(1)")

    def test_unsupported_scheme_file(self):
        with pytest.raises(InvalidURL):
            validate_url("file:///etc/passwd")

    def test_custom_allowed_schemes(self):
        assert validate_url("ftp://example.com/file", allowed_schemes=("ftp",)) == "ftp://example.com/file"


class TestSSRFProtection:
    """check_ssrf_safe() is a resolve-then-check guard: it does a real DNS
    lookup, so these tests use IP literals (no lookup needed) plus
    'localhost' (resolves via /etc/hosts, no network egress required) to
    stay fast and offline-safe."""

    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1/",
            "http://127.0.0.1:8080/admin",
            "http://localhost/",
            "http://169.254.169.254/latest/meta-data/",  # cloud metadata endpoint
            "http://10.0.0.5/",
            "http://172.16.0.1/",
            "http://192.168.1.1/",
            "http://0.0.0.0/",
            "http://[::1]/",
        ],
    )
    def test_blocks_private_and_loopback_and_link_local(self, url):
        config = CrawlerConfig()  # block_private_networks defaults to True
        with pytest.raises(SSRFBlocked):
            check_ssrf_safe(url, config)

    def test_allows_public_ip_literal(self):
        config = CrawlerConfig()
        # 8.8.8.8 is a public, non-reserved address (Google DNS).
        check_ssrf_safe("http://8.8.8.8/", config)  # should not raise

    def test_disabled_config_allows_everything_without_dns_lookup(self, monkeypatch):
        config = CrawlerConfig(block_private_networks=False)

        def fail_if_called(*args, **kwargs):
            raise AssertionError("getaddrinfo should not be called when protection is disabled")

        monkeypatch.setattr("socket.getaddrinfo", fail_if_called)
        check_ssrf_safe("http://127.0.0.1/", config)  # should not raise, should not resolve

    def test_dns_failure_is_not_treated_as_blocked(self, monkeypatch):
        import socket

        config = CrawlerConfig()

        def raise_gaierror(*args, **kwargs):
            raise socket.gaierror("Name or service not known")

        monkeypatch.setattr("socket.getaddrinfo", raise_gaierror)
        # A non-resolving host is left to fail naturally at the fetch layer,
        # not rejected as an SSRF attempt.
        check_ssrf_safe("http://this-host-does-not-exist.invalid/", config)

    def test_ssrf_check_wired_into_page_fetcher(self, monkeypatch):
        """PageFetcher.fetch() must call the SSRF guard before dispatching
        to the underlying Scrapling fetcher."""
        fetcher = PageFetcher()
        called = {"value": False}

        def fake_fetch(url, config):
            called["value"] = True
            return _FakeResponse()

        monkeypatch.setattr(fetcher, "_fetch_http", fake_fetch)
        config = CrawlerConfig()

        with pytest.raises(SSRFBlocked):
            fetcher.fetch("http://127.0.0.1/", config)
        assert called["value"] is False

    def test_ssrf_blocked_is_an_invalid_url(self):
        # SSRFBlocked subclasses InvalidURL so existing callers that only
        # catch InvalidURL still see it as "this URL will not be fetched".
        assert issubclass(SSRFBlocked, InvalidURL)


class _FakeResponse:
    """Minimal stand-in for a Scrapling Response, used to unit-test PageFetcher
    without making real network calls."""

    def __init__(self, status=200, headers=None, url="https://example.com/", html="<html></html>"):
        self.status = status
        self.headers = headers or {"content-type": "text/html"}
        self.url = url
        self.html_content = html
        self.body = html.encode("utf-8")


class TestRedirectAndResponseLimits:
    def test_public_to_private_redirect_is_blocked_before_following(self, monkeypatch):
        responses = iter([
            _FakeResponse(
                status=302,
                headers={"location": "http://127.0.0.1:8080/internal"},
                url="https://public.example/",
            )
        ])
        fetcher = PageFetcher()

        monkeypatch.setattr(
            "scrapling.Fetcher.get",
            lambda *args, **kwargs: next(responses),
        )

        with pytest.raises(SSRFBlocked):
            fetcher._fetch_http("https://public.example/", CrawlerConfig(max_redirects=5))

    def test_redirect_chain_is_followed_only_after_validation(self, monkeypatch):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            if url == "https://public.example/":
                return _FakeResponse(
                    status=302,
                    headers={"location": "/next"},
                    url=url,
                )
            return _FakeResponse(status=200, url=url, html="<html>ok</html>")

        monkeypatch.setattr("scrapling.Fetcher.get", fake_get)
        result = PageFetcher()._fetch_http(
            "https://public.example/", CrawlerConfig(max_redirects=5)
        )
        assert result.status == 200
        assert [c[0] for c in calls] == [
            "https://public.example/",
            "https://public.example/next",
        ]
        assert all(c[1]["follow_redirects"] is False for c in calls)

    def test_redirect_limit_is_enforced(self, monkeypatch):
        def fake_get(url, **kwargs):
            return _FakeResponse(
                status=302,
                headers={"location": "/loop"},
                url=url,
            )

        monkeypatch.setattr("scrapling.Fetcher.get", fake_get)
        with pytest.raises(RedirectLimitExceeded):
            PageFetcher()._fetch_http(
                "https://public.example/", CrawlerConfig(max_redirects=2)
            )

    @pytest.mark.parametrize("size,limit,should_raise", [(10, 10, False), (11, 10, True)])
    def test_actual_response_size_limit(self, size, limit, should_raise):
        response = _FakeResponse(html="x" * size)
        config = CrawlerConfig(max_response_size=limit)
        if should_raise:
            with pytest.raises(ResponseTooLarge):
                PageFetcher()._enforce_response_size("https://example.com/", size, limit)
        else:
            PageFetcher()._enforce_response_size("https://example.com/", size, limit)

    def test_declared_content_length_is_rejected(self):
        response = _FakeResponse(headers={"content-length": "101"})
        with pytest.raises(ResponseTooLarge):
            PageFetcher._enforce_declared_response_size(
                "https://example.com/", response, 100
            )

    def test_response_size_can_be_disabled(self):
        response = _FakeResponse(headers={"content-length": "999999999"})
        PageFetcher._enforce_declared_response_size(
            "https://example.com/", response, None
        )


class _FakeRequest:
    def __init__(self, url, navigation=True):
        self.url = url
        self._navigation = navigation

    def is_navigation_request(self):
        return self._navigation


class _FakeRoute:
    def __init__(self):
        self.actions = []

    def abort(self):
        self.actions.append("abort")

    def continue_(self):
        self.actions.append("continue")


class _FakePage:
    def __init__(self):
        self.handler = None

    def route(self, pattern, handler):
        self.handler = handler


class TestBrowserSSRFRoute:
    def test_browser_route_blocks_private_navigation(self):
        page = _FakePage()
        setup = PageFetcher._browser_ssrf_page_setup(CrawlerConfig())
        setup(page)
        route = _FakeRoute()
        page.handler(route, _FakeRequest("http://127.0.0.1/"))
        assert route.actions == ["abort"]

    def test_browser_route_allows_public_navigation(self):
        page = _FakePage()
        setup = PageFetcher._browser_ssrf_page_setup(CrawlerConfig())
        setup(page)
        route = _FakeRoute()
        page.handler(route, _FakeRequest("https://example.com/"))
        assert route.actions == ["continue"]

    def test_browser_route_enforces_navigation_limit(self):
        page = _FakePage()
        setup = PageFetcher._browser_ssrf_page_setup(CrawlerConfig(max_redirects=1))
        setup(page)
        for _ in range(2):
            route = _FakeRoute()
            page.handler(route, _FakeRequest("https://example.com/"))
            assert route.actions == ["continue"]
        route = _FakeRoute()
        page.handler(route, _FakeRequest("https://example.com/"))
        assert route.actions == ["abort"]


class TestPageFetcherRetryLogic:
    def test_successful_fetch_returns_page_response(self, monkeypatch):
        fetcher = PageFetcher()
        monkeypatch.setattr(fetcher, "_fetch_http", lambda url, config: _FakeResponse())
        config = CrawlerConfig(fetch_mode="http", max_retries=2)
        result = fetcher.fetch("https://example.com", config)
        assert isinstance(result, PageResponse)
        assert result.status_code == 200
        assert result.url == "https://example.com"

    def test_non_retryable_404_raises_immediately(self, monkeypatch):
        calls = {"count": 0}

        def fake_fetch(url, config):
            calls["count"] += 1
            return _FakeResponse(status=404)

        fetcher = PageFetcher()
        monkeypatch.setattr(fetcher, "_fetch_http", fake_fetch)
        config = CrawlerConfig(fetch_mode="http", max_retries=3, retry_backoff_base=0.01)

        with pytest.raises(HTTPError) as exc_info:
            fetcher.fetch("https://example.com", config)

        assert exc_info.value.status_code == 404
        assert calls["count"] == 1  # no retries for 404

    def test_retryable_503_retries_then_raises(self, monkeypatch):
        calls = {"count": 0}

        def fake_fetch(url, config):
            calls["count"] += 1
            return _FakeResponse(status=503)

        fetcher = PageFetcher()
        monkeypatch.setattr(fetcher, "_fetch_http", fake_fetch)
        config = CrawlerConfig(fetch_mode="http", max_retries=2, retry_backoff_base=0.01)

        with pytest.raises(HTTPError):
            fetcher.fetch("https://example.com", config)

        assert calls["count"] == 3  # initial + 2 retries

    def test_retryable_503_then_success(self, monkeypatch):
        calls = {"count": 0}

        def fake_fetch(url, config):
            calls["count"] += 1
            if calls["count"] < 2:
                return _FakeResponse(status=503)
            return _FakeResponse(status=200)

        fetcher = PageFetcher()
        monkeypatch.setattr(fetcher, "_fetch_http", fake_fetch)
        config = CrawlerConfig(fetch_mode="http", max_retries=3, retry_backoff_base=0.01)

        result = fetcher.fetch("https://example.com", config)
        assert result.status_code == 200
        assert calls["count"] == 2

    def test_timeout_raises_fetch_timeout(self, monkeypatch):
        def fake_fetch(url, config):
            raise TimeoutError("connection timed out")

        fetcher = PageFetcher()
        monkeypatch.setattr(fetcher, "_fetch_http", fake_fetch)
        config = CrawlerConfig(fetch_mode="http", max_retries=1, retry_backoff_base=0.01)

        with pytest.raises(FetchTimeout):
            fetcher.fetch("https://example.com", config)

    def test_connection_error_raises_fetch_error(self, monkeypatch):
        def fake_fetch(url, config):
            raise ConnectionError("connection refused")

        fetcher = PageFetcher()
        monkeypatch.setattr(fetcher, "_fetch_http", fake_fetch)
        config = CrawlerConfig(fetch_mode="http", max_retries=1, retry_backoff_base=0.01)

        with pytest.raises(FetchError):
            fetcher.fetch("https://example.com", config)

    def test_invalid_url_short_circuits_before_fetch(self, monkeypatch):
        called = {"value": False}

        def fake_fetch(url, config):
            called["value"] = True
            return _FakeResponse()

        fetcher = PageFetcher()
        monkeypatch.setattr(fetcher, "_fetch_http", fake_fetch)
        config = CrawlerConfig()

        with pytest.raises(InvalidURL):
            fetcher.fetch("not-a-url", config)
        assert called["value"] is False
