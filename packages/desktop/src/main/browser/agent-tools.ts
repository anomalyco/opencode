import type { BrowserConsoleLevel, BrowserId } from "./types"

type JsonSchema = {
  type: "object"
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties: false
}

type BrowserToolInput = Record<string, unknown>
type BrowserScreenshotResult = { imageBase64: string } | { toPNG: () => Buffer } | null | undefined

export type IntegratedBrowserAgentTool = {
  name: string
  description: string
  inputSchema: JsonSchema
  handler: (input: BrowserToolInput) => Promise<unknown>
}

type IntegratedBrowserAgentToolDeps = {
  navigate: (url: string, browserId?: BrowserId) => Promise<unknown>
  getSnapshot: (browserId?: BrowserId) => Promise<unknown>
  getAnnotationData: (selector: string, browserId?: BrowserId) => Promise<unknown>
  click: (selector: string, browserId?: BrowserId) => Promise<unknown>
  typeText: (selector: string, text: string, browserId?: BrowserId) => Promise<unknown>
  screenshot: (browserId?: BrowserId) => Promise<BrowserScreenshotResult>
  queryConsole: (query: { browserId: BrowserId; levels?: BrowserConsoleLevel[]; limit?: number }) => unknown | Promise<unknown>
  clearConsole: (browserId?: BrowserId) => number | Promise<number>
  getActiveBrowserId: () => BrowserId | undefined | Promise<BrowserId | undefined>
  goBack: (browserId?: BrowserId) => void
  goForward: (browserId?: BrowserId) => void
  reload: (browserId?: BrowserId) => void
}

export const integratedBrowserAgentToolNames = [
  "browser_navigate",
  "browser_inspect",
  "browser_click",
  "browser_type",
  "browser_screenshot",
  "browser_console_messages",
  "browser_console_clear",
  "browser_back",
  "browser_forward",
  "browser_reload",
] as const

export function shouldExposeIntegratedBrowserAgentTools(input: { client: string; enabled?: boolean }) {
  return input.client === "desktop" && input.enabled === true
}

export function getIntegratedBrowserAgentTools(input: { client: string; enabled?: boolean }) {
  if (!shouldExposeIntegratedBrowserAgentTools(input)) return []
  return createIntegratedBrowserAgentTools()
}

const browserIdProperty = { type: "string", description: "Optional OpenCode integrated browser id. Defaults to the active integrated browser." }
const selectorProperty = { type: "string", description: "CSS selector in the OpenCode integrated browser page." }

function browserId(input: BrowserToolInput) {
  if (typeof input.browserId === "string") return input.browserId
  return undefined
}

function requiredString(input: BrowserToolInput, key: string) {
  const value = input[key]
  if (typeof value === "string") return value
  throw new Error(`${key} must be a string`)
}

function schema(properties: JsonSchema["properties"], required: string[] = []): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}

function description(action: string) {
  return `${action} using the OpenCode integrated browser. This does not use Playwright, Chrome, or an external browser.`
}

function consoleLevels(input: BrowserToolInput) {
  if (input.levels === undefined) return undefined
  if (!Array.isArray(input.levels) || !input.levels.every((level) => ["log", "info", "warn", "error", "debug"].includes(String(level)))) {
    throw new Error("levels must be an array of browser console levels")
  }
  return input.levels as BrowserConsoleLevel[]
}

function consoleLimit(input: BrowserToolInput) {
  if (input.limit === undefined) return undefined
  if (typeof input.limit !== "number" || !Number.isFinite(input.limit) || input.limit <= 0) throw new Error("limit must be a positive number")
  return input.limit
}

function currentBrowserId(input: BrowserToolInput) {
  return browserId(input)
}

function normalizeScreenshotResult(image: BrowserScreenshotResult) {
  if (!image) throw new Error("Integrated browser screenshot did not return an image")
  if ("imageBase64" in image) return image
  const imageBase64 = image.toPNG().toString("base64")
  if (!imageBase64) throw new Error("Integrated browser screenshot did not return an image")
  return { imageBase64 }
}

function createDefaultDeps(): IntegratedBrowserAgentToolDeps {
  return {
    async navigate(url, id) {
      return (await import("./BrowserManager")).navigate(url, id)
    },
    async getSnapshot(id) {
      return (await import("./BrowserManager")).getSnapshot(id)
    },
    async getAnnotationData(selector, id) {
      return (await import("./BrowserManager")).getAnnotationData(selector, id)
    },
    async click(selector, id) {
      return (await import("./BrowserManager")).click(selector, id)
    },
    async typeText(selector, text, id) {
      return (await import("./BrowserManager")).typeText(selector, text, id)
    },
    async screenshot(id) {
      return (await import("./BrowserManager")).getBrowserView(id)?.webContents.capturePage()
    },
    async queryConsole(query) {
      return (await import("./console-store")).queryBrowserConsoleEntries(query)
    },
    async clearConsole(id) {
      return (await import("./console-store")).clearBrowserConsoleEntries(id)
    },
    async getActiveBrowserId() {
      return (await import("./MultiBrowserManager")).getActiveBrowserId()
    },
    goBack(id) {
      import("./BrowserManager").then((manager) => manager.goBack(id))
    },
    goForward(id) {
      import("./BrowserManager").then((manager) => manager.goForward(id))
    },
    reload(id) {
      import("./BrowserManager").then((manager) => manager.reload(id))
    },
  }
}

async function resolveCurrentBrowserId(input: BrowserToolInput, deps: IntegratedBrowserAgentToolDeps) {
  return currentBrowserId(input) ?? (await deps.getActiveBrowserId())
}

async function requiredCurrentBrowserId(input: BrowserToolInput, deps: IntegratedBrowserAgentToolDeps) {
  const id = await resolveCurrentBrowserId(input, deps)
  if (id) return id
  throw new Error("browserId is required when no active integrated browser is available")
}

export function createIntegratedBrowserAgentTools(deps = createDefaultDeps()): IntegratedBrowserAgentTool[] {
  return [
    {
      name: "browser_navigate",
      description: description("Navigate"),
      inputSchema: schema({ url: { type: "string", description: "URL to open." }, browserId: browserIdProperty }, ["url"]),
      async handler(input) {
        await deps.navigate(requiredString(input, "url"), await resolveCurrentBrowserId(input, deps))
        return { ok: true }
      },
    },
    {
      name: "browser_inspect",
      description: description("Read a page snapshot or inspect one selector"),
      inputSchema: schema({ selector: selectorProperty, browserId: browserIdProperty }),
      handler(input) {
        if (typeof input.selector === "string" && input.selector) return deps.getAnnotationData(input.selector, browserId(input))
        return deps.getSnapshot(browserId(input))
      },
    },
    {
      name: "browser_click",
      description: description("Click an element"),
      inputSchema: schema({ selector: selectorProperty, browserId: browserIdProperty }, ["selector"]),
      async handler(input) {
        await deps.click(requiredString(input, "selector"), browserId(input))
        return { ok: true }
      },
    },
    {
      name: "browser_type",
      description: description("Type text into an element"),
      inputSchema: schema({ selector: selectorProperty, text: { type: "string", description: "Text to type." }, browserId: browserIdProperty }, ["selector", "text"]),
      async handler(input) {
        await deps.typeText(requiredString(input, "selector"), requiredString(input, "text"), browserId(input))
        return { ok: true }
      },
    },
    {
      name: "browser_screenshot",
      description: description("Capture a screenshot"),
      inputSchema: schema({ browserId: browserIdProperty }),
      async handler(input) {
        return normalizeScreenshotResult(await deps.screenshot(browserId(input)))
      },
    },
    {
      name: "browser_console_messages",
      description: description("Read console messages"),
      inputSchema: schema({
        browserId: browserIdProperty,
        levels: { type: "array", items: { enum: ["log", "info", "warn", "error", "debug"] } },
        limit: { type: "number", description: "Maximum console entries to return." },
      }),
      async handler(input) {
        return deps.queryConsole({ browserId: await requiredCurrentBrowserId(input, deps), levels: consoleLevels(input), limit: consoleLimit(input) })
      },
    },
    {
      name: "browser_console_clear",
      description: description("Clear console messages"),
      inputSchema: schema({ browserId: browserIdProperty }),
      async handler(input) {
        const id = await requiredCurrentBrowserId(input, deps)
        return { browserId: id, count: await deps.clearConsole(id) }
      },
    },
    {
      name: "browser_back",
      description: description("Go back in history"),
      inputSchema: schema({ browserId: browserIdProperty }),
      handler(input) {
        deps.goBack(browserId(input))
        return Promise.resolve({ ok: true })
      },
    },
    {
      name: "browser_forward",
      description: description("Go forward in history"),
      inputSchema: schema({ browserId: browserIdProperty }),
      handler(input) {
        deps.goForward(browserId(input))
        return Promise.resolve({ ok: true })
      },
    },
    {
      name: "browser_reload",
      description: description("Reload the page"),
      inputSchema: schema({ browserId: browserIdProperty }),
      handler(input) {
        deps.reload(browserId(input))
        return Promise.resolve({ ok: true })
      },
    },
  ]
}
