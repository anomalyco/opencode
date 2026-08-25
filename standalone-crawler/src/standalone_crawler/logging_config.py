"""Logging configuration for standalone_crawler.

Critical constraint (see project spec, section 15): stdout is reserved for
machine-readable JSON output. All operational logs must go to stderr so
that a Phase 2 caller (an agent, plugin, or subprocess wrapper) can safely
do ``result = json.loads(subprocess.run(...).stdout)`` without stdout being
polluted by log lines.
"""

from __future__ import annotations

import logging
import sys

_CONFIGURED = False

LOG_FORMAT = "[%(asctime)s] %(levelname)-5s %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def configure_logging(level: str = "INFO") -> logging.Logger:
    """Configure the root ``standalone_crawler`` logger to write to stderr.

    Safe to call multiple times; only configures handlers once.

    Args:
        level: One of "DEBUG", "INFO", "WARNING", "ERROR".

    Returns:
        The configured logger.
    """
    global _CONFIGURED
    logger = logging.getLogger("standalone_crawler")

    if not _CONFIGURED:
        handler = logging.StreamHandler(stream=sys.stderr)
        handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT))
        logger.addHandler(handler)
        logger.propagate = False
        _CONFIGURED = True

    numeric_level = getattr(logging, level.upper(), logging.INFO)
    logger.setLevel(numeric_level)
    return logger


def get_logger(name: str) -> logging.Logger:
    """Return a child logger under the ``standalone_crawler`` namespace."""
    return logging.getLogger(f"standalone_crawler.{name}")
