import { describe, expect, test } from "bun:test"
import {
  COLLAPSED_HEIGHT,
  FOLLOW_UP_INIT_TIMEOUT_MS,
  FOLLOW_UP_RESPONSE_TIMEOUT_MS,
  INITIAL_HEIGHT,
  MAX_ERROR_CODE_POINTS,
  MAX_HEIGHT,
  MAX_HTML_BYTES,
  MAX_PROMPT_CODE_POINTS,
  MAX_REQUEST_ID_CODE_POINTS,
  MAX_THEME_VALUE_CODE_POINTS,
  MAX_TITLE_CODE_POINTS,
  MAX_TOKEN_CODE_POINTS,
  MIN_HEIGHT,
  VISUALIZATION_VERSION,
  clampVisualizationHeight,
  decodeVisualizationHostMessage,
  decodeVisualizationMessage,
  decodeVisualizationResult,
} from "./visualization-schema"

describe("visualization result", () => {
  test("exports the fixed protocol and layout limits", () => {
    expect(VISUALIZATION_VERSION).toBe(1)
    expect(MAX_TITLE_CODE_POINTS).toBe(120)
    expect(MAX_HTML_BYTES).toBe(128 * 1024)
    expect(MAX_PROMPT_CODE_POINTS).toBe(4_000)
    expect(MAX_ERROR_CODE_POINTS).toBe(500)
    expect(MAX_TOKEN_CODE_POINTS).toBe(256)
    expect(MAX_REQUEST_ID_CODE_POINTS).toBe(128)
    expect(MAX_THEME_VALUE_CODE_POINTS).toBe(256)
    expect(FOLLOW_UP_INIT_TIMEOUT_MS).toBe(10_000)
    expect(FOLLOW_UP_RESPONSE_TIMEOUT_MS).toBe(30_000)
    expect(INITIAL_HEIGHT).toBe(160)
    expect(MIN_HEIGHT).toBe(48)
    expect(COLLAPSED_HEIGHT).toBe(720)
    expect(MAX_HEIGHT).toBe(4_096)
  })

  test("normalizes a valid V1 result and ignores extra fields", () => {
    expect(decodeVisualizationResult({ version: 1, title: "  Demo ", html: "<div>ok</div>", dangerous: true })).toEqual(
      { version: 1, title: "Demo", html: "<div>ok</div>" },
    )
  })

  test("counts title limits by Unicode code point", () => {
    expect(decodeVisualizationResult({ version: 1, title: "😀".repeat(120), html: "<svg />" })?.title).toBe(
      "😀".repeat(120),
    )
    expect(decodeVisualizationResult({ version: 1, title: "😀".repeat(121), html: "<svg />" })).toBeUndefined()
  })

  test("enforces the HTML UTF-8 byte boundary", () => {
    expect(decodeVisualizationResult({ version: 1, title: "Demo", html: "a".repeat(MAX_HTML_BYTES) })).toBeDefined()
    expect(
      decodeVisualizationResult({ version: 1, title: "Demo", html: `${"a".repeat(MAX_HTML_BYTES - 1)}é` }),
    ).toBeUndefined()
  })

  test("rejects invalid versions and empty fields without throwing", () => {
    expect(decodeVisualizationResult({ version: 2, title: "Demo", html: "<div />" })).toBeUndefined()
    expect(decodeVisualizationResult({ version: 1, title: "   ", html: "<div />" })).toBeUndefined()
    expect(decodeVisualizationResult({ version: 1, title: "Demo", html: "  " })).toBeUndefined()
    expect(decodeVisualizationResult(null)).toBeUndefined()
    expect(() => decodeVisualizationResult(Object.create(null))).not.toThrow()
  })

  test("rejects obvious full documents after leading whitespace and comments", () => {
    const invalid = [
      "<!doctype html><p>x</p>",
      " \n<!-- lead --><! DOCTYPE html><p>x</p>",
      "<!-- a --><!-- b --> <HTML lang=en></HTML>",
      "\n< head><title>x</title></head>",
      "<!-- lead --> <BoDy >x</body>",
    ]
    for (const html of invalid) expect(decodeVisualizationResult({ version: 1, title: "Demo", html })).toBeUndefined()
  })

  test("rejects document tokens anywhere outside comments and raw text", () => {
    const invalid = [
      "<div>x</div><body>late body</body>",
      "<section>x</section><HEAD><title>x</title></HEAD>",
      "<div>x</div><!doctype html>",
      "<svg><foreignObject><html><body>x</body></html></foreignObject></svg>",
      '<script>const value = "</script><body>real body</body><script>"</script>',
    ]
    for (const html of invalid) expect(decodeVisualizationResult({ version: 1, title: "Demo", html })).toBeUndefined()
  })

  test("ignores document-like text in comments, quoted attributes, script, and style", () => {
    const valid = [
      "<!-- <html><body>comment</body></html> --><div>ok</div>",
      '<div data-example="<body>not a tag</body>">ok</div>',
      '<script>const example = "<body>not a tag</body>"</script><div>ok</div>',
      '<style>.demo::before { content: "<html>"; }</style><div class="demo">ok</div>',
    ]
    for (const html of valid) expect(decodeVisualizationResult({ version: 1, title: "Demo", html })).toBeDefined()
  })

  test("accepts supported interactive fragments", () => {
    const valid = [
      '<svg viewBox="0 0 10 10"><circle r="4" /></svg>',
      '<canvas id="chart"></canvas>',
      '<form><input type="range"></form>',
      "<script>window.demo = true</script>",
    ]
    for (const html of valid) expect(decodeVisualizationResult({ version: 1, title: "Demo", html })).toBeDefined()
  })

  test("returns undefined when untrusted result properties throw", () => {
    const poisoned = {
      version: 1,
      get title(): string {
        throw new Error("poisoned title")
      },
      html: "<div />",
    }
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("poisoned proxy")
        },
      },
    )
    expect(() => decodeVisualizationResult(poisoned)).not.toThrow()
    expect(decodeVisualizationResult(poisoned)).toBeUndefined()
    expect(() => decodeVisualizationResult(proxy)).not.toThrow()
    expect(decodeVisualizationResult(proxy)).toBeUndefined()
  })
})

describe("visualization iframe messages", () => {
  test("decodes and normalizes every iframe to host message", () => {
    expect(decodeVisualizationMessage({ version: 1, type: "ready", token: " token ", extra: "ignored" })).toEqual({
      version: 1,
      type: "ready",
      token: "token",
    })
    expect(decodeVisualizationMessage({ version: 1, type: "resize", token: "token", height: 240.5 })).toEqual({
      version: 1,
      type: "resize",
      token: "token",
      height: 240.5,
    })
    expect(
      decodeVisualizationMessage({
        version: 1,
        type: "followup",
        token: "token",
        requestID: "request-1",
        title: "  Choice ",
        prompt: "  use option A  ",
      }),
    ).toEqual({
      version: 1,
      type: "followup",
      token: "token",
      requestID: "request-1",
      title: "Choice",
      prompt: "use option A",
    })
    expect(
      decodeVisualizationMessage({ version: 1, type: "error", token: "token", message: " bad\u0000\n error " }),
    ).toEqual({ version: 1, type: "error", token: "token", message: "bad error" })
  })

  test("enforces follow-up and identifier boundaries", () => {
    const base = { version: 1, type: "followup", token: "t", requestID: "r" }
    expect(decodeVisualizationMessage({ ...base, prompt: "😀".repeat(4_000), title: "😀".repeat(120) })).toBeDefined()
    expect(decodeVisualizationMessage({ ...base, prompt: "😀".repeat(4_001) })).toBeUndefined()
    expect(decodeVisualizationMessage({ ...base, prompt: "  " })).toBeUndefined()
    expect(decodeVisualizationMessage({ ...base, prompt: "ok", title: "  " })).toBeUndefined()
    expect(decodeVisualizationMessage({ ...base, prompt: "ok", title: "x".repeat(121) })).toBeUndefined()
    expect(decodeVisualizationMessage({ ...base, prompt: "ok", token: "t".repeat(257) })).toBeUndefined()
    expect(decodeVisualizationMessage({ ...base, prompt: "ok", requestID: "r".repeat(129) })).toBeUndefined()
  })

  test("rejects invalid heights, versions, types, and dangerous payload shapes", () => {
    expect(decodeVisualizationMessage({ version: 1, type: "resize", token: "t", height: Number.NaN })).toBeUndefined()
    expect(decodeVisualizationMessage({ version: 1, type: "resize", token: "t", height: Infinity })).toBeUndefined()
    expect(decodeVisualizationMessage({ version: 1, type: "resize", token: "t", height: -1 })).toBeUndefined()
    expect(decodeVisualizationMessage({ version: 2, type: "ready", token: "t" })).toBeUndefined()
    expect(decodeVisualizationMessage({ version: 1, type: "rpc", token: "t", method: "readFile" })).toBeUndefined()
    expect(decodeVisualizationMessage([])).toBeUndefined()
  })

  test("cleans and bounds iframe error summaries", () => {
    const decoded = decodeVisualizationMessage({
      version: 1,
      type: "error",
      token: "t",
      message: `  ${"x".repeat(600)}  `,
    })
    expect(decoded?.type).toBe("error")
    if (decoded?.type !== "error") throw new Error("Expected an error message")
    expect(Array.from(decoded.message)).toHaveLength(500)
  })

  test("returns undefined when untrusted iframe message properties throw", () => {
    const poisoned = {
      version: 1,
      get token(): string {
        throw new Error("poisoned token")
      },
      type: "ready",
    }
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("poisoned proxy")
        },
      },
    )
    expect(() => decodeVisualizationMessage(poisoned)).not.toThrow()
    expect(decodeVisualizationMessage(poisoned)).toBeUndefined()
    expect(() => decodeVisualizationMessage(proxy)).not.toThrow()
    expect(decodeVisualizationMessage(proxy)).toBeUndefined()
  })
})

describe("visualization host messages", () => {
  const theme = {
    "--v2-background-bg-base": "#fff",
    "--v2-background-bg-layer-01": "#f5f5f5",
    "--v2-text-text-base": "#111",
    "--v2-text-text-muted": "#666",
    "--v2-border-border-base": "#ddd",
    "--v2-text-text-accent": "#06f",
    "--font-family-sans": "sans-serif",
    "--font-family-mono": "monospace",
  }

  test("normalizes only whitelisted theme variables", () => {
    expect(
      decodeVisualizationHostMessage({
        version: 1,
        type: "theme",
        token: "token",
        theme: { ...theme, "--danger": "url(https://example.com)" },
      }),
    ).toEqual({ version: 1, type: "theme", token: "token", theme })
  })

  test("counts theme limits by Unicode code point", () => {
    const value = "😀".repeat(129)
    expect(value.length).toBe(258)
    expect(
      decodeVisualizationHostMessage({
        version: 1,
        type: "theme",
        token: "token",
        theme: { "--v2-text-text-base": value },
      }),
    ).toEqual({
      version: 1,
      type: "theme",
      token: "token",
      theme: { "--v2-text-text-base": value },
    })
  })

  test("accepts only fixed follow-up result statuses", () => {
    for (const status of ["sent", "cancelled", "rejected"] as const) {
      expect(
        decodeVisualizationHostMessage({
          version: 1,
          type: "followup-result",
          token: "token",
          requestID: "request",
          status,
        }),
      ).toEqual({ version: 1, type: "followup-result", token: "token", requestID: "request", status })
    }
    expect(
      decodeVisualizationHostMessage({
        version: 1,
        type: "followup-result",
        token: "token",
        requestID: "request",
        status: "approved",
      }),
    ).toBeUndefined()
    expect(decodeVisualizationHostMessage({ version: 1, type: "unknown", token: "token" })).toBeUndefined()
  })

  test("rejects oversized theme values", () => {
    expect(
      decodeVisualizationHostMessage({
        version: 1,
        type: "init",
        token: "token",
        theme: { ...theme, "--v2-text-text-base": "x".repeat(257) },
      }),
    ).toBeUndefined()
  })

  test("returns undefined when untrusted host message properties throw", () => {
    const poisoned = {
      version: 1,
      type: "theme",
      token: "token",
      get theme(): unknown {
        throw new Error("poisoned theme")
      },
    }
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("poisoned proxy")
        },
      },
    )
    expect(() => decodeVisualizationHostMessage(poisoned)).not.toThrow()
    expect(decodeVisualizationHostMessage(poisoned)).toBeUndefined()
    expect(() => decodeVisualizationHostMessage(proxy)).not.toThrow()
    expect(decodeVisualizationHostMessage(proxy)).toBeUndefined()
  })
})

describe("visualization height", () => {
  test("rejects invalid values and clamps finite heights", () => {
    expect(clampVisualizationHeight(Number.NaN)).toBeUndefined()
    expect(clampVisualizationHeight(Infinity)).toBeUndefined()
    expect(clampVisualizationHeight(-1)).toBeUndefined()
    expect(clampVisualizationHeight(0)).toBe(MIN_HEIGHT)
    expect(clampVisualizationHeight(MIN_HEIGHT)).toBe(MIN_HEIGHT)
    expect(clampVisualizationHeight(48.1)).toBe(49)
    expect(clampVisualizationHeight(MAX_HEIGHT)).toBe(MAX_HEIGHT)
    expect(clampVisualizationHeight(MAX_HEIGHT + 1)).toBe(MAX_HEIGHT)
  })
})
