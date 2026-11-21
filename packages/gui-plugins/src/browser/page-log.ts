// What the desktop log says when a tab's page ends or stalls. The log goes into bug reports, so a line never carries
// an address beyond its origin, a title, page text, or a command's arguments. Electron-free, so it stays unit-testable
// under Bun.

/**
 * What stopped a tab's page, which the window shows as `page_crashed`.
 *
 * - `renderer-gone`: Electron's `render-process-gone`, with its reason (`crashed`, `oom`, `killed`, `abnormal-exit`,
 *   `launch-failed`, `integrity-failure`, `clean-exit`) and the process's exit code.
 * - `target-crashed`: the debugger's `Inspector.targetCrashed`, which says no more than that.
 * - `debugger-detached`: the debugger left the page, with Chromium's reason; the page cannot run unguarded.
 * - `setup-failed`: the page did not become ready; `error` names the error and `command` the Chromium command.
 * - `frame-unprepared`: a frame of the page could not be guarded before it ran.
 * - `passkeys-unrestricted`: on Windows, passkeys could not be refused in a tab the agent drives or could script.
 */
export type PageEnd =
  | { readonly cause: "renderer-gone"; readonly reason: string; readonly exitCode: number }
  | { readonly cause: "target-crashed" }
  | { readonly cause: "debugger-detached"; readonly reason: string }
  | { readonly cause: "setup-failed"; readonly error: string; readonly command?: string }
  | { readonly cause: "frame-unprepared" }
  | { readonly cause: "passkeys-unrestricted" }

/** One field of a log line: never an object, so no value reaches the log unnamed. */
type Field = string | number | boolean | undefined

/** Writes one line to the desktop log. */
export type PageLogWrite = (level: "info" | "warn" | "error", message: string, data: Readonly<Record<string, Field>>) => void

/** A process's memory as Electron reports it, in kilobytes; `privateKB` on Windows only. */
export type ProcessMemory = {
  readonly pid: number
  readonly workingSetKB: number
  readonly peakWorkingSetKB: number
  readonly privateKB?: number
}

/** What one page's log remembers between lines. */
type PageLogState = {
  /** Set by the first signal of the page's end; `held` until its line is written, which settles `account`. */
  end?: {
    readonly at: number
    readonly account: Promise<PageEnd>
    readonly held?: { readonly end: PageEnd; readonly timer: ReturnType<typeof setTimeout>; readonly page: Readonly<Record<string, Field>>; readonly settle: (end: PageEnd) => void }
  }
  /** When Chromium reported the page unresponsive. */
  hung?: number
  loadFailed: boolean
  operation?: { readonly name: string; readonly by: "agent" | "user"; readonly at: number; running: boolean }
  sample?: { readonly memory: ProcessMemory; readonly at: number }
}

/**
 * The only form of an address the log may hold: scheme, host and port of a network address, and for every other
 * address the kind of page alone (`file`, `preview`, `artifact`, `about`, ...). Never credentials, a path, a query
 * or a fragment, which name mailboxes, documents and tokens.
 */
export function logOrigin(address: string): string {
  if (!address) return "none"
  const url = URL.parse(address)

  if (!url) return "invalid"

  // A blob's address holds the origin that made it and an id.
  if (url.protocol === "blob:") {
    const inner = logOrigin(url.pathname)

    return /^(?:https?|wss?|ftp):/.test(inner) ? `blob:${inner}` : "blob"
  }

  switch (url.protocol) {
    case "http:":
    case "https:":
    case "ws:":
    case "wss:":
    case "ftp:":
      return url.host ? `${url.protocol}//${url.host}` : "invalid"
    case "file:":
      return "file"
    case "oc-preview:":
    case "workspace:":
      return "preview"
    case "artifact:":
      return "artifact"
    case "about:":
      return "about"
    case "data:":
      return "data"
    case "chrome-extension:":
      return "extension"
    case "chrome-error:":
      return "error-page"
    default:
      return "other"
  }
}

/** A Windows exit code as people search for it: `-1073741819` is `0xC0000005`. */
export function exitCodeHex(code: number) {
  return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, "0")}`
}

/** The exit code's fields; the hexadecimal form on Windows, where exit codes are NTSTATUS values. */
export function exitCodeFields(code: number) {
  return process.platform === "win32" ? { exitCode: code, exitCodeHex: exitCodeHex(code) } : { exitCode: code }
}

/** What a failed setup may say of its error: its name, its code, and the Chromium command, never its message. */
export function setupFailure(cause: unknown): Extract<PageEnd, { cause: "setup-failed" }> {
  if (!(cause instanceof Error)) return { cause: "setup-failed", error: "not an Error" }
  const code = "code" in cause && /^[A-Za-z_]{1,64}$/.test(String(cause.code)) ? `${cause.name} ${String(cause.code)}` : cause.name
  const command = /Chromium command ([A-Za-z]+\.[A-Za-z]+) failed/.exec(cause.message)?.[1]

  return command ? { cause: "setup-failed", error: code, command } : { cause: "setup-failed", error: code }
}

/** The memory of process `pid` among Electron's `app.getAppMetrics()`, which lists a process only while it runs. */
export function processMemory(
  metrics: readonly { readonly pid: number; readonly memory: { readonly workingSetSize: number; readonly peakWorkingSetSize: number; readonly privateBytes?: number } }[],
  pid: number,
): ProcessMemory | undefined {
  const metric = metrics.find((entry) => entry.pid === pid)

  if (!metric) return undefined

  return {
    pid,
    workingSetKB: metric.memory.workingSetSize,
    peakWorkingSetKB: metric.memory.peakWorkingSetSize,
    ...(metric.memory.privateBytes !== undefined && { privateKB: metric.memory.privateBytes }),
  }
}

/**
 * How long a page's end waits for its process's own account before it is logged without one. Chromium's debugger
 * reports a crash a moment before `render-process-gone` does, and only the latter has the reason and the exit code.
 */
export const PROCESS_ACCOUNT_MS = 250

/**
 * One page's lines in the desktop log: when it ends, when it answers again after a stall, and when its main frame
 * fails to load. A page ends once, however many signals report it, and gets one line: the first signal's, which waits
 * `PROCESS_ACCOUNT_MS` for the process's own account (`renderer-gone`) and then carries both, with the first signal
 * as `first`.
 */
export function createPageLog(input: {
  readonly tab: string
  readonly write: PageLogWrite
  /** The page as it is when a line is written. */
  readonly page: () => { readonly address: string; readonly agentDriven: boolean; readonly loading: boolean }
  /** The page's process memory now; undefined once its process is gone. */
  readonly memory: () => ProcessMemory | undefined
}) {
  const opened = Date.now()

  const state: PageLogState = { loadFailed: false }

  const context = () => {
    const now = Date.now()
    const page = input.page()
    const live = input.memory()
    const sample = live ? { memory: live, at: now } : state.sample

    return {
      origin: logOrigin(page.address),
      agentDriven: page.agentDriven,
      openMs: now - opened,
      loading: page.loading,
      ...(state.operation && {
        operation: state.operation.name,
        operationBy: state.operation.by,
        operationAgoMs: now - state.operation.at,
        operationRunning: state.operation.running,
      }),
      ...(state.hung !== undefined && { unresponsiveMs: now - state.hung }),
      ...(sample && { ...sample.memory, memoryAgoMs: now - sample.at }),
    }
  }

  const ending = (end: PageEnd) => {
    switch (end.cause) {
      case "renderer-gone":
        return { tab: input.tab, cause: end.cause, reason: end.reason, ...exitCodeFields(end.exitCode) }
      case "debugger-detached":
        return { tab: input.tab, cause: end.cause, reason: end.reason.slice(0, 100) }
      case "setup-failed":
        return { tab: input.tab, cause: end.cause, error: end.error, command: end.command }
      default:
        return { tab: input.tab, cause: end.cause }
    }
  }

  return {
    /** Whether a signal already reported the page's end. */
    ended: () => !!state.end,
    /**
     * A signal of the page's end. Resolves to the end as the line records it: the process's own account when it came
     * within `PROCESS_ACCOUNT_MS`, whichever signal was first, and else the first signal.
     */
    end(end: PageEnd): Promise<PageEnd> {
      const first = state.end

      if (!first) {
        // Read now: the pane closes the page as soon as it hears of the end.
        const page = context()

        if (end.cause === "renderer-gone") {
          state.end = { at: Date.now(), account: Promise.resolve(end) }
          input.write("error", "browser page ended", { ...ending(end), ...page })

          return state.end.account
        }

        const account = Promise.withResolvers<PageEnd>()

        const timer = setTimeout(() => {
          state.end = { at: Date.now(), account: account.promise }
          input.write("error", "browser page ended", { ...ending(end), ...page })
          account.resolve(end)
        }, PROCESS_ACCOUNT_MS)

        // The line is not worth keeping the app alive for.
        timer.unref()
        state.end = { at: Date.now(), account: account.promise, held: { end, timer, page, settle: account.resolve } }

        return account.promise
      }

      if (!first.held || end.cause !== "renderer-gone") return first.account
      clearTimeout(first.held.timer)
      state.end = { at: first.at, account: first.account }
      input.write("error", "browser page ended", { ...ending(end), first: first.held.end.cause, firstMs: Date.now() - first.at, ...first.held.page })
      first.held.settle(end)

      return first.account
    },
    /** Chromium's hang monitor gave up on the page. It does not say so while a debugger is attached, as the pane's is. */
    unresponsive() {
      if (state.hung !== undefined || state.end) return
      input.write("warn", "browser page unresponsive", { tab: input.tab, ...context() })
      state.hung = Date.now()
    },
    /**
     * The page answers again after Chromium's hang monitor had given up on it. `unresponsiveMs` is there only when
     * Chromium reported the start of the stall.
     */
    responsive() {
      if (state.end) return
      input.write("warn", "browser page responsive", { tab: input.tab, ...context() })
      state.hung = undefined
    },
    /** A main-frame navigation started: its failure, if it fails, is logged once. */
    navigationStarted() {
      state.loadFailed = false
    },
    /** A main-frame load failed with Chromium's error `code` and its name. `address` is the one that failed. */
    loadFailed(code: number, error: string, address: string) {
      if (state.loadFailed || state.end) return
      state.loadFailed = true
      input.write("warn", "browser page load failed", { tab: input.tab, code, error: /^[A-Z_]{1,64}$/.test(error) ? error : undefined, ...context(), origin: logOrigin(address) })
    },
    /** A command starts on the page: only its name is kept. Returns what to call when it settles. */
    operation(name: string, by: "agent" | "user") {
      const run = { name, by, at: Date.now(), running: true }
      state.operation = run

      return () => {
        run.running = false
      }
    },
    /** Keeps the page's memory as last seen, for the line written once its process is gone. */
    sample(memory: ProcessMemory | undefined) {
      if (memory) state.sample = { memory, at: Date.now() }
    },
  }
}
