"""standalone_crawler: a Scrapling-based single-page web crawler.

Phase 1 component. Not integrated with OpenCode, MCP, or any external
search API by design -- see README.md.

Public API:
    Crawler, CrawlerConfig, CrawlResult
"""

from standalone_crawler.config import CrawlerConfig
from standalone_crawler.crawler import Crawler
from standalone_crawler.models import CrawlResult

__all__ = ["Crawler", "CrawlerConfig", "CrawlResult"]
__version__ = "0.1.0"
