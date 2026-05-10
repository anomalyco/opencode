import { describe, expect, test } from "bun:test"
import type { BrowserAnnotation } from "@/context/browser-types"
import type { Prompt } from "@/context/prompt"
import { buildRequestParts } from "./build-request-parts"

describe("buildRequestParts", () => {
  test("builds typed request and optimistic parts without cast path", () => {
    const prompt: Prompt = [
      { type: "text", content: "hello", start: 0, end: 5 },
      {
        type: "file",
        path: "src/foo.ts",
        content: "@src/foo.ts",
        start: 5,
        end: 16,
        selection: { startLine: 4, startChar: 1, endLine: 6, endChar: 1 },
      },
      { type: "agent", name: "planner", content: "@planner", start: 16, end: 24 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [{ key: "ctx:1", type: "file", path: "src/bar.ts", comment: "check this" }],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      ],
      text: "hello @src/foo.ts @planner",
      messageID: "msg_1",
      sessionID: "ses_1",
      sessionDirectory: "/repo",
    })

    expect(result.requestParts[0]?.type).toBe("text")
    expect(result.requestParts.some((part) => part.type === "agent")).toBe(true)
    expect(
      result.requestParts.some((part) => part.type === "file" && part.url.startsWith("file:///repo/src/foo.ts")),
    ).toBe(true)
    expect(result.requestParts.some((part) => part.type === "text" && part.synthetic)).toBe(true)
    expect(
      result.requestParts.some(
        (part) =>
          part.type === "text" &&
          part.synthetic &&
          part.metadata?.opencodeComment &&
          (part.metadata.opencodeComment as { comment?: string }).comment === "check this",
      ),
    ).toBe(true)

    expect(result.optimisticParts).toHaveLength(result.requestParts.length)
    expect(result.optimisticParts.every((part) => part.sessionID === "ses_1" && part.messageID === "msg_1")).toBe(true)
  })

  test("keeps multiple uploaded attachments in order", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "check these", start: 0, end: 11 }],
      context: [],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
        {
          type: "image",
          id: "img_2",
          filename: "b.pdf",
          mime: "application/pdf",
          dataUrl: "data:application/pdf;base64,BBB",
        },
      ],
      text: "check these",
      messageID: "msg_multi",
      sessionID: "ses_multi",
      sessionDirectory: "/repo",
    })

    const files = result.requestParts.filter((part) => part.type === "file" && part.url.startsWith("data:"))

    expect(files).toHaveLength(2)
    expect(files.map((part) => (part.type === "file" ? part.filename : ""))).toEqual(["a.png", "b.pdf"])
  })

  test("deduplicates context files when prompt already includes same path", () => {
    const prompt: Prompt = [{ type: "file", path: "src/foo.ts", content: "@src/foo.ts", start: 0, end: 11 }]

    const result = buildRequestParts({
      prompt,
      context: [
        { key: "ctx:dup", type: "file", path: "src/foo.ts" },
        { key: "ctx:comment", type: "file", path: "src/foo.ts", comment: "focus here" },
      ],
      images: [],
      text: "@src/foo.ts",
      messageID: "msg_2",
      sessionID: "ses_2",
      sessionDirectory: "/repo",
    })

    const fooFiles = result.requestParts.filter(
      (part) => part.type === "file" && part.url.startsWith("file:///repo/src/foo.ts"),
    )
    const synthetic = result.requestParts.filter((part) => part.type === "text" && part.synthetic)

    expect(fooFiles).toHaveLength(2)
    expect(synthetic).toHaveLength(1)
  })

  test("adds file parts for @mentions inside comment text", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "look", start: 0, end: 4 }],
      context: [
        {
          key: "ctx:comment-mention",
          type: "file",
          path: "src/review.ts",
          comment: "Compare with @src/shared.ts and @src/review.ts.",
        },
      ],
      images: [],
      text: "look",
      messageID: "msg_comment_mentions",
      sessionID: "ses_comment_mentions",
      sessionDirectory: "/repo",
    })

    const files = result.requestParts.filter((part) => part.type === "file")
    expect(files).toHaveLength(2)
    expect(files.some((part) => part.type === "file" && part.url === "file:///repo/src/review.ts")).toBe(true)
    expect(files.some((part) => part.type === "file" && part.url === "file:///repo/src/shared.ts")).toBe(true)
  })

  test("handles Windows paths correctly (simulated on macOS)", () => {
    const prompt: Prompt = [{ type: "file", path: "src\\foo.ts", content: "@src\\foo.ts", start: 0, end: 11 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src\\foo.ts",
      messageID: "msg_win_1",
      sessionID: "ses_win_1",
      sessionDirectory: "D:\\projects\\myapp", // Windows path
    })

    // Should create valid file URLs
    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should not have encoded backslashes in wrong place
      expect(filePart.url).not.toContain("%5C")
      // Should have normalized to forward slashes
      expect(filePart.url).toContain("/src/foo.ts")
    }
  })

  test("handles Windows absolute path with special characters", () => {
    const prompt: Prompt = [{ type: "file", path: "file#name.txt", content: "@file#name.txt", start: 0, end: 14 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@file#name.txt",
      messageID: "msg_win_2",
      sessionID: "ses_win_2",
      sessionDirectory: "C:\\Users\\test\\Documents", // Windows path
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Special chars should be encoded
      expect(filePart.url).toContain("file%23name.txt")
      // Should have Windows drive letter properly encoded
      expect(filePart.url).toMatch(/file:\/\/\/[A-Z]:/)
    }
  })

  test("handles Linux absolute paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "src/app.ts", content: "@src/app.ts", start: 0, end: 10 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src/app.ts",
      messageID: "msg_linux_1",
      sessionID: "ses_linux_1",
      sessionDirectory: "/home/user/project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should be a normal Unix path
      expect(filePart.url).toBe("file:///home/user/project/src/app.ts")
    }
  })

  test("handles macOS paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "README.md", content: "@README.md", start: 0, end: 9 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@README.md",
      messageID: "msg_mac_1",
      sessionID: "ses_mac_1",
      sessionDirectory: "/Users/kelvin/Projects/opencode",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should be a normal Unix path
      expect(filePart.url).toBe("file:///Users/kelvin/Projects/opencode/README.md")
    }
  })

  test("handles context files with Windows paths", () => {
    const prompt: Prompt = []

    const result = buildRequestParts({
      prompt,
      context: [
        { key: "ctx:1", type: "file", path: "src\\utils\\helper.ts" },
        { key: "ctx:2", type: "file", path: "test\\unit.test.ts", comment: "check tests" },
      ],
      images: [],
      text: "test",
      messageID: "msg_win_ctx",
      sessionID: "ses_win_ctx",
      sessionDirectory: "D:\\workspace\\app",
    })

    const fileParts = result.requestParts.filter((part) => part.type === "file")
    expect(fileParts).toHaveLength(2)

    // All file URLs should be valid
    fileParts.forEach((part) => {
      if (part.type === "file") {
        expect(() => new URL(part.url)).not.toThrow()
        expect(part.url).not.toContain("%5C") // No encoded backslashes
      }
    })
  })

  test("handles absolute Windows paths (user manually specifies full path)", () => {
    const prompt: Prompt = [
      { type: "file", path: "D:\\other\\project\\file.ts", content: "@D:\\other\\project\\file.ts", start: 0, end: 25 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@D:\\other\\project\\file.ts",
      messageID: "msg_abs",
      sessionID: "ses_abs",
      sessionDirectory: "C:\\current\\project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should handle absolute path that differs from sessionDirectory
      expect(() => new URL(filePart.url)).not.toThrow()
      expect(filePart.url).toContain("/D:/other/project/file.ts")
    }
  })

  test("handles selection with query parameters on Windows", () => {
    const prompt: Prompt = [
      {
        type: "file",
        path: "src\\App.tsx",
        content: "@src\\App.tsx",
        start: 0,
        end: 11,
        selection: { startLine: 10, startChar: 0, endLine: 20, endChar: 5 },
      },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src\\App.tsx",
      messageID: "msg_sel",
      sessionID: "ses_sel",
      sessionDirectory: "C:\\project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should have query parameters
      expect(filePart.url).toContain("?start=10&end=20")
      // Should be valid URL
      expect(() => new URL(filePart.url)).not.toThrow()
      // Query params should parse correctly
      const url = new URL(filePart.url)
      expect(url.searchParams.get("start")).toBe("10")
      expect(url.searchParams.get("end")).toBe("20")
    }
  })

  test("handles file paths with dots and special segments on Windows", () => {
    const prompt: Prompt = [
      { type: "file", path: "..\\..\\shared\\util.ts", content: "@..\\..\\shared\\util.ts", start: 0, end: 21 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@..\\..\\shared\\util.ts",
      messageID: "msg_dots",
      sessionID: "ses_dots",
      sessionDirectory: "C:\\projects\\myapp\\src",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should be valid URL
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should preserve .. segments (backend normalizes)
      expect(filePart.url).toContain("/..")
    }
  })

  test("serializes browser annotations into a compact bounded synthetic text part", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "review this", start: 0, end: 11 }],
      context: [],
      images: [],
      annotations: [
        {
          id: "annotation-1",
          createdAt: 1,
          pageUrl: "https://opencode.ai/pricing",
          pageTitle: "Pricing",
          userComment: "CTA copy is vague",
          element: {
            tagName: "button",
            selector: "button[data-testid='cta']",
            role: "button",
            accessibleName: "Start free trial now",
            visibleText: "A".repeat(140),
            attributes: { "data-testid": "cta" },
            boundingBox: { x: 10, y: 20, width: 200, height: 44 },
          },
          preview: {
            screenshotCrop: "data:image/png;base64,AAA",
          },
          context: {
            nearbyDomSanitized: "B".repeat(260),
          },
        } satisfies BrowserAnnotation,
      ],
      text: "review this",
      messageID: "msg_annotation",
      sessionID: "ses_annotation",
      sessionDirectory: "/repo",
    })

    const annotationPart = result.requestParts.find(
      (part) =>
        part.type === "text" &&
        part.synthetic &&
        !!part.metadata?.opencodeAnnotations,
    )

    expect(annotationPart).toBeDefined()
    expect(annotationPart?.type).toBe("text")
    if (annotationPart?.type !== "text") return

    expect(annotationPart.text).toContain("browser annotation")
    expect(annotationPart.text).toContain("browser.annotation.get_detail")

    const metadata = annotationPart.metadata?.opencodeAnnotations as {
      count: number
      compact: Array<{
        id: string
        pageUrl: string
        pageTitle: string
        userComment: string
        selector: string
        role?: string
        accessibleName?: string
        visibleText?: string
        boundingBox: { x: number; y: number; width: number; height: number }
        screenshotCrop?: string
        nearbyDomSanitized?: string
      }>
    }

    expect(metadata.count).toBe(1)
    expect(metadata.compact).toHaveLength(1)
    expect(metadata.compact[0]).toEqual({
      id: "annotation-1",
      pageUrl: "https://opencode.ai/pricing",
      pageTitle: "Pricing",
      userComment: "CTA copy is vague",
      selector: "button[data-testid='cta']",
      role: "button",
      accessibleName: "Start free trial now",
      visibleText: "A".repeat(100),
      boundingBox: { x: 10, y: 20, width: 200, height: 44 },
      screenshotCrop: "data:image/png;base64,AAA",
      nearbyDomSanitized: "B".repeat(200),
    })
  })

  test("injects one compact browser tools hint for @browser without fake agent parts", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "use @browser to inspect console", start: 0, end: 31 }],
      context: [],
      images: [],
      text: "use @browser to inspect console",
      messageID: "msg_browser_hint",
      sessionID: "ses_browser_hint",
      sessionDirectory: "/repo",
      browserIntegratedToolsAvailable: true,
    })

    const browserHints = result.requestParts.filter(
      (part) => part.type === "text" && part.synthetic && !!part.metadata?.opencodeBrowserTools,
    )

    expect(browserHints).toHaveLength(1)
    expect(browserHints[0]?.type).toBe("text")
    if (browserHints[0]?.type !== "text") return
    expect(browserHints[0].text).toContain("Integrated browser tools are available")
    expect(browserHints[0].text).toContain("should be preferred over Playwright/external browsers")
    expect(browserHints[0].text).toContain("integrated browser")
    expect(browserHints[0].text).not.toContain("browser.open")
    expect(browserHints[0].text).toContain("browser_navigate")
    expect(browserHints[0].text).toContain("browser_click")
    expect(browserHints[0].text).toContain("browser_type")
    expect(browserHints[0].text).toContain("browser_back")
    expect(browserHints[0].text).toContain("browser_forward")
    expect(browserHints[0].text).toContain("browser_reload")
    expect(browserHints[0].text).toContain("browser_screenshot")
    expect(browserHints[0].text).toContain("browser_inspect")
    expect(browserHints[0].text).toContain("browser_console_messages")
    expect(browserHints[0].text).toContain("browser_console_clear")
    expect(browserHints[0].text).not.toContain("browser.navigate")
    expect(browserHints[0].text).not.toContain("browser.console_messages")
    expect(browserHints[0].text).toContain("navigation, inspection, screenshots, console, and page interaction")
    expect(browserHints[0].text.length).toBeLessThan(700)
    expect(result.requestParts.some((part) => part.type === "agent" && part.name === "browser")).toBe(false)
  })

  test("does not claim browser tools are available when enabled but not explicitly available", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "use @browser to inspect console", start: 0, end: 31 }],
      context: [],
      images: [],
      text: "use @browser to inspect console",
      messageID: "msg_browser_unavailable_hint",
      sessionID: "ses_browser_unavailable_hint",
      sessionDirectory: "/repo",
      browserIntegratedToolsEnabled: true,
      browserIntegratedToolsAvailable: false,
    })

    const browserHints = result.requestParts.filter(
      (part) => part.type === "text" && part.synthetic && !!part.metadata?.opencodeBrowserTools,
    )

    expect(browserHints).toHaveLength(1)
    expect(browserHints[0]?.type).toBe("text")
    if (browserHints[0]?.type !== "text") return
    expect(browserHints[0].text).toContain("Integrated browser tools are unavailable")
    expect(browserHints[0].text).not.toContain("Integrated browser tools are available")
    expect(browserHints[0].text).not.toContain("should be preferred over Playwright/external browsers")
    expect(browserHints[0].metadata?.opencodeBrowserTools).toEqual({ enabled: true, available: false })
  })

  test("injects disabled browser copy instead of available tools copy when integrated tools are disabled", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "use @browser to inspect console", start: 0, end: 31 }],
      context: [],
      images: [],
      text: "use @browser to inspect console",
      messageID: "msg_browser_disabled_hint",
      sessionID: "ses_browser_disabled_hint",
      sessionDirectory: "/repo",
      browserIntegratedToolsEnabled: false,
      browserIntegratedToolsAvailable: true,
    })

    const browserHints = result.requestParts.filter(
      (part) => part.type === "text" && part.synthetic && !!part.metadata?.opencodeBrowserTools,
    )

    expect(browserHints).toHaveLength(1)
    expect(browserHints[0]?.type).toBe("text")
    if (browserHints[0]?.type !== "text") return
    expect(browserHints[0].text).toContain("Integrated browser tools are disabled")
    expect(browserHints[0].text).not.toContain("Integrated browser tools are available")
    expect(browserHints[0].text).not.toContain("should be preferred over Playwright/external browsers")
    expect(browserHints[0].text).not.toContain("browser_navigate")
    expect(browserHints[0].metadata?.opencodeBrowserTools).toEqual({ enabled: false, available: false })
    expect(browserHints[0].text.length).toBeLessThan(300)
  })

  test("does not inject a browser tools hint for domain-like @browser text", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "contact @browser.com for support", start: 0, end: 32 }],
      context: [],
      images: [],
      text: "contact @browser.com for support",
      messageID: "msg_browser_domain",
      sessionID: "ses_browser_domain",
      sessionDirectory: "/repo",
    })

    expect(
      result.requestParts.filter(
        (part) => part.type === "text" && part.synthetic && !!part.metadata?.opencodeBrowserTools,
      ),
    ).toHaveLength(0)
  })

  test("injects exactly one browser tools hint for an exact @browser token", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "open @browser, then inspect console", start: 0, end: 35 }],
      context: [],
      images: [],
      text: "open @browser, then inspect console",
      messageID: "msg_browser_exact_token",
      sessionID: "ses_browser_exact_token",
      sessionDirectory: "/repo",
    })

    expect(
      result.requestParts.filter(
        (part) => part.type === "text" && part.synthetic && !!part.metadata?.opencodeBrowserTools,
      ),
    ).toHaveLength(1)
  })

  test("injects the same browser tools hint for /browser used inside a prompt", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "use /browser then inspect console", start: 0, end: 33 }],
      context: [],
      images: [],
      text: "use /browser then inspect console",
      messageID: "msg_browser_slash_hint",
      sessionID: "ses_browser_slash_hint",
      sessionDirectory: "/repo",
      browserIntegratedToolsAvailable: true,
    })

    const browserHints = result.requestParts.filter(
      (part) => part.type === "text" && part.synthetic && !!part.metadata?.opencodeBrowserTools,
    )

    expect(browserHints).toHaveLength(1)
    expect(browserHints[0]?.type).toBe("text")
    if (browserHints[0]?.type !== "text") return
    expect(browserHints[0].text).toContain("Integrated browser tools are available")
    expect(browserHints[0].text).toContain("should be preferred over Playwright/external browsers")
    expect(browserHints[0].text).toContain("browser_console_messages")
    expect(result.requestParts.some((part) => part.type === "agent" && part.name === "browser")).toBe(false)
  })

  test("injects the enabled browser priority hint when integrated tools are explicitly enabled", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "/browser inspect console", start: 0, end: 24 }],
      context: [],
      images: [],
      text: "/browser inspect console",
      messageID: "msg_browser_enabled_hint",
      sessionID: "ses_browser_enabled_hint",
      sessionDirectory: "/repo",
      browserIntegratedToolsEnabled: true,
      browserIntegratedToolsAvailable: true,
    })

    const browserHints = result.requestParts.filter(
      (part) => part.type === "text" && part.synthetic && !!part.metadata?.opencodeBrowserTools,
    )

    expect(browserHints).toHaveLength(1)
    expect(browserHints[0]?.type).toBe("text")
    if (browserHints[0]?.type !== "text") return
    expect(browserHints[0].text).toContain("Integrated browser tools are available")
    expect(browserHints[0].text).toContain("should be preferred over Playwright/external browsers")
    expect(browserHints[0].metadata?.opencodeBrowserTools).toEqual({ enabled: true, available: true })
  })

  test("injects the @browser synthetic hint once when the mention appears multiple times", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "@browser compare with @browser console", start: 0, end: 38 }],
      context: [],
      images: [],
      text: "@browser compare with @browser console",
      messageID: "msg_browser_hint_once",
      sessionID: "ses_browser_hint_once",
      sessionDirectory: "/repo",
    })

    expect(
      result.requestParts.filter(
        (part) => part.type === "text" && part.synthetic && !!part.metadata?.opencodeBrowserTools,
      ),
    ).toHaveLength(1)
  })

  test("omits oversized annotation screenshot crops from compact context", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "review this", start: 0, end: 11 }],
      context: [],
      images: [],
      annotations: [
        {
          id: "annotation-1",
          createdAt: 1,
          pageUrl: "https://opencode.ai/pricing",
          pageTitle: "Pricing",
          userComment: "CTA copy is vague",
          element: {
            tagName: "button",
            selector: "button[data-testid='cta']",
            role: "button",
            accessibleName: "Start free trial now",
            visibleText: "Start free trial now",
            attributes: { "data-testid": "cta" },
            boundingBox: { x: 10, y: 20, width: 200, height: 44 },
          },
          preview: {
            screenshotCrop: `data:image/png;base64,${"A".repeat(10_000)}`,
          },
          context: {
            nearbyDomSanitized: "Compare plans",
          },
        } satisfies BrowserAnnotation,
      ],
      text: "review this",
      messageID: "msg_annotation_large_crop",
      sessionID: "ses_annotation_large_crop",
      sessionDirectory: "/repo",
    })

    const annotationPart = result.requestParts.find(
      (part) =>
        part.type === "text" &&
        part.synthetic &&
        !!part.metadata?.opencodeAnnotations,
    )

    expect(annotationPart).toBeDefined()
    expect(annotationPart?.type).toBe("text")
    if (annotationPart?.type !== "text") return

    expect(annotationPart.text).not.toContain("data:image/png;base64")
    expect(annotationPart.metadata?.opencodeAnnotations).toEqual({
      count: 1,
      compact: [
        {
          id: "annotation-1",
          pageUrl: "https://opencode.ai/pricing",
          pageTitle: "Pricing",
          userComment: "CTA copy is vague",
          selector: "button[data-testid='cta']",
          role: "button",
          accessibleName: "Start free trial now",
          visibleText: "Start free trial now",
          boundingBox: { x: 10, y: 20, width: 200, height: 44 },
          nearbyDomSanitized: "Compare plans",
        },
      ],
    })
  })
})
