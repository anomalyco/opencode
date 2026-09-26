import { Effect, Ref, Schema } from "effect"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"

/**
 * Browser tool — Fase 4 (browser agent nativo). Drives one Playwright/Chromium
 * session per workspace instance and returns evidence (screenshots as
 * attachments, console/network drains) for the verification loop.
 *
 * Playwright is an OPTIONAL dependency: it is loaded through a variable
 * specifier so the package typechecks and runs without it installed, and
 * `open` fails with honest installation instructions instead of pretending
 * a browser exists (Fase 40 — no simulated results).
 *
 * - One session per instance (the registry creates this tool per directory);
 *   `open` is idempotent, `close` is idempotent.
 * - console/network/downloads buffers cap and DRAIN on read so evidence is
 *   never repeated across reads.
 * - `open`, `goto`, and `eval` request the "browser" permission (pattern =
 *   URL); in-page actions run inside the already-approved session.
 */

export const Parameters = Schema.Struct({
  action: Schema.Literals([
    "open",
    "close",
    "goto",
    "back",
    "forward",
    "click",
    "fill",
    "select",
    "upload",
    "screenshot",
    "snapshot",
    "eval",
    "console",
    "network",
    "downloads",
    "viewport",
    "wait",
  ]).annotate({ description: "The browser operation to perform." }),
  url: Schema.optional(Schema.String).annotate({
    description: "URL for goto; optional immediate navigation on open.",
  }),
  selector: Schema.optional(Schema.String).annotate({
    description: "CSS selector for click/fill/select/upload/wait.",
  }),
  value: Schema.optional(Schema.String).annotate({
    description: "Text for fill, option value or label for select, absolute file path for upload.",
  }),
  code: Schema.optional(Schema.String).annotate({ description: "JavaScript expression for eval (page context)." }),
  path: Schema.optional(Schema.String).annotate({
    description: "Destination file for screenshot instead of an attachment.",
  }),
  width: Schema.optional(Schema.Number).annotate({ description: "Viewport width for viewport (requires height)." }),
  height: Schema.optional(Schema.Number).annotate({ description: "Viewport height for viewport (requires width)." }),
  fullPage: Schema.optional(Schema.Boolean).annotate({
    description: "Capture the full scrollable page (screenshot).",
  }),
  headless: Schema.optional(Schema.Boolean).annotate({
    description: "Run without a visible window on open (default true).",
  }),
  timeoutMs: Schema.optional(Schema.Number).annotate({
    description: "Timeout for navigation and interaction actions (default 30000).",
  }),
})

// Structural subset of the Playwright API this tool uses. The module is loaded
// through a widened string specifier so TypeScript does not resolve it at
// compile time — Playwright stays an optional runtime dependency.
interface PlaywrightModule {
  readonly chromium: {
    launch(options?: { headless?: boolean }): Promise<PlaywrightRuntime["browser"]>
  }
}
interface PlaywrightRuntime {
  readonly browser: {
    newPage(): Promise<PlaywrightPage>
    close(): Promise<void>
  }
  readonly page: PlaywrightPage
}
interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number }): Promise<unknown>
  goBack(options?: { timeout?: number }): Promise<unknown>
  goForward(options?: { timeout?: number }): Promise<unknown>
  click(selector: string, options?: { timeout?: number }): Promise<unknown>
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<unknown>
  selectOption(selector: string, value: string, options?: { timeout?: number }): Promise<unknown>
  setInputFiles(selector: string, file: string, options?: { timeout?: number }): Promise<unknown>
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer>
  content(): Promise<string>
  evaluate(code: string): Promise<unknown>
  setViewportSize(size: { width: number; height: number }): Promise<void>
  viewportSize(): { width: number; height: number } | null
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>
  url(): string
  title(): Promise<string>
  on(event: "console", listener: (message: ConsoleMessage) => void): void
  on(event: "pageerror", listener: (error: Error) => void): void
  on(event: "response", listener: (response: PageResponse) => void): void
  on(event: "requestfailed", listener: (request: FailedRequest) => void): void
  on(event: "download", listener: (download: Download) => void): void
}
interface ConsoleMessage {
  type(): string
  text(): string
  location(): { url: string; lineNumber: number }
}
interface PageResponse {
  status(): number
  url(): string
  ok(): boolean
  request(): { method(): string; resourceType(): string }
}
interface FailedRequest {
  url(): string
  method(): string
  resourceType(): string
  failure(): { errorText: string } | null
}
interface Download {
  suggestedFilename(): string
  path(): Promise<string>
}

interface ConsoleEntry {
  readonly at: number
  readonly type: string
  readonly text: string
  readonly url?: string
  readonly line?: number
}
interface NetworkEntry {
  readonly at: number
  readonly method: string
  readonly url: string
  readonly resourceType: string
  readonly ok: boolean
  readonly status?: number
  readonly failure?: string
}
interface DownloadEntry {
  readonly at: number
  readonly filename: string
  readonly path?: string
  readonly error?: string
}
interface Session {
  readonly browser: PlaywrightRuntime["browser"]
  readonly page: PlaywrightPage
  readonly console: ConsoleEntry[]
  readonly network: NetworkEntry[]
  readonly downloads: DownloadEntry[]
}

const MAX_CONSOLE = 200
const MAX_NETWORK = 500
const MAX_DOWNLOADS = 100

// Widened to string on purpose: a literal type would make TypeScript resolve
// the module at compile time, which must not happen for an optional package.
const PLAYWRIGHT: string = "playwright"

const loadPlaywright = Effect.promise(() =>
  import(PLAYWRIGHT).then(
    (module) => module as unknown as PlaywrightModule,
    () => undefined,
  ),
)

const attempt = <A>(label: string, task: () => Promise<A>) =>
  Effect.promise(() =>
    task().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`browser ${label} failed: ${detail}`)
    }),
  )

const requireField = <T>(action: string, name: string, value: T | undefined): T => {
  if (value === undefined) throw new Error(`The browser action "${action}" requires "${name}".`)
  return value
}

const cap = <A>(entries: A[], entry: A, max: number) => {
  entries.push(entry)
  if (entries.length > max) entries.splice(0, entries.length - max)
}

const stamp = (at: number) => new Date(at).toISOString().slice(11, 23)

// Subscribes the page events that back evidence gathering: console output,
// uncaught page errors, network responses/failures, and downloads (copied to
// the temp dir through Bun, which creates parent directories).
const observePage = (session: Session) => {
  session.page.on("console", (message) => {
    const location = message.location()
    cap(
      session.console,
      {
        at: Date.now(),
        type: message.type(),
        text: message.text(),
        ...(location?.url ? { url: location.url, line: location.lineNumber } : {}),
      },
      MAX_CONSOLE,
    )
  })
  session.page.on("pageerror", (error) =>
    cap(session.console, { at: Date.now(), type: "pageerror", text: error.message }, MAX_CONSOLE),
  )
  session.page.on("response", (response) => {
    const request = response.request()
    cap(
      session.network,
      {
        at: Date.now(),
        method: request.method(),
        url: response.url(),
        resourceType: request.resourceType(),
        ok: response.ok(),
        status: response.status(),
      },
      MAX_NETWORK,
    )
  })
  session.page.on("requestfailed", (request) =>
    cap(
      session.network,
      {
        at: Date.now(),
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        ok: false,
        failure: request.failure()?.errorText ?? "request failed",
      },
      MAX_NETWORK,
    ),
  )
  session.page.on("download", (download) => {
    const filename = path.basename(download.suggestedFilename())
    const target = path.join(Global.Path.tmp, "opencode-browser", filename)
    const failed = (error: unknown) =>
      cap(session.downloads, { at: Date.now(), filename, error: String(error) }, MAX_DOWNLOADS)
    download
      .path()
      .then(
        (source) =>
          Bun.write(target, Bun.file(source)).then(
            () => cap(session.downloads, { at: Date.now(), filename, path: target }, MAX_DOWNLOADS),
            failed,
          ),
        failed,
      )
  })
}

const navigate = (page: PlaywrightPage, url: string, timeout: number) =>
  Effect.gen(function* () {
    yield* attempt("goto", () => page.goto(url, { timeout }))
    const title = yield* attempt("title", () => page.title())
    return `Navigated to ${page.url()}\nTitle: ${title}`
  })

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    const session = yield* Ref.make<Session | undefined>(undefined)

    const requireSession = (action: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(session)
        if (current === undefined)
          throw new Error(`The browser action "${action}" requires an open browser session. Call action "open" first.`)
        return current
      })

    const ask = (ctx: Tool.Context, action: string, url?: string) =>
      ctx.ask({
        permission: "browser",
        patterns: [url ?? "*"],
        always: ["*"],
        metadata: { action, url: url ?? "" },
      })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const action = params.action
          const timeout = params.timeoutMs ?? 30_000

          switch (action) {
            case "open": {
              yield* ask(ctx, action, params.url)
              const existing = yield* Ref.get(session)
              if (existing !== undefined) {
                const navigation = params.url ? yield* navigate(existing.page, params.url, timeout) : ""
                return {
                  title: "browser open",
                  output: [`Browser already open at ${existing.page.url()}.`, navigation].filter(Boolean).join("\n"),
                  metadata: {},
                }
              }
              const playwright = yield* loadPlaywright
              if (playwright === undefined)
                throw new Error(
                  'Browser automation is unavailable: the optional "playwright" package is not installed. ' +
                    "Install it with `bun add playwright` and its browsers with `bunx playwright install chromium`, " +
                    "then retry the action.",
                )
              const headless = params.headless ?? true
              const runtime = yield* attempt("open", async () => {
                const browser = await playwright.chromium.launch({ headless })
                try {
                  const page = await browser.newPage()
                  return { browser, page }
                } catch (error) {
                  // A page that never opened would leak the browser process.
                  await browser.close().catch(() => undefined)
                  throw error
                }
              })
              const state: Session = {
                browser: runtime.browser,
                page: runtime.page,
                console: [],
                network: [],
                downloads: [],
              }
              observePage(state)
              yield* Ref.set(session, state)
              const navigation = params.url ? yield* navigate(state.page, params.url, timeout) : ""
              return {
                title: "browser open",
                output: [
                  `Browser opened (headless=${headless}).`,
                  navigation || `Call action "goto" with a url to navigate. Current page: ${state.page.url()}`,
                ].join("\n"),
                metadata: {},
              }
            }
            case "close": {
              const current = yield* Ref.get(session)
              if (current === undefined)
                return { title: "browser close", output: "No browser session to close.", metadata: {} }
              yield* attempt("close", () => current.browser.close())
              yield* Ref.set(session, undefined)
              return {
                title: "browser close",
                output: "Browser closed. Console, network, and download buffers cleared.",
                metadata: {},
              }
            }
            case "goto": {
              const url = requireField(action, "url", params.url)
              yield* ask(ctx, action, url)
              const current = yield* requireSession(action)
              const summary = yield* navigate(current.page, url, timeout)
              return { title: `browser goto ${url}`, output: summary, metadata: {} }
            }
            case "back":
            case "forward": {
              const current = yield* requireSession(action)
              const response = yield* attempt(action, () =>
                action === "back" ? current.page.goBack({ timeout }) : current.page.goForward({ timeout }),
              )
              return {
                title: `browser ${action}`,
                output:
                  response === null
                    ? `No history entry to go ${action}. Still at ${current.page.url()}`
                    : `Went ${action}. Now at ${current.page.url()}`,
                metadata: {},
              }
            }
            case "click": {
              const selector = requireField(action, "selector", params.selector)
              const current = yield* requireSession(action)
              yield* attempt("click", () => current.page.click(selector, { timeout }))
              return {
                title: `browser click ${selector}`,
                output: `Clicked "${selector}". Page: ${current.page.url()}`,
                metadata: {},
              }
            }
            case "fill": {
              const selector = requireField(action, "selector", params.selector)
              const value = requireField(action, "value", params.value)
              const current = yield* requireSession(action)
              yield* attempt("fill", () => current.page.fill(selector, value, { timeout }))
              return { title: `browser fill ${selector}`, output: `Filled "${selector}".`, metadata: {} }
            }
            case "select": {
              const selector = requireField(action, "selector", params.selector)
              const value = requireField(action, "value", params.value)
              const current = yield* requireSession(action)
              yield* attempt("select", () => current.page.selectOption(selector, value, { timeout }))
              return {
                title: `browser select ${selector}`,
                output: `Selected "${value}" in "${selector}".`,
                metadata: {},
              }
            }
            case "upload": {
              const selector = requireField(action, "selector", params.selector)
              const file = requireField(action, "value", params.value)
              const current = yield* requireSession(action)
              yield* attempt("upload", () => current.page.setInputFiles(selector, file, { timeout }))
              return { title: `browser upload ${selector}`, output: `Attached ${file} to "${selector}".`, metadata: {} }
            }
            case "screenshot": {
              const current = yield* requireSession(action)
              const options = {
                ...(params.path !== undefined ? { path: params.path } : {}),
                ...(params.fullPage === true ? { fullPage: true } : {}),
              }
              const image = yield* attempt("screenshot", () => current.page.screenshot(options))
              if (params.path !== undefined)
                return { title: "browser screenshot", output: `Screenshot saved to ${params.path}`, metadata: {} }
              return {
                title: "browser screenshot",
                output: `Screenshot captured (${params.fullPage === true ? "full page" : "viewport"}).`,
                attachments: [
                  {
                    type: "file" as const,
                    mime: "image/png",
                    url: `data:image/png;base64,${image.toString("base64")}`,
                  },
                ],
                metadata: {},
              }
            }
            case "snapshot": {
              const current = yield* requireSession(action)
              const html = yield* attempt("snapshot", () => current.page.content())
              const title = yield* attempt("snapshot (title)", () => current.page.title())
              return {
                title: "browser snapshot",
                output: `URL: ${current.page.url()}\nTitle: ${title}\n\n${html}`,
                metadata: {},
              }
            }
            case "eval": {
              const code = requireField(action, "code", params.code)
              yield* ask(ctx, action)
              const current = yield* requireSession(action)
              const value = yield* attempt("eval", () => current.page.evaluate(code))
              const output = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))
              return { title: "browser eval", output, metadata: {} }
            }
            case "console": {
              const current = yield* requireSession(action)
              const entries = current.console.splice(0)
              if (entries.length === 0)
                return { title: "browser console", output: "No console messages since the last read.", metadata: {} }
              return {
                title: `browser console (${entries.length})`,
                output: entries
                  .map((entry) => {
                    const where = entry.url ? ` (${entry.url}:${entry.line ?? 0})` : ""
                    return `[${stamp(entry.at)}] ${entry.type}: ${entry.text}${where}`
                  })
                  .join("\n"),
                metadata: {},
              }
            }
            case "network": {
              const current = yield* requireSession(action)
              const entries = current.network.splice(0)
              if (entries.length === 0)
                return { title: "browser network", output: "No network activity since the last read.", metadata: {} }
              return {
                title: `browser network (${entries.length})`,
                output: entries
                  .map((entry) => {
                    const outcome = entry.ok
                      ? `→ ${entry.status}`
                      : `→ ${entry.failure ?? `HTTP ${entry.status ?? "failed"}`}`
                    return `[${stamp(entry.at)}] ${entry.method} ${entry.url} ${outcome} (${entry.resourceType})`
                  })
                  .join("\n"),
                metadata: {},
              }
            }
            case "downloads": {
              const current = yield* requireSession(action)
              const entries = current.downloads.splice(0)
              if (entries.length === 0)
                return {
                  title: "browser downloads",
                  output: "No completed downloads since the last read.",
                  metadata: {},
                }
              return {
                title: `browser downloads (${entries.length})`,
                output: entries
                  .map((entry) =>
                    entry.path !== undefined
                      ? `[${stamp(entry.at)}] ${entry.filename} → ${entry.path}`
                      : `[${stamp(entry.at)}] ${entry.filename} FAILED: ${entry.error ?? "unknown error"}`,
                  )
                  .join("\n"),
                metadata: {},
              }
            }
            case "viewport": {
              if (params.width !== undefined || params.height !== undefined) {
                const width = requireField(action, "width", params.width)
                const height = requireField(action, "height", params.height)
                if (width <= 0 || height <= 0)
                  throw new Error(
                    `The browser action "viewport" requires positive width and height (got ${width}x${height}).`,
                  )
                const current = yield* requireSession(action)
                yield* attempt("viewport", () => current.page.setViewportSize({ width, height }))
                return { title: "browser viewport", output: `Viewport set to ${width}x${height}.`, metadata: {} }
              }
              const current = yield* requireSession(action)
              const size = current.page.viewportSize()
              return {
                title: "browser viewport",
                output: `Viewport: ${size === null ? "unknown" : `${size.width}x${size.height}`}`,
                metadata: {},
              }
            }
            case "wait": {
              const current = yield* requireSession(action)
              const selector = params.selector
              if (selector !== undefined) {
                yield* attempt("wait", () => current.page.waitForSelector(selector, { timeout }))
                return { title: "browser wait", output: `Selector "${selector}" is present.`, metadata: {} }
              }
              const ms = Math.min(params.timeoutMs ?? 1000, 30_000)
              yield* Effect.sleep(`${ms} millis`)
              return { title: "browser wait", output: `Waited ${ms}ms.`, metadata: {} }
            }
            default:
              // `satisfies never` makes a new Parameters literal without a case
              // above a compile-time error instead of a silent fallthrough.
              return yield* Effect.die(new Error(`Unsupported browser action: ${String(action satisfies never)}`))
          }
        }).pipe(Effect.orDie),
    }
  }),
)
