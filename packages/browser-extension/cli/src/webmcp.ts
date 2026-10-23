import type { Frame, Page } from "patchright-core"

const defaultFrameTimeoutMs = 5_000
const maxTools = 100
const maxDescriptionLength = 1_000
const maxSchemaLength = 32_000

type WebMcpTool = {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema?: unknown
  readonly annotations?: {
    readonly readOnly?: boolean
    readonly untrustedContent?: boolean
    readonly consequential?: boolean
  }
  readonly origin?: string
  readonly frame: string
  readonly frameUrl: string
}

type WebMcpListing = {
  readonly available: boolean
  readonly tools: readonly WebMcpTool[]
  readonly omitted: number
}

export type WebMcpHelper = {
  readonly list: () => Promise<WebMcpListing>
  readonly call: (name: string, input?: Record<string, unknown>, options?: {
    readonly frame?: string
    readonly timeout?: number
  }) => Promise<unknown>
}

type CollectedTool = Omit<WebMcpTool, "frame" | "frameUrl">

export function createWebMcpHelper(page: Page): WebMcpHelper {
  return {
    list: async () => {
      const listing = await collectWebMcpToolsWithFrames(page, defaultFrameTimeoutMs)
      return {
        available: listing.available,
        tools: listing.tools.map(({ tool }) => tool),
        omitted: listing.omitted,
      }
    },
    call: async (name, input = {}, options = {}) => {
      if (!name.trim()) throw new Error("webmcp.call requires a non-empty tool name")
      const listing = await collectWebMcpToolsWithFrames(page, options.timeout ?? defaultFrameTimeoutMs)
      const matches = listing.tools.filter((candidate) => {
        return candidate.tool.name === name &&
          (options.frame === undefined || candidate.tool.frame === options.frame || candidate.tool.frameUrl === options.frame)
      })
      if (matches.length === 0) {
        const available = listing.tools.map(({ tool }) => tool.name)
        throw new Error(`No WebMCP tool named ${JSON.stringify(name)}${options.frame ? ` in frame ${options.frame}` : ""}.${available.length > 0 ? ` Available tools: ${[...new Set(available)].join(", ")}.` : " The page does not register any WebMCP tools."}`)
      }
      if (matches.length > 1) {
        throw new Error(`WebMCP tool ${JSON.stringify(name)} is registered in multiple frames; pass { frame }. Matching frames: ${matches.map(({ tool }) => tool.frame).join(", ")}`)
      }
      const match = matches[0]!
      return await withTimeout(
        match.frame.evaluate(callWebMcpToolInPage, { name, inputJson: JSON.stringify(input) }),
        options.timeout ?? defaultFrameTimeoutMs,
        `WebMCP tool ${JSON.stringify(name)} timed out`,
      )
    },
  }
}

async function collectWebMcpToolsWithFrames(page: Page, timeoutMs: number): Promise<{
  readonly available: boolean
  readonly tools: readonly { readonly frame: Frame; readonly tool: WebMcpTool }[]
  readonly omitted: number
}> {
  const frames = page.frames()
  const urlCounts = new Map<string, number>()
  for (const frame of frames) urlCounts.set(frame.url(), (urlCounts.get(frame.url()) ?? 0) + 1)
  const results = await Promise.all(frames.map(async (frame, index) => {
    const frameUrl = frame.url()
    const frameLabel = (urlCounts.get(frameUrl) ?? 0) > 1 ? `${frameUrl} (frame ${index})` : frameUrl
    const result = await withTimeout(frame.evaluate(collectWebMcpToolsInPage), timeoutMs, "WebMCP discovery timed out")
      .catch(() => null)
    return { frame, frameUrl, frameLabel, result }
  }))
  const available = results.some(({ result }) => result !== null)
  let discovered = 0
  const collected: Array<{ readonly frame: Frame; readonly tool: WebMcpTool }> = []
  for (const { frame, frameUrl, frameLabel, result } of results) {
    if (!result) continue
    for (const raw of result) {
      discovered += 1
      if (collected.length >= maxTools) continue
      const tool = normalizeCollectedTool(raw, frameLabel, frameUrl)
      if (tool) collected.push({ frame, tool })
    }
  }
  return { available, tools: collected, omitted: Math.max(0, discovered - maxTools) }
}

function collectWebMcpToolsInPage(): Promise<CollectedTool[] | null> | null {
  type PageTool = {
    readonly name?: unknown
    readonly title?: unknown
    readonly description?: unknown
    readonly inputSchema?: unknown
    readonly annotations?: Record<string, unknown>
    readonly origin?: unknown
    readonly window?: Window
  }
  type ModelContext = { readonly getTools?: () => Promise<PageTool[]> }
  const context = (document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  if (!context?.getTools) return null
  return Promise.resolve(context.getTools()).then((tools) => tools
    .filter((tool) => !("window" in tool) || tool.window === window)
    .map((tool) => {
      let inputSchema = tool.inputSchema
      if (typeof inputSchema === "string") {
        try {
          inputSchema = JSON.parse(inputSchema)
        } catch {
          inputSchema = undefined
        }
      }
      return {
        name: typeof tool.name === "string" ? tool.name : "",
        ...(typeof tool.title === "string" ? { title: tool.title } : {}),
        description: typeof tool.description === "string" ? tool.description : "",
        ...(inputSchema === undefined ? {} : { inputSchema }),
        ...(tool.annotations ? {
          annotations: {
            readOnly: Boolean(tool.annotations.readOnlyHint ?? tool.annotations.readOnly),
            untrustedContent: Boolean(tool.annotations.untrustedContentHint ?? tool.annotations.untrustedContent),
            consequential: Boolean(tool.annotations.consequentialHint ?? tool.annotations.consequential),
          },
        } : {}),
        ...(typeof tool.origin === "string" ? { origin: tool.origin } : {}),
      }
    }))
}

function callWebMcpToolInPage(options: { readonly name: string; readonly inputJson: string }): Promise<unknown> {
  type PageTool = { readonly name?: unknown; readonly window?: Window }
  type ModelContext = {
    readonly getTools?: () => Promise<PageTool[]>
    readonly executeTool?: (tool: PageTool, input: string) => Promise<unknown>
    readonly invokeTool?: (name: string, input: unknown) => Promise<unknown>
  }
  const context = (document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  if (!context?.getTools) throw new Error("WebMCP is not available on this page")
  return Promise.resolve(context.getTools()).then(async (tools) => {
    const tool = tools.filter((candidate) => !("window" in candidate) || candidate.window === window)
      .find((candidate) => candidate.name === options.name)
    if (!tool) throw new Error(`WebMCP tool ${JSON.stringify(options.name)} is not registered in this frame`)
    const result = context.executeTool
      ? await context.executeTool(tool, options.inputJson)
      : context.invokeTool
      ? await context.invokeTool(options.name, JSON.parse(options.inputJson))
      : (() => { throw new Error("WebMCP tool execution is not available on this page") })()
    if (typeof result !== "string") return result ?? null
    try {
      return JSON.parse(result)
    } catch {
      return result
    }
  })
}

function normalizeCollectedTool(raw: CollectedTool, frame: string, frameUrl: string): WebMcpTool | undefined {
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  if (!name) return undefined
  let inputSchema = raw.inputSchema
  if (inputSchema !== undefined) {
    try {
      const serialized = JSON.stringify(inputSchema)
      inputSchema = serialized.length <= maxSchemaLength ? JSON.parse(serialized) : undefined
    } catch {
      inputSchema = undefined
    }
  }
  const annotations = raw.annotations && Object.values(raw.annotations).some(Boolean) ? raw.annotations : undefined
  return {
    name,
    ...(raw.title ? { title: raw.title.slice(0, 200) } : {}),
    description: raw.description.slice(0, maxDescriptionLength),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(annotations ? { annotations } : {}),
    ...(raw.origin ? { origin: raw.origin } : {}),
    frame,
    frameUrl,
  }
}

async function withTimeout<A>(promise: Promise<A>, timeoutMs: number, message: string): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${message} after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
