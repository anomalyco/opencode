#!/usr/bin/env python3
"""
sync_changelog.py
Fetches the OpenCode changelog from https://opencode.ai/changelog,
parses it, and writes a formatted CHANGELOG.md to the repo root.
"""

import re
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

CHANGELOG_URL = "https://opencode.ai/changelog"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "CHANGELOG.md"

HEADER = """\
# Changelog

All notable changes to this project are documented here.

The canonical changelog is published at:
https://opencode.ai/changelog

This file mirrors the official OpenCode changelog so GitHub users and
contributors can view release history directly in the repository.

> Last synced: {timestamp}

---
"""

SECTION_ORDER = ["Breaking Changes", "Core", "TUI", "Desktop", "SDK", "Extensions", "Features", "Fixes", "Improvements", "Misc"]


def fetch_page(url: str) -> BeautifulSoup:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; changelog-sync-bot/1.0; "
            "+https://github.com/moscovium-mc/opencode)"
        )
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def clean_text(text: str) -> str:
    """Normalise whitespace and strip zero-width chars."""
    text = text.replace("\u200b", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def extract_contributor(text: str) -> tuple[str, str | None]:
    """
    Pulls a trailing (@handle) attribution out of a bullet line.
    Returns (cleaned_text, handle_or_None).
    """
    m = re.search(r"\(@([\w-]+)\)\s*$", text)
    if m:
        handle = m.group(1)
        body = text[: m.start()].rstrip(" .,")
        return body, handle
    return text, None


def strip_pr_refs(text: str) -> str:
    """Remove inline PR references like (#12345) or PR #12345:."""
    text = re.sub(r"PR\s*#\d+\s*:?\s*", "", text)
    text = re.sub(r"\s*\(#\d+\)\s*", " ", text)
    return text.strip()


def format_bullet(raw: str) -> str:
    """Turn a raw bullet string into a clean markdown list item."""
    text = clean_text(raw)
    text = strip_pr_refs(text)
    text, contributor = extract_contributor(text)

    # Ensure first char is upper-case
    if text:
        text = text[0].upper() + text[1:]

    # Ensure terminal period
    if text and text[-1] not in ".!?":
        text += "."

    line = f"- {text}"
    if contributor:
        line += f" ([@{contributor}](https://github.com/{contributor}))"
    return line


# ---------------------------------------------------------------------------
# Parsing strategy
#
# opencode.ai is a Next.js site.  The changelog page renders its content in
# the initial HTML payload (no JS required for the text), but the exact DOM
# layout varies with deploys.  We try two strategies in order:
#
#   1. Semantic: look for <article> / <section> tags with version headings.
#   2. Heuristic: walk all headings and collect the text that follows each.
# ---------------------------------------------------------------------------

def parse_versions(soup: BeautifulSoup) -> list[dict]:
    """
    Returns a list of version dicts:
        {
            "version": "v1.4.0",
            "date": "Apr 8, 2026",
            "sections": {
                "Core": ["bullet …", …],
                …
            }
        }
    """
    versions: list[dict] = []

    # ---- Strategy 1: look for elements whose text matches a version pattern ----
    version_pattern = re.compile(r"^v\d+\.\d+\.\d+$")
    date_pattern = re.compile(r"[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}")

    version_headings = [
        tag for tag in soup.find_all(re.compile(r"^h[1-6]$"))
        if version_pattern.match(clean_text(tag.get_text()))
    ]

    # Also check for <p> / <span> / <div> that hold just a version string
    if not version_headings:
        version_headings = [
            tag for tag in soup.find_all(True)
            if version_pattern.match(clean_text(tag.get_text()))
            and tag.name not in ("script", "style", "code", "a")
        ]

    for vh in version_headings:
        version_str = clean_text(vh.get_text())

        # Try to find the date near this heading
        date_str = ""
        # Check siblings / parent siblings
        for candidate in [vh.next_sibling, vh.find_next(string=date_pattern)]:
            if candidate:
                t = clean_text(str(candidate)) if isinstance(candidate, str) else clean_text(candidate.get_text())
                if date_pattern.search(t):
                    date_str = date_pattern.search(t).group(0)
                    break

        sections: dict[str, list[str]] = {}
        current_section = "Core"  # default if no sub-heading found

        # Collect everything until the next version heading
        node = vh.next_sibling
        while node:
            # Stop when we hit the next version heading
            if hasattr(node, "name") and node.name and re.match(r"^h[1-6]$", node.name):
                heading_text = clean_text(node.get_text())
                if version_pattern.match(heading_text):
                    break
                # Otherwise it's a section heading
                current_section = heading_text
                if current_section not in sections:
                    sections[current_section] = []
            elif hasattr(node, "name") and node.name == "ul":
                bullets = sections.setdefault(current_section, [])
                for li in node.find_all("li", recursive=False):
                    text = clean_text(li.get_text())
                    if text:
                        bullets.append(format_bullet(text))
            elif hasattr(node, "name") and node.name == "li":
                text = clean_text(node.get_text())
                if text:
                    sections.setdefault(current_section, []).append(format_bullet(text))
            node = node.next_sibling

        versions.append({"version": version_str, "date": date_str, "sections": sections})

    # ---- Fallback: no structured headings found – try a flat text walk ----
    if not versions:
        versions = parse_versions_flat(soup)

    return versions


def parse_versions_flat(soup: BeautifulSoup) -> list[dict]:
    """
    Heuristic fallback: collect all visible text, split on version lines.
    """
    lines = [clean_text(t) for t in soup.stripped_strings if clean_text(t)]

    version_pattern = re.compile(r"^v\d+\.\d+\.\d+$")
    date_pattern = re.compile(r"^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$")
    section_keywords = set(SECTION_ORDER)

    versions: list[dict] = []
    current: dict | None = None
    current_section = "Core"

    for line in lines:
        if version_pattern.match(line):
            if current:
                versions.append(current)
            current = {"version": line, "date": "", "sections": {}}
            current_section = "Core"
        elif current is None:
            continue
        elif date_pattern.match(line):
            current["date"] = line
        elif line in section_keywords:
            current_section = line
            current["sections"].setdefault(current_section, [])
        elif line.startswith("(") and line.endswith(")"):
            # e.g. "(No changes listed)" — skip
            pass
        elif len(line) > 5:
            current["sections"].setdefault(current_section, []).append(format_bullet(line))

    if current:
        versions.append(current)

    return versions


def render_changelog(versions: list[dict], timestamp: str) -> str:
    lines: list[str] = [HEADER.format(timestamp=timestamp)]

    for v in versions:
        # Version heading
        date_part = f" — {v['date']}" if v["date"] else ""
        lines.append(f"# {v['version']}{date_part}\n")

        sections = v["sections"]
        if not sections:
            lines.append("*(No changes listed)*\n")
        else:
            # Emit sections in preferred order, then any extras
            ordered_keys = [k for k in SECTION_ORDER if k in sections]
            extra_keys = [k for k in sections if k not in SECTION_ORDER]
            for key in ordered_keys + extra_keys:
                bullets = sections[key]
                if not bullets:
                    continue
                lines.append(f"## {key}\n")
                lines.extend(bullets)
                lines.append("")

        lines.append("---\n")

    return "\n".join(lines)


def main() -> int:
    print(f"Fetching changelog from {CHANGELOG_URL} …")
    try:
        soup = fetch_page(CHANGELOG_URL)
    except requests.RequestException as exc:
        print(f"ERROR: Could not fetch changelog: {exc}", file=sys.stderr)
        return 1

    versions = parse_versions(soup)
    if not versions:
        print("ERROR: No version entries found – the page structure may have changed.",
              file=sys.stderr)
        return 1

    print(f"Parsed {len(versions)} version(s): "
          f"{versions[0]['version']} … {versions[-1]['version']}")

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    content = render_changelog(versions, timestamp)

    OUTPUT_PATH.write_text(content, encoding="utf-8")
    print(f"Written → {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
