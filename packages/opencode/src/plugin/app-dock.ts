import type { Plugin, PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"

type ParentPortLike = {
  postMessage(message: unknown): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

type DockResult =
  | Readonly<{ id: string; ok: true; value: unknown }>
  | Readonly<{ id: string; ok: false; error: Readonly<{ message: string }> }>

const pending = new Map<
  ParentPortLike,
  Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>
>()

const routerFor = (port: ParentPortLike) => {
  let router = pending.get(port)
  if (router) return router
  router = new Map()
  pending.set(port, router)
  port.on("message", (event: { data: unknown }) => {
    const payload = event.data as Partial<DockResult>
    if (!payload || typeof payload !== "object") return
    if (typeof payload.id !== "string" || typeof payload.ok !== "boolean") return
    const entry = router?.get(payload.id)
    if (!entry) return
    router.delete(payload.id)
    clearTimeout(entry.timer)
    if (payload.ok) entry.resolve(payload.value)
    else entry.reject(new Error((payload as Partial<Extract<DockResult, { ok: false }>>).error?.message ?? "App Dock request failed"))
  })
  return router
}

function request(port: ParentPortLike, op: string, args: Record<string, unknown>): Promise<unknown> {
  const id = randomUUID()
  const router = routerFor(port)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      router.delete(id)
      reject(new Error(`App Dock ${op} request timed out`))
    }, 15000)
    router.set(id, { resolve, reject, timer })
    port.postMessage({ type: "dock.rpc", id, op, args })
  })
}

const parentPort = (): ParentPortLike | undefined =>
  (process as typeof process & { parentPort?: ParentPortLike }).parentPort

const toolError = (error: unknown) => (error instanceof Error ? error.message : String(error))
const toJSON = (value: unknown) => JSON.stringify(value, null, 2)
const invoke = (context: ToolContext, port: ParentPortLike, op: string, args: Record<string, unknown>) =>
  context
    .ask({ permission: "dock", patterns: [op], always: [op], metadata: { operation: op } })
    .then(() => request(port, op, args))

export function createAppDockHooks(port: ParentPortLike): Hooks {
  return {
    tool: {
      dock_list: tool({
        description:
          "List App Dock tabs and their current state (url, title, loading, audible, active).",
        args: {},
        execute: (_args, context) => invoke(context, port, "list", {}).then(toJSON, toolError),
      }),
      dock_activate: tool({
        description: "Activate one App Dock tab by tabID from dock_open or dock_list.",
        args: { tabID: tool.schema.string().min(1) },
        execute: (args, context) => invoke(context, port, "activate", { tabID: args.tabID }).then(toJSON, toolError),
      }),
      dock_read: tool({
        description:
          "Read the App Dock page as a structured accessibility snapshot: current URL/title/viewport, a budget-pruned list of interactive elements each with a stable numeric `ref`, and visible page text. Use `ref` values with dock_click / dock_type. Re-read after a page change; refs may go stale after re-render.",
        args: {
          budget: tool.schema.number().min(1).max(500).optional().describe(
            "Maximum interactive elements to return (default 100)",
          ),
          maxText: tool.schema.number().min(0).max(20000).optional().describe(
            "Maximum page text characters to return (default 1500)",
          ),
        },
        execute: (args, context) =>
          invoke(context, port, "read", { budget: args.budget, maxText: args.maxText }).then(toJSON, toolError),
      }),
      dock_wait: tool({
        description: "Wait for the active App Dock tab to settle for a bounded duration.",
        args: {
          milliseconds: tool.schema.number().min(0).max(10000).optional().describe("Wait duration in milliseconds"),
        },
        execute: (args, context) =>
          invoke(context, port, "wait", { milliseconds: args.milliseconds }).then(toJSON, toolError),
      }),
      dock_screenshot: tool({
        description: "Capture the active App Dock tab as a base64 PNG.",
        args: {},
        execute: (_args, context) => invoke(context, port, "screenshot", {}).then(toJSON, toolError),
      }),
      dock_scroll: tool({
        description: "Scroll the active App Dock tab.",
        args: {
          direction: tool.schema.enum(["up", "down", "top", "bottom"]),
          amount: tool.schema.number().min(1).max(10000).optional(),
        },
        execute: (args, context) =>
          invoke(context, port, "scroll", { direction: args.direction, amount: args.amount }).then(toJSON, toolError),
      }),
      dock_keyboard: tool({
        description: "Dispatch a keyDown or keyUp event to the active App Dock tab.",
        args: {
          type: tool.schema.enum(["keyDown", "keyUp"]),
          key: tool.schema.string().min(1),
        },
        execute: (args, context) =>
          invoke(context, port, "keyboard", { type: args.type, key: args.key }).then(toJSON, toolError),
      }),
      dock_evaluate: tool({
        description: "Evaluate JavaScript in the active App Dock tab.",
        args: { script: tool.schema.string().min(1) },
        execute: (args, context) => invoke(context, port, "evaluate", { script: args.script }).then(toJSON, toolError),
      }),
      dock_storage: tool({
        description: "Read one localStorage or sessionStorage value from the active App Dock tab.",
        args: {
          storage: tool.schema.enum(["local", "session"]),
          key: tool.schema.string().min(1),
        },
        execute: (args, context) =>
          invoke(context, port, "storage", { storage: args.storage, key: args.key }).then(toJSON, toolError),
      }),
      dock_network: tool({
        description: "Install page-level fetch/XHR URL filtering for the active App Dock tab.",
        args: {
          blockUrls: tool.schema.array(tool.schema.string()).optional(),
          allowedOrigins: tool.schema.array(tool.schema.string()).optional(),
          blockMethods: tool.schema.array(tool.schema.string()).optional(),
          probeUrl: tool.schema.string().url().optional(),
          probeMethod: tool.schema.string().optional(),
        },
        execute: (args, context) => invoke(context, port, "network", args).then(toJSON, toolError),
      }),
      dock_click: tool({
        description: "Click an interactive App Dock element by `ref`, or click page coordinates when x and y are supplied.",
        args: {
          ref: tool.schema.number().min(1).optional().describe("Element ref from dock_read"),
          x: tool.schema.number().min(0).optional().describe("Page x coordinate"),
          y: tool.schema.number().min(0).optional().describe("Page y coordinate"),
        },
        execute: (args, context) => {
          if (args.x !== undefined || args.y !== undefined) {
            if (args.x === undefined || args.y === undefined) return Promise.resolve("dock_click requires both x and y")
            return invoke(context, port, "clickAt", { x: args.x, y: args.y }).then(toJSON, toolError)
          }
          if (args.ref === undefined) return Promise.resolve("dock_click requires ref or both x and y")
          return invoke(context, port, "click", { ref: args.ref }).then(toJSON, toolError)
        },
      }),
      dock_type: tool({
        description: "Type text into an editable App Dock page element by its `ref` from dock_read.",
        args: {
          ref: tool.schema.number().min(1).describe("Element ref from dock_read"),
          text: tool.schema.string().describe("Text to type into the element"),
        },
        execute: (args, context) => invoke(context, port, "type", { ref: args.ref, text: args.text }).then(toJSON, toolError),
      }),
      dock_navigate: tool({
        description: "Navigate the active App Dock tab to a new address (https:// URL or a plain search query).",
        args: {
          address: tool.schema.string().describe("URL to navigate to (https://...) or free-text search query"),
        },
        execute: (args, context) => invoke(context, port, "navigate", { address: args.address }).then(toJSON, toolError),
      }),
      dock_go: tool({
        description: "Go back, forward, or reload the active App Dock tab.",
        args: {
          command: tool.schema.enum(["back", "forward", "reload"]).describe("Navigation command"),
        },
        execute: (args, context) => invoke(context, port, "go", { command: args.command }).then(toJSON, toolError),
      }),
      dock_open: tool({
        description: "Open a new App Dock tab navigating to an address (https:// URL or a plain search query).",
        args: {
          address: tool.schema.string().describe("URL to open (https://...) or a plain search query"),
        },
        execute: (args, context) => invoke(context, port, "open", { address: args.address }).then(toJSON, toolError),
      }),
      dock_close: tool({
        description: "Close one App Dock tab. Without tabID, closes only active tab. Returns remaining tabs.",
        args: {
          tabID: tool.schema.string().min(1).optional().describe("Specific tab ID from dock_open or dock_list"),
        },
        execute: (args, context) => invoke(context, port, "close", { tabID: args.tabID }).then(toJSON, toolError),
      }),
    },
  }
}

export const AppDockPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  const port = parentPort()
  if (!port) return {}
  return createAppDockHooks(port)
}
