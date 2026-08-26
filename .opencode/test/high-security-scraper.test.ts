import { describe, expect, test } from "bun:test"
import {
  isHighSecuritySite,
  detectLoginWall,
  formatHighSecurityResult,
  type HighSecurityScrapeResult,
  type ScraplingCrawlResult,
} from "../lib/high-security-scraper"

describe("isHighSecuritySite", () => {
  test("detects LinkedIn domains", () => {
    expect(isHighSecuritySite("https://www.linkedin.com/in/someone/")).toBe(true)
    expect(isHighSecuritySite("https://linkedin.com/in/someone/")).toBe(true)
    expect(isHighSecuritySite("https://jp.linkedin.com/in/someone/")).toBe(true)
  })

  test("detects other high-security domains", () => {
    expect(isHighSecuritySite("https://www.instagram.com/profile")).toBe(true)
    expect(isHighSecuritySite("https://www.facebook.com/profile")).toBe(true)
    expect(isHighSecuritySite("https://twitter.com/user")).toBe(true)
    expect(isHighSecuritySite("https://x.com/user")).toBe(true)
  })

  test("does not detect normal websites", () => {
    expect(isHighSecuritySite("https://example.com")).toBe(false)
    expect(isHighSecuritySite("https://github.com/user")).toBe(false)
    expect(isHighSecuritySite("https://stackoverflow.com/questions")).toBe(false)
  })

  test("handles malformed URLs", () => {
    expect(isHighSecuritySite("not-a-url")).toBe(false)
    expect(isHighSecuritySite("")).toBe(false)
  })
})

describe("detectLoginWall", () => {
  test("detects sign-in prompts", () => {
    const result: ScraplingCrawlResult = {
      success: true,
      page: { title: "Sign in to view" },
      content: { text: "Sign in to view this profile" },
    }
    const detection = detectLoginWall(result)
    expect(detection.detected).toBe(true)
    expect(detection.reason).toContain("Pattern matched")
  })

  test("detects join prompts", () => {
    const result: ScraplingCrawlResult = {
      success: true,
      page: { title: "Join LinkedIn" },
      content: { text: "Create a free account to view" },
    }
    const detection = detectLoginWall(result)
    expect(detection.detected).toBe(true)
  })

  test("does not detect normal content", () => {
    const result: ScraplingCrawlResult = {
      success: true,
      page: { title: "Profile - Software Engineer" },
      content: {
        text: "Software Engineer with 10 years of experience in web development. Passionate about building scalable applications.",
        paragraphs: ["Experience", "Education", "Skills"],
      },
    }
    const detection = detectLoginWall(result)
    expect(detection.detected).toBe(false)
  })
})

describe("formatHighSecurityResult", () => {
  test("formats metadata section", () => {
    const result: HighSecurityScrapeResult = {
      metadata: {
        url: "https://www.linkedin.com/in/someone/",
        domain: "www.linkedin.com",
        scraper: "Scrapling",
        mode: "Browser",
        securityLevel: "High",
        rendered: true,
        autoScroll: true,
        contentType: "Visible Page",
        source: "TUI",
      },
      details: {
        initialHtmlFetch: false,
        browserNavigation: true,
        scrollIterations: -1,
        dynamicContentLoaded: true,
        finalScrollHeight: -1,
        status: "Success",
      },
      title: "John Doe - Software Engineer",
      content: "Software Engineer with 10 years of experience",
      headings: [{ level: 1, text: "John Doe" }],
      links: [],
      raw: {} as ScraplingCrawlResult,
    }

    const formatted = formatHighSecurityResult(result)

    expect(formatted).toContain("Metadata")
    expect(formatted).toContain("URL: https://www.linkedin.com/in/someone/")
    expect(formatted).toContain("Domain: www.linkedin.com")
    expect(formatted).toContain("Scraper: Scrapling")
    expect(formatted).toContain("Mode: Browser")
    expect(formatted).toContain("Security Level: High")
    expect(formatted).toContain("Rendered: Yes")
    expect(formatted).toContain("Auto Scroll: Yes")
  })

  test("formats scrape details section", () => {
    const result: HighSecurityScrapeResult = {
      metadata: {
        url: "https://www.linkedin.com/in/someone/",
        domain: "www.linkedin.com",
        scraper: "Scrapling",
        mode: "Browser",
        securityLevel: "High",
        rendered: true,
        autoScroll: true,
        contentType: "Visible Page",
        source: "TUI",
      },
      details: {
        initialHtmlFetch: false,
        browserNavigation: true,
        scrollIterations: 5,
        dynamicContentLoaded: true,
        finalScrollHeight: 5000,
        status: "Success",
      },
      title: "Profile",
      content: "Content",
      headings: [],
      links: [],
      raw: {} as ScraplingCrawlResult,
    }

    const formatted = formatHighSecurityResult(result)

    expect(formatted).toContain("Scrape Details")
    expect(formatted).toContain("Initial HTML Fetch: No")
    expect(formatted).toContain("Browser Navigation: Yes")
    expect(formatted).toContain("Scroll Iterations: 5")
    expect(formatted).toContain("Dynamic Content Loaded: Yes")
    expect(formatted).toContain("Final Scroll Height: 5000")
    expect(formatted).toContain("Status: Success")
  })

  test("formats login wall detection", () => {
    const result: HighSecurityScrapeResult = {
      metadata: {
        url: "https://www.linkedin.com/in/someone/",
        domain: "www.linkedin.com",
        scraper: "Scrapling",
        mode: "Browser",
        securityLevel: "High",
        rendered: true,
        autoScroll: true,
        contentType: "Visible Page",
        source: "TUI",
      },
      details: {
        initialHtmlFetch: false,
        browserNavigation: true,
        scrollIterations: 0,
        dynamicContentLoaded: false,
        finalScrollHeight: -1,
        status: "Restricted",
        loginWall: { detected: true, reason: "Pattern matched: sign\\s*in" },
      },
      title: "Sign in to view",
      content: "Sign in to view this profile",
      headings: [],
      links: [],
      raw: {} as ScraplingCrawlResult,
    }

    const formatted = formatHighSecurityResult(result)

    expect(formatted).toContain("Login Wall: Detected")
    expect(formatted).toContain("ACCESS RESTRICTION DETECTED")
    expect(formatted).toContain("Sign in to view this profile")
  })

  test("formats error status", () => {
    const result: HighSecurityScrapeResult = {
      metadata: {
        url: "https://www.linkedin.com/in/someone/",
        domain: "www.linkedin.com",
        scraper: "Scrapling",
        mode: "Browser",
        securityLevel: "High",
        rendered: true,
        autoScroll: true,
        contentType: "Visible Page",
        source: "TUI",
      },
      details: {
        initialHtmlFetch: false,
        browserNavigation: true,
        scrollIterations: 0,
        dynamicContentLoaded: false,
        finalScrollHeight: -1,
        status: "Failed",
        error: "Timeout: Page did not load within 90s",
      },
      title: "Error",
      content: "",
      headings: [],
      links: [],
      raw: {} as ScraplingCrawlResult,
    }

    const formatted = formatHighSecurityResult(result)

    expect(formatted).toContain("Status: Failed")
    expect(formatted).toContain("Error: Timeout: Page did not load within 90s")
  })
})