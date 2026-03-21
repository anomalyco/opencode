import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"
import type { PermissionNext } from "../../src/permission/next"

function formatWebfetchRules(ruleset: PermissionNext.Ruleset): string | undefined {
  const rules = ruleset.filter((r) => r.permission === "webfetch")
  if (!rules.length) return
  if (rules.length === 1 && rules[0].pattern === "*" && rules[0].action === "allow") return
  const lines = rules.map((r) => `  ${r.action}: ${r.pattern}`)
  return ["<webfetch-url-permissions>", ...lines, "</webfetch-url-permissions>"].join("\n")
}

const projectRoot = path.join(import.meta.dir, "../..")

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function withFetch(
  mockFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe("tool.webfetch", () => {
  test("returns image responses as file attachments", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    await withFetch(
      async () => new Response(bytes, { status: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" } }),
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            const result = await webfetch.execute({ url: "https://example.com/image.png", format: "markdown" }, ctx)
            expect(result.output).toBe("Image fetched successfully")
            expect(result.attachments).toBeDefined()
            expect(result.attachments?.length).toBe(1)
            expect(result.attachments?.[0].type).toBe("file")
            expect(result.attachments?.[0].mime).toBe("image/png")
            expect(result.attachments?.[0].url.startsWith("data:image/png;base64,")).toBe(true)
            expect(result.attachments?.[0]).not.toHaveProperty("id")
            expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
            expect(result.attachments?.[0]).not.toHaveProperty("messageID")
          },
        })
      },
    )
  })

  test("keeps svg as text output", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>'
    await withFetch(
      async () =>
        new Response(svg, {
          status: 200,
          headers: { "content-type": "image/svg+xml; charset=UTF-8" },
        }),
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            const result = await webfetch.execute({ url: "https://example.com/image.svg", format: "html" }, ctx)
            expect(result.output).toContain("<svg")
            expect(result.attachments).toBeUndefined()
          },
        })
      },
    )
  })

  test("keeps text responses as text output", async () => {
    await withFetch(
      async () =>
        new Response("hello from webfetch", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            const result = await webfetch.execute({ url: "https://example.com/file.txt", format: "text" }, ctx)
            expect(result.output).toBe("hello from webfetch")
            expect(result.attachments).toBeUndefined()
          },
        })
      },
    )
  })
})

describe("tool.webfetch permission patterns", () => {
  const stubFetch = async () =>
    new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })

  test("includes portless host patterns", async () => {
    const webfetch = await WebFetchTool.init()
    let patterns: string[] = []
    const askCtx = {
      ...ctx,
      ask: async (req: { patterns?: string[] }) => {
        patterns = req.patterns ?? []
      },
    }

    await withFetch(stubFetch, async () => {
      await webfetch.execute(
        {
          url: "https://example.com:8080/path?x=1#hash",
          format: "text",
        },
        askCtx,
      )
    })

    expect(patterns).toEqual([
      "https://example.com:8080/path?x=1#hash",
      "example.com:8080/path?x=1#hash",
      "example.com:8080",
      "https://example.com/path?x=1#hash",
      "example.com/path?x=1#hash",
      "example.com",
    ])
  })

  test("collapses duplicates when no port", async () => {
    const webfetch = await WebFetchTool.init()
    let patterns: string[] = []
    const askCtx = {
      ...ctx,
      ask: async (req: { patterns?: string[] }) => {
        patterns = req.patterns ?? []
      },
    }

    await withFetch(stubFetch, async () => {
      await webfetch.execute(
        {
          url: "https://example.com",
          format: "text",
        },
        askCtx,
      )
    })

    expect(patterns).toEqual(["https://example.com/", "example.com/", "example.com"])
  })
})

describe("formatWebfetchRules", () => {
  test("returns undefined when no webfetch rules", () => {
    const ruleset: PermissionNext.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
    expect(formatWebfetchRules(ruleset)).toBeUndefined()
  })

  test("returns undefined when only default allow", () => {
    const ruleset: PermissionNext.Ruleset = [{ permission: "webfetch", pattern: "*", action: "allow" }]
    expect(formatWebfetchRules(ruleset)).toBeUndefined()
  })

  test("formats mixed rules", () => {
    const ruleset: PermissionNext.Ruleset = [
      { permission: "webfetch", pattern: "*", action: "deny" },
      { permission: "webfetch", pattern: "https://docs.example.com/*", action: "allow" },
      { permission: "webfetch", pattern: "*.internal.com/*", action: "ask" },
    ]
    const result = formatWebfetchRules(ruleset)
    expect(result).toBe(
      [
        "<webfetch-url-permissions>",
        "  deny: *",
        "  allow: https://docs.example.com/*",
        "  ask: *.internal.com/*",
        "</webfetch-url-permissions>",
      ].join("\n"),
    )
  })

  test("preserves rule order", () => {
    const ruleset: PermissionNext.Ruleset = [
      { permission: "webfetch", pattern: "https://allowed.com/*", action: "allow" },
      { permission: "webfetch", pattern: "*", action: "deny" },
    ]
    const result = formatWebfetchRules(ruleset)
    expect(result).toBe(
      ["<webfetch-url-permissions>", "  allow: https://allowed.com/*", "  deny: *", "</webfetch-url-permissions>"].join(
        "\n",
      ),
    )
  })

  test("formats deny all except specific host", () => {
    const ruleset: PermissionNext.Ruleset = [
      { permission: "webfetch", pattern: "*", action: "deny" },
      { permission: "webfetch", pattern: "github.com", action: "allow" },
      { permission: "webfetch", pattern: "github.com/*", action: "allow" },
    ]
    const result = formatWebfetchRules(ruleset)
    expect(result).toBe(
      [
        "<webfetch-url-permissions>",
        "  deny: *",
        "  allow: github.com",
        "  allow: github.com/*",
        "</webfetch-url-permissions>",
      ].join("\n"),
    )
  })
})
