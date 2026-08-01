import { describe, expect, test } from "bun:test"
import { normalizePreviewBounds, normalizePreviewElement, normalizePreviewUrl } from "./browser-preview-policy"

describe("normalizePreviewUrl", () => {
  test("accepts local and public HTTP and HTTPS URLs", () => {
    expect(normalizePreviewUrl("localhost:3000/app?mode=dev")).toBe("http://localhost:3000/app?mode=dev")
    expect(normalizePreviewUrl("https://127.0.0.1:8443/")).toBe("https://127.0.0.1:8443/")
    expect(normalizePreviewUrl("http://[::1]:5173/")).toBe("http://[::1]:5173/")
    expect(normalizePreviewUrl("https://example.com/docs?q=preview")).toBe("https://example.com/docs?q=preview")
  })

  test("rejects unsupported and credentialed URLs", () => {
    expect(() => normalizePreviewUrl("file:///tmp/index.html")).toThrow("HTTP")
    expect(() => normalizePreviewUrl("http://user:pass@localhost:3000")).toThrow("credentials")
    expect(() => normalizePreviewUrl("javascript:alert(1)")).toThrow("HTTP")
    expect(() => normalizePreviewUrl(`https://example.com/${"x".repeat(2048)}`)).toThrow("too long")
  })
})

describe("normalizePreviewElement", () => {
  test("accepts bounded page element metadata and owns the URL", () => {
    expect(
      normalizePreviewElement(
        {
          selector: "main > button:nth-of-type(2)",
          tag: "BUTTON",
          text: "Save",
          html: '<button type="button">Save</button>',
          rect: { x: 10, y: 20, width: 80, height: 32 },
        },
        "https://example.com/settings",
      ),
    ).toEqual({
      url: "https://example.com/settings",
      selector: "main > button:nth-of-type(2)",
      tag: "button",
      text: "Save",
      html: '<button type="button">Save</button>',
      rect: { x: 10, y: 20, width: 80, height: 32 },
      textTruncated: false,
      htmlTruncated: false,
    })
  })

  test("removes sensitive query and fragment data from element URLs", () => {
    const element = normalizePreviewElement(
      {
        selector: "#account",
        tag: "DIV",
        text: "Account",
        html: '<div id="account">Account</div>',
        rect: { x: 0, y: 0, width: 100, height: 40 },
      },
      "https://example.com/account?reset_token=secret#recovery-code",
    )

    expect(element.url).toBe("https://example.com/account")
  })

  test("rejects malformed metadata", () => {
    expect(() =>
      normalizePreviewElement(
        { selector: "", tag: "button", text: "", html: "", rect: { x: 0, y: 0, width: 1, height: 1 } },
        "https://example.com",
      ),
    ).toThrow("selector")
    expect(() =>
      normalizePreviewElement(
        { selector: "#x", tag: "bad tag", text: "", html: "", rect: { x: 0, y: 0, width: 1, height: 1 } },
        "https://example.com",
      ),
    ).toThrow("tag")
    expect(() =>
      normalizePreviewElement(
        { selector: "#x", tag: "div", text: "", html: "", rect: { x: 0, y: 0, width: -1, height: 1 } },
        "https://example.com",
      ),
    ).toThrow("bounds")
  })
})

describe("normalizePreviewBounds", () => {
  test("converts CSS coordinates using renderer zoom and clamps to the window", () => {
    expect(
      normalizePreviewBounds({ x: 600, y: 40, width: 500, height: 600 }, { width: 1600, height: 1000 }, 1.25),
    ).toEqual({ x: 750, y: 50, width: 625, height: 750 })

    expect(normalizePreviewBounds({ x: 700, y: 500, width: 400, height: 400 }, { width: 800, height: 600 }, 1)).toEqual(
      { x: 700, y: 500, width: 100, height: 100 },
    )
  })

  test("rejects invalid or empty bounds", () => {
    expect(normalizePreviewBounds({ x: 0, y: 0, width: 0, height: 100 }, { width: 800, height: 600 }, 1)).toBeNull()
    expect(
      normalizePreviewBounds({ x: Number.NaN, y: 0, width: 100, height: 100 }, { width: 800, height: 600 }, 1),
    ).toBeNull()
  })
})
