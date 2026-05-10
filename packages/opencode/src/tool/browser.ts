export * as BrowserTool from "./browser"

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { Config } from "@/config/config"

const browserId = Schema.optional(Schema.String).annotate({
  description: "Optional OpenCode integrated browser id. Defaults to the active integrated browser.",
})
const selector = Schema.String.annotate({ description: "CSS selector in the OpenCode integrated browser page." })
const ConsoleLevel = Schema.Literals(["log", "info", "warn", "error", "debug"])

type BridgeResponse =
  | { ok: true; result: unknown }
  | { ok: false; error?: string }

type BrowserToolSpec = {
  id: string
  description: string
  parameters: Schema.Decoder<unknown>
}

const specs: BrowserToolSpec[] = [
  {
    id: "browser_navigate",
    description: description("Navigate"),
    parameters: Schema.Struct({
      url: Schema.String.annotate({ description: "URL to open." }),
      browserId,
    }),
  },
  {
    id: "browser_inspect",
    description: description("Read a page snapshot or inspect one selector"),
    parameters: Schema.Struct({
      selector: Schema.optional(selector),
      browserId,
    }),
  },
  {
    id: "browser_click",
    description: description("Click an element"),
    parameters: Schema.Struct({ selector, browserId }),
  },
  {
    id: "browser_type",
    description: description("Type text into an element"),
    parameters: Schema.Struct({
      selector,
      text: Schema.String.annotate({ description: "Text to type." }),
      browserId,
    }),
  },
  {
    id: "browser_screenshot",
    description: description("Capture a screenshot"),
    parameters: Schema.Struct({ browserId }),
  },
  {
    id: "browser_console_messages",
    description: description("Read console messages"),
    parameters: Schema.Struct({
      browserId,
      levels: Schema.optional(Schema.Array(ConsoleLevel)),
      limit: Schema.optional(Schema.Number).annotate({ description: "Maximum console entries to return." }),
    }),
  },
  {
    id: "browser_console_clear",
    description: description("Clear console messages"),
    parameters: Schema.Struct({ browserId }),
  },
  {
    id: "browser_back",
    description: description("Go back in history"),
    parameters: Schema.Struct({ browserId }),
  },
  {
    id: "browser_forward",
    description: description("Go forward in history"),
    parameters: Schema.Struct({ browserId }),
  },
  {
    id: "browser_reload",
    description: description("Reload the page"),
    parameters: Schema.Struct({ browserId }),
  },
]

export function enabled(config: Config.Info) {
  return (
    Flag.OPENCODE_CLIENT === "desktop" &&
    config.browser?.integratedTools?.enabled === true &&
    !!bridgeUrl() &&
    !!process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN
  )
}

export function tools(config: Config.Info): Tool.Def[] {
  if (!enabled(config)) return []
  return specs.map((spec) => ({
    ...spec,
    execute: (args) => call(spec.id, args),
  }))
}

function description(action: string) {
  return `${action} using the OpenCode integrated browser. This does not use Playwright, Chrome, or an external browser.`
}

function bridgeUrl() {
  const raw = process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL
  if (!raw || !URL.canParse(raw)) return

  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  if (!isLoopbackHost(url.hostname)) return
  return url
}

function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host === "[::1]" || host === "::1") return true

  const parts = host.split(".").map(Number)
  return parts.length === 4 && parts[0] === 127 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
}

function call(tool: string, input: unknown): Effect.Effect<Tool.ExecuteResult> {
  return Effect.promise(async () => {
    const base = bridgeUrl()
    const token = process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN
    if (!base || !token) throw new Error("Integrated browser tool bridge is unavailable")

    const response = await fetch(new URL("/tool", base), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tool, input }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = (await response.json().catch(() => ({}))) as Partial<BridgeResponse>
    if (!response.ok || body.ok !== true) throw new Error(body.ok === false && body.error ? body.error : `Integrated browser bridge failed with HTTP ${response.status}`)
    return {
      title: "",
      metadata: {},
      output: typeof body.result === "string" ? body.result : JSON.stringify(body.result, null, 2),
    }
  })
}
