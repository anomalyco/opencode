from __future__ import annotations

import argparse

import pytest
from pydantic import ValidationError

from standalone_crawler.config import CrawlerConfig


class TestCrawlerConfigDefaults:
    def test_default_config_is_valid(self):
        config = CrawlerConfig()
        assert config.fetch_mode == "http"
        assert config.timeout == 30.0
        assert config.max_retries == 2
        assert config.max_redirects == 5
        assert config.max_response_size == 10 * 1024 * 1024
        assert config.block_private_networks is True
        assert config.allowed_schemes == ("http", "https")

    def test_rejects_unknown_fields(self):
        with pytest.raises(ValidationError):
            CrawlerConfig(not_a_real_field=True)  # type: ignore[call-arg]

    def test_rejects_invalid_fetch_mode(self):
        with pytest.raises(ValidationError):
            CrawlerConfig(fetch_mode="turbo")  # type: ignore[arg-type]

    def test_rejects_non_positive_timeout(self):
        with pytest.raises(ValidationError):
            CrawlerConfig(timeout=0)

    def test_rejects_negative_max_retries(self):
        with pytest.raises(ValidationError):
            CrawlerConfig(max_retries=-1)

    def test_rejects_negative_redirect_limit(self):
        with pytest.raises(ValidationError):
            CrawlerConfig(max_redirects=-1)

    def test_rejects_invalid_response_size(self):
        with pytest.raises(ValidationError):
            CrawlerConfig(max_response_size=0)

    def test_allows_disabled_response_size_limit(self):
        assert CrawlerConfig(max_response_size=None).max_response_size is None


class TestFromCliArgs:
    def _make_namespace(self, **overrides) -> argparse.Namespace:
        # Mirrors the defaults crawler_cli.py's argparse setup would produce.
        defaults = dict(
            fetch_mode="http",
            timeout=30.0,
            max_retries=2,
            max_redirects=5,
            max_response_size=10 * 1024 * 1024,
            user_agent=None,
            extract_links=True,
            extract_images=True,
            extract_metadata=True,
            clean_text=True,
        )
        defaults.update(overrides)
        return argparse.Namespace(**defaults)

    def test_builds_config_from_namespace(self):
        args = self._make_namespace(fetch_mode="stealth", timeout=15.0, max_retries=1)
        config = CrawlerConfig.from_cli_args(args)
        assert config.fetch_mode == "stealth"
        assert config.timeout == 15.0
        assert config.max_retries == 1

    def test_none_values_fall_back_to_config_default(self):
        # user_agent=None in the namespace must NOT become the literal
        # string "None" -- from_cli_args() should skip None values so the
        # CrawlerConfig field default (also None) applies.
        args = self._make_namespace(user_agent=None)
        config = CrawlerConfig.from_cli_args(args)
        assert config.user_agent is None

    def test_ignores_namespace_attributes_not_on_config(self):
        # argparse.Namespace commonly carries CLI-only fields (e.g. `url`,
        # `indent`, `log_level`) that aren't CrawlerConfig fields at all --
        # from_cli_args() must not choke on those.
        args = self._make_namespace()
        args.url = "https://example.com"
        args.indent = 2
        args.log_level = "DEBUG"
        config = CrawlerConfig.from_cli_args(args)
        assert not hasattr(config, "url")
