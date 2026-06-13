import { describe, expect, test } from "bun:test"
import {
  DEFAULT_BROWSER_URL,
  browserAnnotationsText,
  browserTabTitle,
  normalizeBrowserAnnotations,
  normalizeBrowserUrl,
} from "./browser-tab"

describe("normalizeBrowserUrl", () => {
  test("keeps explicit protocols unchanged", () => {
    expect(normalizeBrowserUrl("https://example.com/docs")).toBe("https://example.com/docs")
    expect(normalizeBrowserUrl("file:///tmp/index.html")).toBe("file:///tmp/index.html")
  })

  test("defaults remote hosts to https and localhost to http", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com")
    expect(normalizeBrowserUrl("localhost:3000/test")).toBe("http://localhost:3000/test")
    expect(normalizeBrowserUrl("127.0.0.1:4096")).toBe("http://127.0.0.1:4096")
  })

  test("treats freeform input as a search query", () => {
    expect(normalizeBrowserUrl("react router docs")).toBe("https://duckduckgo.com/?q=react%20router%20docs")
  })
})

describe("browserTabTitle", () => {
  test("falls back to a friendly default", () => {
    expect(browserTabTitle()).toBe("Browser")
    expect(browserTabTitle("")).toBe("Browser")
  })

  test("uses the hostname when available", () => {
    expect(browserTabTitle(DEFAULT_BROWSER_URL)).toBe("duckduckgo.com")
    expect(browserTabTitle("localhost:3000")).toBe("localhost")
  })
})

describe("browser annotations", () => {
  test("normalizes persisted browser annotations", () => {
    const annotations = normalizeBrowserAnnotations([
      {
        id: "ann_1",
        type: "highlight",
        url: "https://example.com",
        title: "Example",
        text: "Selected text",
        createdAt: 123,
      },
      {
        id: "bad",
        type: "unknown",
        url: "https://example.com",
        text: "ignored",
        createdAt: 456,
      },
    ])

    expect(annotations).toHaveLength(1)
    expect(annotations[0]?.id).toBe("ann_1")
    expect(annotations[0]?.title).toBe("Example")
  })

  test("serializes browser annotations for chat context", () => {
    const text = browserAnnotationsText([
      {
        id: "ann_1",
        type: "note",
        url: "https://example.com",
        title: "Example",
        text: "Selected text",
        note: "Check this claim",
        createdAt: 123,
      },
    ])

    expect(text).toContain("<browser-annotations>")
    expect(text).toContain("Annotation 1 (note)")
    expect(text).toContain("Text: Selected text")
    expect(text).toContain("Note: Check this claim")
  })
})
