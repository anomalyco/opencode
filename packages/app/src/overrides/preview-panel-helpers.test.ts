import { describe, expect, test } from "bun:test"
import { PREVIEW_URL, PLACEHOLDER_HTML } from "./preview-panel-helpers"

describe("PREVIEW_URL", () => {
  test("points to the laterdev preview endpoint", () => {
    expect(PREVIEW_URL).toBe("https://vibe.laterdev.com/preview")
  })

  test("is a full HTTPS URL", () => {
    expect(PREVIEW_URL).toMatch(/^https:\/\//)
  })

  test("does not have a trailing slash", () => {
    expect(PREVIEW_URL).not.toMatch(/\/$/)
  })
})

describe("PLACEHOLDER_HTML", () => {
  test("is a valid HTML document", () => {
    expect(PLACEHOLDER_HTML).toContain("<!DOCTYPE html>")
    expect(PLACEHOLDER_HTML).toContain("<html")
    expect(PLACEHOLDER_HTML).toContain("</html>")
  })

  test("contains the start button with correct postMessage", () => {
    expect(PLACEHOLDER_HTML).toContain("preview-start")
    expect(PLACEHOLDER_HTML).toContain("window.parent.postMessage")
  })

  test("contains the retry button with correct postMessage", () => {
    expect(PLACEHOLDER_HTML).toContain("preview-retry")
  })

  test("contains all three UI states", () => {
    expect(PLACEHOLDER_HTML).toContain("state-idle")
    expect(PLACEHOLDER_HTML).toContain("state-loading")
    expect(PLACEHOLDER_HTML).toContain("state-timeout")
  })

  test("contains user-friendly copy without technical jargon", () => {
    expect(PLACEHOLDER_HTML).toContain("Nothing to show yet")
    expect(PLACEHOLDER_HTML).toContain("Start your app")
    expect(PLACEHOLDER_HTML).toContain("Getting things ready")
    expect(PLACEHOLDER_HTML).toContain("Taking longer than expected")
    expect(PLACEHOLDER_HTML).not.toContain("dev server")
    expect(PLACEHOLDER_HTML).not.toContain("502")
    expect(PLACEHOLDER_HTML).not.toContain("Bad Gateway")
  })

  test("listens for parent messages to switch states", () => {
    expect(PLACEHOLDER_HTML).toContain("addEventListener")
    expect(PLACEHOLDER_HTML).toContain("e.data.state")
  })

  test("has dark theme styles", () => {
    expect(PLACEHOLDER_HTML).toContain("#191515")
  })

  test("has light theme fallback", () => {
    expect(PLACEHOLDER_HTML).toContain("prefers-color-scheme: light")
    expect(PLACEHOLDER_HTML).toContain("#fcfcfc")
  })

  test("includes the play icon SVG in the start button", () => {
    expect(PLACEHOLDER_HTML).toContain("M6 4L16 10L6 16V4Z")
  })

  test("includes a loading spinner animation", () => {
    expect(PLACEHOLDER_HTML).toContain("@keyframes spin")
    expect(PLACEHOLDER_HTML).toContain("spinner")
  })

  test("does not do fetch from inside the iframe", () => {
    expect(PLACEHOLDER_HTML).not.toContain("fetch(")
  })
})

describe("postMessage protocol", () => {
  test("iframe sends preview-start when start button is clicked", () => {
    expect(PLACEHOLDER_HTML).toContain("{type:'preview-start'}")
  })

  test("iframe sends preview-retry when retry button is clicked", () => {
    expect(PLACEHOLDER_HTML).toContain("{type:'preview-retry'}")
  })

  test("iframe accepts state messages from parent", () => {
    expect(PLACEHOLDER_HTML).toContain("document.body.className")
  })
})
