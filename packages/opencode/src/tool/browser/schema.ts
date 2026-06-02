import { Schema } from "effect"

// ── Branded Types ──────────────────────────────────────────────────

export const BrowserSessionID = Schema.String.pipe(Schema.brand("BrowserSessionID"))

// ── Core Data Structures ───────────────────────────────────────────

export const BrowserViewport = Schema.Struct({
  width: Schema.Int,
  height: Schema.Int,
})

export const BrowserState = Schema.Struct({
  session_id: Schema.String,
  current_url: Schema.String,
  page_title: Schema.String,
  viewport: BrowserViewport,
  pages_count: Schema.Int,
  time_last_action: Schema.Number,
})

export const BrowserTabInfo = Schema.Struct({
  pageID: Schema.String,
  url: Schema.String,
  title: Schema.String,
  active: Schema.Boolean,
})

export const BrowserToolResponse = Schema.Struct({
  success: Schema.Boolean,
  data: Schema.Unknown,
  error: Schema.NullOr(Schema.String),
  browserState: BrowserState,
})

// ── Tool: browserNavigate ──────────────────────────────────────────

export const NavigateParameters = Schema.Struct({
  action: Schema.Literals(["goto", "back", "forward", "refresh", "newTab", "closeTab", "switchTab", "listTabs"])
    .annotate({ description: "Navigation action to perform" }),
  url: Schema.optional(
    Schema.String.annotate({ description: "URL to navigate to (required for 'goto' action)" })
  ),
  target: Schema.optional(
    Schema.String.annotate({ description: "Tab ID/index for 'switchTab', or URL for 'newTab'" })
  ),
})

// ── Tool: browserAction ────────────────────────────────────────────

export const ActionParameters = Schema.Struct({
  action: Schema.Literals([
    "click",
    "doubleClick",
    "rightClick",
    "type",
    "clear",
    "hover",
    "focus",
    "select",
    "check",
    "uncheck",
    "upload",
    "scroll",
    "scrollToElement",
  ]).annotate({ description: "Interaction action to perform on the page" }),
  target: Schema.String.annotate({
    description: "Element to interact with: CSS selector, visible text, or element reference",
  }),
  value: Schema.optional(
    Schema.String.annotate({ description: "Value for type, select, or upload actions" })
  ),
  optionValue: Schema.optional(
    Schema.String.annotate({ description: "Option value for select action" })
  ),
  pixels: Schema.optional(
    Schema.Number.annotate({ description: "Pixels to scroll (for scroll action)" })
  ),
})

// ── Tool: browserObserve ───────────────────────────────────────────

export const ObserveParameters = Schema.Struct({
  action: Schema.Literals(["snapshot", "screenshot", "text", "html", "links", "tables", "forms"])
    .annotate({ description: "Content extraction method" }),
  selector: Schema.optional(
    Schema.String.annotate({ description: "Scope extraction to a specific element" })
  ),
  fullPage: Schema.optional(
    Schema.Boolean.annotate({ description: "Capture full scrollable page (screenshot only)" })
  ),
})

// ── Tool: browserWait ──────────────────────────────────────────────

export const WaitParameters = Schema.Struct({
  action: Schema.Literals(["waitForElement", "waitForText", "waitForNetworkIdle"])
    .annotate({ description: "Wait condition to satisfy" }),
  target: Schema.String.annotate({
    description: "CSS selector or text content to wait for",
  }),
  timeout: Schema.optional(
    Schema.Number.annotate({ description: "Timeout in milliseconds (default: 30000)" })
  ),
})

// ── Tool: browserContext ───────────────────────────────────────────

export const ContextParameters = Schema.Struct({
  action: Schema.Literals([
    "listFrames",
    "switchFrame",
    "getCookies",
    "setCookies",
    "clearCookies",
    "getLocalStorage",
    "setLocalStorage",
    "removeLocalStorage",
  ]).annotate({ description: "Context operation to perform" }),
  target: Schema.optional(
    Schema.String.annotate({
      description: "Frame name/index, cookie/storage key, or domain filter",
    })
  ),
  name: Schema.optional(
    Schema.String.annotate({ description: "Cookie name (for cookie operations)" })
  ),
  value: Schema.optional(
    Schema.String.annotate({ description: "Value to set (for setCookies, setLocalStorage)" })
  ),
  domain: Schema.optional(
    Schema.String.annotate({ description: "Cookie domain scope" })
  ),
})

// ── Tool: browserDebug ─────────────────────────────────────────────

export const DebugParameters = Schema.Struct({
  action: Schema.Literals(["getConsoleLogs", "getNetworkRequests", "getPageErrors", "highlightElement", "locateElement"])
    .annotate({ description: "Debug/diagnostics action" }),
  target: Schema.optional(
    Schema.String.annotate({ description: "CSS selector (for highlightElement, locateElement)" })
  ),
  level: Schema.optional(
    Schema.Literals(["error", "warning", "info"]).annotate({
      description: "Console log level filter",
    })
  ),
})

// ── Tool: browserEval ──────────────────────────────────────────────

export const EvalParameters = Schema.Struct({
  code: Schema.String.annotate({ description: "JavaScript code to execute in browser context" }),
  returnByValue: Schema.optional(
    Schema.Boolean.annotate({ description: "Return result by value instead of reference (default: true)" })
  ),
})

export * as BrowserSchema from "./schema"
