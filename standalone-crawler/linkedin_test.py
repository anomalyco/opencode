#!/usr/bin/env python3
"""LinkedIn profile crawler test.

Two-phase approach:
  Phase 1 (login):  python linkedin_test.py login
      Opens LinkedIn login in a headed persistent browser.
      User manually logs in. Browser closes after 5 minutes.

  Phase 2 (crawl):  python linkedin_test.py crawl
      Uses the saved profile to crawl the target LinkedIn profile URL.
      Outputs extracted JSON + saves raw HTML.
"""

from __future__ import annotations

import json
import os
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from standalone_crawler.config import CrawlerConfig
from standalone_crawler.crawler import Crawler
from standalone_crawler.logging_config import configure_logging

PROFILE_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "linkedin-crawler-profile",
)
LOGIN_URL = "https://www.linkedin.com/login"
TARGET_URL = "https://www.linkedin.com/in/sashriya-m/"
OUTPUT_DIR = Path(__file__).parent


def phase_login() -> int:
    """Open LinkedIn login with headed persistent browser; user logs in manually."""
    print(f"Profile dir: {PROFILE_DIR}", file=sys.stderr)
    print(f"Opening: {LOGIN_URL}", file=sys.stderr)
    print("Please log in manually. The browser will close in 5 minutes.", file=sys.stderr)

    config = CrawlerConfig(
        fetch_mode="browser",
        headless=False,
        browser_profile=PROFILE_DIR,
        hold_open_seconds=300,
        timeout=60,
        block_private_networks=False,
    )

    crawler = Crawler()
    try:
        result = crawler.crawl(LOGIN_URL, config)
        final = result.response.final_url if result.response else LOGIN_URL
        print(f"Login phase completed. URL: {final}", file=sys.stderr)
        return 0
    except Exception as exc:
        print(f"Login phase error: {exc}", file=sys.stderr)
        return 1


def phase_crawl() -> int:
    """Crawl the target LinkedIn profile using the saved authenticated profile."""
    if not Path(PROFILE_DIR).exists():
        print(f"ERROR: Profile dir does not exist: {PROFILE_DIR}", file=sys.stderr)
        print("Run 'python linkedin_test.py login' first.", file=sys.stderr)
        return 1

    print(f"Profile dir: {PROFILE_DIR}", file=sys.stderr)
    print(f"Crawling: {TARGET_URL}", file=sys.stderr)

    config = CrawlerConfig(
        fetch_mode="browser",
        headless=True,
        browser_profile=PROFILE_DIR,
        timeout=60,
        network_idle=True,
        block_private_networks=False,
    )

    crawler = Crawler()
    result = crawler.crawl(TARGET_URL, config)

    # Save raw HTML
    html_path = OUTPUT_DIR / "linkedin_raw.html"
    html_path.write_text(result.raw_html, encoding="utf-8")
    print(f"Raw HTML saved to: {html_path}", file=sys.stderr)

    # Classify result
    html_lower = result.raw_html.lower()
    final_url = (result.response.final_url if result.response else None) or ""
    status_code = result.response.status_code if result.response else None

    classification = classify_linkedin_result(status_code, final_url, html_lower)

    # Extract fields
    extracted = extract_profile_fields(result.raw_html)

    output = {
        "classification": classification,
        "http_status": status_code,
        "final_url": final_url,
        "profile_url": TARGET_URL,
        "extracted_fields": extracted,
        "html_size_bytes": len(result.raw_html.encode("utf-8")),
        "html_path": str(html_path),
    }

    # Save JSON
    json_path = OUTPUT_DIR / "linkedin_result.json"
    json_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"JSON result saved to: {json_path}", file=sys.stderr)

    # Print to stdout
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0 if classification == "success" else 1


def classify_linkedin_result(
    status: int | None, final_url: str, html_lower: str
) -> str:
    """Classify the LinkedIn crawl result."""
    if "authwall" in final_url or "login" in final_url:
        return "login_wall"
    if status == 999:
        return "authwall"
    if "/404/" in final_url:
        return "profile_not_found"
    if "doesn't exist" in html_lower or "does not exist" in html_lower:
        return "profile_not_found"
    if "page not found" in html_lower:
        return "profile_not_found"
    if status is not None and status >= 400:
        return "http_error"
    if "riya" in html_lower or "sashriya" in html_lower:
        return "success"
    if "experience" in html_lower or "education" in html_lower:
        return "success"
    return "partial"


def extract_profile_fields(html: str) -> dict:
    """Extract basic profile fields from LinkedIn HTML using string matching."""
    import re

    fields: dict = {}

    # Name: from <title> tag (most reliable)
    m = re.search(r'<title[^>]*>([^|]+)\s*\|', html)
    if m:
        fields["name"] = m.group(1).strip()

    # Headline: text in <span> after the name <p> tag
    m = re.search(r'Sashriya M</p>.*?<span[^>]*>([^<]+)</span>', html, re.DOTALL)
    if m:
        fields["headline"] = m.group(1).strip()

    # Location: look for city, state, country pattern
    m = re.search(r'([A-Z][a-z]+,\s*[A-Z][a-z]+,\s*India)', html)
    if m:
        fields["location"] = m.group(1)

    # About: content in <span> after "About" section header
    m = re.search(r'About</h2>.*?<span[^>]*>(.*?)</span>', html, re.DOTALL)
    if m:
        about_text = m.group(1).strip()
        about_text = re.sub(r'<[^>]+>', '', about_text)
        fields["about"] = about_text[:500]

    # Current company: first company name in experience (avatar alt text)
    m = re.search(r'alt="(Zenteiq[^"]*)"', html)
    if m:
        fields["current_company"] = m.group(1).strip()

    # Education: university/college name
    edu_patterns = [
        r'([A-Z][a-zA-Z\s]+University)',
        r'([A-Z][a-zA-Z\s]+College)',
        r'([A-Z][a-zA-Z\s]+Institute)',
    ]
    for p in edu_patterns:
        m = re.search(p, html)
        if m:
            fields["education"] = m.group(1).strip()
            break

    # Profile URL
    fields["profile_url"] = "https://www.linkedin.com/in/sashriya-m/"

    return fields


def main() -> int:
    configure_logging("INFO")
    if len(sys.argv) < 2:
        print("Usage: python linkedin_test.py <login|crawl>", file=sys.stderr)
        return 1

    command = sys.argv[1].lower()
    if command == "login":
        return phase_login()
    elif command == "crawl":
        return phase_crawl()
    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        print("Usage: python linkedin_test.py <login|crawl>", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
