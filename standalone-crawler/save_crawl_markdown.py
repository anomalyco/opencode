#!/usr/bin/env python3
"""
Convert a crawler JSON result into a Markdown file.

Usage:
    python save_crawl_markdown.py result.json

Or from stdin:
    python crawler_cli.py ... | python save_crawl_markdown.py -

Optional output directory:
    python save_crawl_markdown.py result.json custom_output_dir

The writer never overwrites an existing Markdown file.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "crawl_output"


class CrawlerMarkdownError(Exception):
    """Custom exception for crawler Markdown conversion errors."""


def load_json(source: str) -> dict[str, Any]:
    """Load JSON from a file or stdin with validation and error handling."""
    try:
        if source == "-":
            raw = sys.stdin.read()
        else:
            raw = Path(source).read_text(encoding="utf-8")

        if not raw.strip():
            raise CrawlerMarkdownError("Input JSON is empty.")

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise CrawlerMarkdownError(
                f"Invalid JSON input at line {exc.lineno}, "
                f"column {exc.colno}: {exc.msg}"
            ) from exc

        if not isinstance(data, dict):
            raise CrawlerMarkdownError(
                "Crawler result must be a JSON object."
            )

        expected_keys = {
            "extracted_fields",
            "request",
            "response",
            "page",
            "content",
        }

        if not any(key in data for key in expected_keys):
            raise CrawlerMarkdownError(
                "Invalid crawler data. Expected at least one of: "
                + ", ".join(sorted(expected_keys))
            )

        return data

    except FileNotFoundError as exc:
        raise CrawlerMarkdownError(
            f"Input file not found: {source}"
        ) from exc

    except PermissionError as exc:
        raise CrawlerMarkdownError(
            f"Cannot read input file: {source}"
        ) from exc

    except OSError as exc:
        raise CrawlerMarkdownError(
            f"Cannot read input: {exc}"
        ) from exc


def safe_slug(
    value: str,
    fallback: str = "crawl",
    max_length: int = 50,
) -> str:
    """Create a filesystem-safe filename slug."""
    if not isinstance(value, str) or not value.strip():
        return fallback

    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = value.strip("-")
    value = value[:max_length].rstrip("-")

    return value or fallback


def profile_name(data: dict[str, Any]) -> str:
    """
    Determine a useful filename base from the crawler result.

    Priority:
      1. extracted_fields.name
      2. request.url path
      3. page.title
      4. generic 'crawl'
    """
    fields = data.get("extracted_fields")

    if isinstance(fields, dict):
        name = fields.get("name")

        if isinstance(name, str) and name.strip():
            return name.strip()

    request = data.get("request")

    if isinstance(request, dict):
        url = request.get("url")

        if isinstance(url, str) and url.strip():
            try:
                parsed = urlparse(url)
                parts = [
                    part for part in parsed.path.split("/")
                    if part
                ]

                if parts:
                    return parts[-1]

            except ValueError:
                pass

    page = data.get("page")

    if isinstance(page, dict):
        title = page.get("title")

        if isinstance(title, str) and title.strip():
            title = title.strip()

            # Example LinkedIn title:
            # Sashriya M | LinkedIn
            return title.split("|")[0].strip()

    return "crawl"


def unique_output_path(
    output_dir: Path,
    base_name: str,
) -> Path:
    """
    Generate a unique Markdown output path.

    Example:
        sashriya-m_20260824_151530.md
        sashriya-m_20260824_151530_2.md
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = safe_slug(base_name)

    candidate = output_dir / f"{base}_{stamp}.md"

    counter = 2

    while candidate.exists():
        candidate = output_dir / f"{base}_{stamp}_{counter}.md"
        counter += 1

    return candidate


def add_field(
    lines: list[str],
    label: str,
    value: Any,
) -> None:
    """Add a value to Markdown with appropriate formatting."""
    if value is None:
        return

    if isinstance(value, str):
        value = value.strip()

        if not value:
            return

        if "\n" in value:
            lines.append(f"## {label}")
            lines.append("")
            lines.append(value)
            lines.append("")
        else:
            lines.append(f"- **{label}:** {value}")

        return

    if isinstance(value, list):
        if not value:
            return

        lines.append(f"## {label}")
        lines.append("")

        for item in value:
            if isinstance(item, dict):
                lines.append(
                    "- "
                    + json.dumps(
                        item,
                        ensure_ascii=False,
                    )
                )
            elif isinstance(item, (list, tuple)):
                lines.append(
                    "- "
                    + json.dumps(
                        item,
                        ensure_ascii=False,
                    )
                )
            else:
                lines.append(f"- {item}")

        lines.append("")
        return

    if isinstance(value, dict):
        lines.append(f"## {label}")
        lines.append("")
        lines.append(
            "```json\n"
            + json.dumps(
                value,
                ensure_ascii=False,
                indent=2,
            )
            + "\n```"
        )
        lines.append("")
        return

    lines.append(f"- **{label}:** {value}")


def build_markdown(data: dict[str, Any]) -> str:
    """Build Markdown content from a crawler result."""
    lines: list[str] = []

    fields = data.get("extracted_fields")

    # LinkedIn or other structured extraction result.
    if isinstance(fields, dict):
        name = fields.get("name")

        if isinstance(name, str) and name.strip():
            display_name = name.strip()
        else:
            display_name = "LinkedIn Profile"

        lines.append(f"# {display_name}")
        lines.append("")

        field_order = [
            ("headline", "Headline"),
            ("pronouns", "Pronouns"),
            ("current_company", "Company"),
            ("education", "Education"),
            ("location", "Location"),
            ("connections", "Connections"),
            ("open_to_work", "Open to Work"),
            ("profile_url", "Profile URL"),
            ("about", "About"),
        ]

        known_keys = {key for key, _ in field_order}

        for key, label in field_order:
            if key in fields:
                add_field(lines, label, fields[key])

        extra_fields = [
            (key, value)
            for key, value in fields.items()
            if key not in known_keys
        ]

        if extra_fields:
            lines.append("## Additional Fields")
            lines.append("")

            for key, value in extra_fields:
                label = key.replace("_", " ").title()

                if isinstance(value, (dict, list)):
                    lines.append(f"### {label}")
                    lines.append("")
                    lines.append(
                        "```json\n"
                        + json.dumps(
                            value,
                            ensure_ascii=False,
                            indent=2,
                        )
                        + "\n```"
                    )
                    lines.append("")
                else:
                    add_field(lines, label, value)

    # Generic crawler result.
    else:
        lines.append("# Crawl Result")
        lines.append("")

        request = data.get("request")
        response = data.get("response")
        page = data.get("page")
        content = data.get("content")
        metadata = data.get("metadata")

        if isinstance(request, dict):
            lines.append("## Request")
            lines.append("")

            add_field(lines, "URL", request.get("url"))
            add_field(
                lines,
                "Fetch Mode",
                request.get("fetch_mode"),
            )

            lines.append("")

        if isinstance(response, dict):
            lines.append("## Response")
            lines.append("")

            add_field(
                lines,
                "HTTP Status",
                response.get("status_code"),
            )
            add_field(
                lines,
                "Final URL",
                response.get("final_url"),
            )
            add_field(
                lines,
                "Content Type",
                response.get("content_type"),
            )
            add_field(
                lines,
                "Response Time (ms)",
                response.get("response_time_ms"),
            )

            lines.append("")

        if isinstance(page, dict):
            lines.append("## Page")
            lines.append("")

            add_field(
                lines,
                "Title",
                page.get("title"),
            )
            add_field(
                lines,
                "Description",
                page.get("description"),
            )
            add_field(
                lines,
                "Language",
                page.get("language"),
            )
            add_field(
                lines,
                "Canonical URL",
                page.get("canonical_url"),
            )

            lines.append("")

        if isinstance(metadata, dict) and metadata:
            lines.append("## Metadata")
            lines.append("")
            lines.append(
                "```json\n"
                + json.dumps(
                    metadata,
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n```"
            )
            lines.append("")

        if isinstance(content, dict):
            headings = content.get("headings")
            text = content.get("text")
            paragraphs = content.get("paragraphs")

            if headings:
                lines.append("## Headings")
                lines.append("")

                for heading in headings:
                    heading_text = str(heading).strip()

                    if heading_text:
                        lines.append(f"- {heading_text}")

                lines.append("")

            if text:
                text = str(text).strip()

                if text:
                    lines.append("## Content")
                    lines.append("")
                    lines.append(text)
                    lines.append("")

            if paragraphs:
                lines.append("## Paragraphs")
                lines.append("")

                for paragraph in paragraphs:
                    paragraph_text = str(paragraph).strip()

                    if paragraph_text:
                        lines.append(paragraph_text)
                        lines.append("")

    # Include crawl status and error details when available.
    success = data.get("success")

    if success is not None:
        lines.append("## Crawl Status")
        lines.append("")
        lines.append(f"- **Success:** {success}")

        error = data.get("error")

        if isinstance(error, dict):
            add_field(
                lines,
                "Error Type",
                error.get("type"),
            )
            add_field(
                lines,
                "Error Message",
                error.get("message"),
            )

        lines.append("")

    generated_at = datetime.now().astimezone().strftime(
        "%Y-%m-%d %H:%M:%S %Z"
    )

    lines.append("---")
    lines.append("")
    lines.append(f"*Generated: {generated_at}*")
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    """Main entry point."""
    if len(sys.argv) < 2:
        print(
            "Usage: python save_crawl_markdown.py "
            "<result.json|-> [output_dir]",
            file=sys.stderr,
        )
        return 2

    source = sys.argv[1]

    output_dir = (
        Path(sys.argv[2])
        if len(sys.argv) >= 3
        else DEFAULT_OUTPUT_DIR
    )

    try:
        data = load_json(source)

        base_name = profile_name(data)

        output_path = unique_output_path(
            output_dir=output_dir,
            base_name=base_name,
        )

        markdown = build_markdown(data)

        output_path.write_text(
            markdown,
            encoding="utf-8",
            newline="\n",
        )

        print(f"Markdown saved: {output_path}")

        return 0

    except CrawlerMarkdownError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    except KeyboardInterrupt:
        print("\nInterrupted by user", file=sys.stderr)
        return 130

    except OSError as exc:
        print(
            f"File system error: {exc}",
            file=sys.stderr,
        )
        return 1

    except Exception as exc:  # noqa: BLE001
        print(
            f"Unexpected error: {exc}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
