export const NETLOG_TIMEOUT_MS = 5_000

export const EXPORT_ARCHIVE_TIMEOUT_MS = 60_000

/** Settles one `exportDebug` caller. */
export type ExportReply = { readonly resolve: (output: string) => void; readonly reject: (error: Error) => void }

export type NetLogMode = "start" | "restart"

/**
 * The network log and the debug-log export, which pauses it so the archive reads a complete `network.netlog`. Every
 * NetLog call and every archive goes through here, one at a time; exports requested meanwhile join the one in flight.
 * `netLogPath` is set once NetLog really started in this run, and is what the manifest reports.
 */
export type LoggingState =
  | {
      readonly status: "idle"
      readonly attempt: number
      readonly netLog: "off" | "active"
      readonly netLogPath: string | undefined
    }
  | {
      readonly status: "starting-netlog"
      readonly attempt: number
      readonly netLogPath: string | undefined
      readonly exports: readonly ExportReply[]
    }
  | {
      readonly status: "stopping-netlog"
      readonly attempt: number
      readonly netLogPath: string | undefined
      readonly exports: readonly ExportReply[]
    }
  /** `resumeNetLog`: NetLog ran before the export, or was asked for during it, and starts once the archive is done. */
  | {
      readonly status: "archiving"
      readonly attempt: number
      readonly resumeNetLog: boolean
      readonly netLogPath: string | undefined
      readonly exports: readonly ExportReply[]
    }
  | { readonly status: "disposed" }

export type LoggingEvent =
  | { readonly type: "network.requested" }
  | { readonly type: "export.requested"; readonly reply: ExportReply }
  | { readonly type: "export.cancelled"; readonly reply: ExportReply }
  | { readonly type: "netlog.started"; readonly attempt: number; readonly path: string }
  /** NetLog failed or timed out; the driver logged why. */
  | { readonly type: "netlog.start-failed"; readonly attempt: number }
  /** Also sent when stopping failed or timed out: the archive goes ahead either way. */
  | { readonly type: "netlog.stopped"; readonly attempt: number }
  | { readonly type: "archive.succeeded"; readonly attempt: number; readonly output: string }
  | { readonly type: "archive.failed"; readonly attempt: number; readonly error: Error }
  | { readonly type: "disposed" }

export type LoggingCommand =
  | { readonly type: "start-netlog"; readonly attempt: number; readonly mode: NetLogMode }
  | { readonly type: "stop-netlog"; readonly attempt: number }
  | { readonly type: "write-archive"; readonly attempt: number; readonly netLogPath: string | undefined }
  | { readonly type: "resolve-export"; readonly replies: readonly ExportReply[]; readonly output: string }
  | { readonly type: "reject-export"; readonly replies: readonly ExportReply[]; readonly error: Error }

export type LoggingTransition = { readonly state: LoggingState; readonly commands: readonly LoggingCommand[] }

export const DISPOSED_ERROR = new Error("Desktop logging is disposed")

export function initialLoggingState(): LoggingState {
  return { status: "idle", attempt: 0, netLog: "off", netLogPath: undefined }
}

export function transitionLogging(state: LoggingState, event: LoggingEvent): LoggingTransition {
  if (state.status === "disposed") {
    if (event.type === "export.requested")
      return unchanged(state, [{ type: "reject-export", replies: [event.reply], error: DISPOSED_ERROR }])

    return unchanged(state)
  }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      commands:
        state.status === "idle" || state.exports.length === 0
          ? []
          : [{ type: "reject-export", replies: state.exports, error: DISPOSED_ERROR }],
    }

  if (state.status === "idle") return idle(state, event)

  if (event.type === "network.requested")
    return state.status === "archiving" && !state.resumeNetLog
      ? { state: { ...state, resumeNetLog: true }, commands: [] }
      : unchanged(state)

  if (event.type === "export.requested") return { state: { ...state, exports: [...state.exports, event.reply] }, commands: [] }

  if (event.type === "export.cancelled")
    return state.exports.includes(event.reply)
      ? { state: { ...state, exports: state.exports.filter((reply) => reply !== event.reply) }, commands: [] }
      : unchanged(state)

  if (event.attempt !== state.attempt) return unchanged(state)

  if (state.status === "starting-netlog" && (event.type === "netlog.started" || event.type === "netlog.start-failed")) {
    const netLogPath = event.type === "netlog.started" ? event.path : state.netLogPath

    if (state.exports.length === 0)
      return {
        state: {
          status: "idle",
          attempt: state.attempt,
          netLog: event.type === "netlog.started" ? "active" : "off",
          netLogPath,
        },
        commands: [],
      }

    if (event.type === "netlog.started") return stop(state.attempt + 1, netLogPath, state.exports)

    return archive(state.attempt + 1, false, netLogPath, state.exports)
  }

  if (state.status === "stopping-netlog" && event.type === "netlog.stopped")
    return archive(state.attempt + 1, true, state.netLogPath, state.exports)

  if (state.status === "archiving" && (event.type === "archive.succeeded" || event.type === "archive.failed")) {
    const settle: LoggingCommand =
      event.type === "archive.succeeded"
        ? { type: "resolve-export", replies: state.exports, output: event.output }
        : { type: "reject-export", replies: state.exports, error: event.error }

    if (!state.resumeNetLog)
      return {
        state: { status: "idle", attempt: state.attempt, netLog: "off", netLogPath: state.netLogPath },
        commands: [settle],
      }

    return {
      state: {
        status: "starting-netlog",
        attempt: state.attempt + 1,
        netLogPath: state.netLogPath,
        exports: [],
      },
      commands: [settle, { type: "start-netlog", attempt: state.attempt + 1, mode: "restart" }],
    }
  }

  return unchanged(state)
}

function idle(state: Extract<LoggingState, { status: "idle" }>, event: LoggingEvent): LoggingTransition {
  if (event.type === "network.requested") {
    if (state.netLog === "active") return unchanged(state)

    const attempt = state.attempt + 1

    return {
      state: { status: "starting-netlog", attempt, netLogPath: state.netLogPath, exports: [] },
      commands: [{ type: "start-netlog", attempt, mode: "start" }],
    }
  }

  if (event.type !== "export.requested") return unchanged(state)

  if (state.netLog === "active") return stop(state.attempt + 1, state.netLogPath, [event.reply])

  return archive(state.attempt + 1, false, state.netLogPath, [event.reply])
}

function stop(attempt: number, netLogPath: string | undefined, exports: readonly ExportReply[]): LoggingTransition {
  return {
    state: { status: "stopping-netlog", attempt, netLogPath, exports },
    commands: [{ type: "stop-netlog", attempt }],
  }
}

function archive(
  attempt: number,
  resumeNetLog: boolean,
  netLogPath: string | undefined,
  exports: readonly ExportReply[],
): LoggingTransition {
  return {
    state: { status: "archiving", attempt, resumeNetLog, netLogPath, exports },
    commands: [{ type: "write-archive", attempt, netLogPath }],
  }
}

function unchanged(state: LoggingState, commands: LoggingCommand[] = []): LoggingTransition {
  return { state, commands }
}
