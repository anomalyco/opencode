import { describe, expect, test } from "bun:test"
import {
  markdownClipboardFont,
  markdownClipboardMonoFont,
  serializeMarkdownClipboardHTML,
  writeClipboardPayload,
  writeMarkdownClipboard,
} from "./markdown-copy"

describe("markdown clipboard html", () => {
  test("wraps content with inline font stack", () => {
    const html = serializeMarkdownClipboardHTML("<p>Hello <strong>world</strong></p>")
    expect(html).toContain(`<div style="font-family: ${markdownClipboardFont};">`)
    expect(html).toContain("<p>Hello <strong>world</strong></p>")
    expect(html).not.toContain("var(--font-family-sans)")
  })

  test("inlines link and code styles", () => {
    if (typeof DOMParser === "undefined") return
    const html = serializeMarkdownClipboardHTML(
      '<p><a href="https://opencode.ai">OpenCode</a></p><pre><code>echo test</code></pre>',
    )
    expect(html).toContain("color: #0b66d2")
    expect(html).toContain(`font-family: ${markdownClipboardMonoFont}`)
    expect(html).toContain("background: #f6f8fa")
  })

  test("returns empty string for blank html", () => {
    expect(serializeMarkdownClipboardHTML("   ")).toBe("")
  })
})

describe("markdown clipboard payload", () => {
  test("writes both plain text and html mime types", async () => {
    const originalNavigator = globalThis.navigator
    const originalClipboardItem = globalThis.ClipboardItem

    const writes: unknown[][] = []
    class FakeClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }

    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          write: async (items: unknown[]) => {
            writes.push(items)
          },
          writeText: async () => {},
        },
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, "ClipboardItem", { value: FakeClipboardItem, configurable: true })

    await writeClipboardPayload({ text: "hello", html: "<p>hello</p>" })

    expect(writes.length).toBe(1)
    const item = writes[0]?.[0] as FakeClipboardItem
    expect(item.data["text/plain"]).toBeInstanceOf(Blob)
    expect(item.data["text/html"]).toBeInstanceOf(Blob)
    expect(await item.data["text/plain"]?.text()).toBe("hello")
    expect(await item.data["text/html"]?.text()).toBe("<p>hello</p>")

    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true })
    Object.defineProperty(globalThis, "ClipboardItem", { value: originalClipboardItem, configurable: true })
  })

  test("falls back to writeText when html is missing", async () => {
    const originalNavigator = globalThis.navigator
    const originalClipboardItem = globalThis.ClipboardItem

    const textWrites: string[] = []
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          write: async () => {},
          writeText: async (value: string) => {
            textWrites.push(value)
          },
        },
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, "ClipboardItem", { value: undefined, configurable: true })

    await writeClipboardPayload({ text: "plain" })

    expect(textWrites).toEqual(["plain"])

    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true })
    Object.defineProperty(globalThis, "ClipboardItem", { value: originalClipboardItem, configurable: true })
  })

  test("serializes markdown html before writing clipboard payload", async () => {
    const originalNavigator = globalThis.navigator
    const originalClipboardItem = globalThis.ClipboardItem

    const writes: unknown[][] = []
    class FakeClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }

    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          write: async (items: unknown[]) => {
            writes.push(items)
          },
          writeText: async () => {},
        },
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, "ClipboardItem", { value: FakeClipboardItem, configurable: true })

    await writeMarkdownClipboard({ text: "hello", html: "<pre><code>echo test</code></pre>" })

    const item = writes[0]?.[0] as FakeClipboardItem
    expect(await item.data["text/plain"]?.text()).toBe("hello")
    expect(await item.data["text/html"]?.text()).toContain(`<div style="font-family: ${markdownClipboardFont};">`)
    expect(await item.data["text/html"]?.text()).toContain("<pre><code>echo test</code></pre>")

    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true })
    Object.defineProperty(globalThis, "ClipboardItem", { value: originalClipboardItem, configurable: true })
  })
})
