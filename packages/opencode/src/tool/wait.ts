import { open as fsOpen } from "node:fs/promises"
import path from "path"
import { Duration, Effect, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./wait.txt"
import * as Tool from "./tool"

const MAX_SECONDS = 3600
const DEFAULT_POLL_INTERVAL_MS = 5_000
const MIN_POLL_INTERVAL_MS = 100
const MAX_POLL_INTERVAL_MS = 60_000
const DEFAULT_STABLE_REQUIRED_MS = 10_000
const MAX_STABLE_REQUIRED_MS = 600_000
const DEFAULT_URL_TIMEOUT_MS = 10_000
const DEFAULT_TEXT_TAIL_BYTES = 32_768
const MAX_TEXT_TAIL_BYTES = 1_048_576

export const Parameters = Schema.Struct({
  seconds: Schema.Number.check(Schema.isInt())
    .check(Schema.isGreaterThanOrEqualTo(1))
    .check(Schema.isLessThanOrEqualTo(MAX_SECONDS))
    .annotate({
      description: `Maximum number of seconds to wait before continuing in this same chat. Range 1-${MAX_SECONDS} (1 hour cap).`,
    }),
  reason: Schema.String.annotate({
    description: "Short reason shown to the user in the UI explaining why the agent is paused.",
  }),
  until_file: Schema.optional(Schema.String).annotate({
    description:
      "Optional file path. If provided, poll this file and return early once its size has been stable for stable_ms. Relative paths resolve from the current project directory.",
  }),
  min_size_bytes: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))).annotate(
    {
      description:
        "Optional. Used only with until_file. The file must reach at least this many bytes before the stable-size check can succeed.",
    },
  ),
  poll_interval_ms: Schema.optional(
    Schema.Number.check(Schema.isInt())
      .check(Schema.isGreaterThanOrEqualTo(MIN_POLL_INTERVAL_MS))
      .check(Schema.isLessThanOrEqualTo(MAX_POLL_INTERVAL_MS)),
  ).annotate({
    description: `Optional polling interval in milliseconds for until_file/until_url/until_pid_exit and cancel_if_file checks. Range ${MIN_POLL_INTERVAL_MS}-${MAX_POLL_INTERVAL_MS}. Default ${DEFAULT_POLL_INTERVAL_MS}.`,
  }),
  stable_ms: Schema.optional(
    Schema.Number.check(Schema.isInt())
      .check(Schema.isGreaterThanOrEqualTo(0))
      .check(Schema.isLessThanOrEqualTo(MAX_STABLE_REQUIRED_MS)),
  ).annotate({
    description: `Optional stable-size window in milliseconds for until_file. Default ${DEFAULT_STABLE_REQUIRED_MS}. Use 0 to return as soon as the file exists and meets min_size_bytes.`,
  }),
  cancel_if_file: Schema.optional(Schema.String).annotate({
    description:
      "Optional sentinel file path. If this file appears while waiting, return early with cancelled_by_file=true instead of waiting for the timeout. Relative paths resolve from the current project directory.",
  }),
  until_url: Schema.optional(Schema.String).annotate({
    description:
      "Optional http(s) URL. If provided, poll the URL with HEAD (then GET as fallback) and return early once the response status matches until_url_status. Useful for waiting on a dev server or service to come up.",
  }),
  until_url_status: Schema.optional(
    Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(100)).check(Schema.isLessThanOrEqualTo(599)),
  ).annotate({
    description:
      "Optional HTTP status code to consider success for until_url. Defaults to 200. A 2xx-class match can be requested as 200, 204, etc. Pass a number such as 401 to wait until an auth-protected endpoint at least responds.",
  }),
  until_pid_exit: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description:
      "Optional process id. If provided, return early once the process is no longer running. Useful for waiting on a backgrounded shell command to finish.",
  }),
  until_text: Schema.optional(Schema.String).annotate({
    description:
      "Optional file path to tail. If provided alongside until_text_pattern, the wait returns as soon as that pattern matches the tail of the file. Pairs well with bash backgrounded jobs that write to a log file.",
  }),
  until_text_pattern: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))).annotate({
    description:
      "Optional regex (JavaScript flavour, no surrounding slashes) used with until_text. Matched against the last text_tail_bytes of the file. The match is case-sensitive; prefix with `(?i)` is NOT supported, use `[Aa][Bb]` style instead, or pass text_pattern_flags='i'.",
  }),
  text_pattern_flags: Schema.optional(Schema.String.check(Schema.isMaxLength(8))).annotate({
    description:
      "Optional regex flags for until_text_pattern, e.g. 'i' (case-insensitive), 'm' (multi-line), 's' (dotall). Defaults to 'm'.",
  }),
  text_tail_bytes: Schema.optional(
    Schema.Number.check(Schema.isInt())
      .check(Schema.isGreaterThanOrEqualTo(256))
      .check(Schema.isLessThanOrEqualTo(MAX_TEXT_TAIL_BYTES)),
  ).annotate({
    description: `Optional byte size of the file tail to test against until_text_pattern. Range 256-${MAX_TEXT_TAIL_BYTES}. Default ${DEFAULT_TEXT_TAIL_BYTES}.`,
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

type WaitMode = "fixed" | "until_file" | "until_url" | "until_pid_exit" | "until_text"

type Metadata = {
  mode: WaitMode
  seconds: number
  reason: string
  elapsed_seconds?: number
  remaining_seconds?: number
  aborted?: boolean
  target?: string
  min_size_bytes?: number
  poll_interval_ms?: number
  stable_ms?: number
  size_bytes?: number
  polls?: number
  ready?: boolean
  timed_out?: boolean
  reached_min_size?: boolean
  cancel_if_file?: string
  cancelled_by_file?: boolean
  url?: string
  url_status?: number
  expected_status?: number
  pid?: number
  exited?: boolean
  pattern?: string
  pattern_flags?: string
  text_tail_bytes?: number
  matched?: boolean
  match?: string
}

const abortable = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  signal: AbortSignal,
): Effect.Effect<A | "__aborted__", E, R> =>
  Effect.race(
    effect,
    Effect.callback<"__aborted__">((resume) => {
      if (signal.aborted) {
        resume(Effect.succeed("__aborted__"))
        return
      }
      const handler = () => resume(Effect.succeed("__aborted__"))
      signal.addEventListener("abort", handler, { once: true })
      return Effect.sync(() => signal.removeEventListener("abort", handler))
    }),
  )

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
const done = (result: Tool.ExecuteResult<Metadata>) => result
const sleepMs = (ms: number) => Effect.sleep(Duration.millis(Math.max(0, ms)))

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    // EPERM means it exists but we lack permission to signal it - still alive.
    return err?.code === "EPERM"
  }
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string | undefined> {
  try {
    const fh = await fsOpen(filePath, "r")
    try {
      const stat = await fh.stat()
      const size = Number(stat.size ?? 0)
      const readBytes = Math.min(size, maxBytes)
      if (readBytes <= 0) return ""
      const buf = Buffer.alloc(readBytes)
      const start = size - readBytes
      await fh.read(buf, 0, readBytes, start)
      return buf.toString("utf8")
    } finally {
      await fh.close().catch(() => undefined)
    }
  } catch {
    return undefined
  }
}

function compilePattern(pattern: string, flags: string | undefined): RegExp {
  const safeFlags = (flags ?? "m").replace(/[^gimsuy]/g, "")
  // Always include 'm' so ^/$ work line-by-line by default.
  const finalFlags = safeFlags.includes("m") ? safeFlags : safeFlags + "m"
  return new RegExp(pattern, finalFlags)
}

async function probeUrl(url: string, signal: AbortSignal, timeoutMs: number) {
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  signal.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    let res: Response | undefined
    try {
      res = await fetch(url, { method: "HEAD", signal: ac.signal, redirect: "follow" })
    } catch {
      // HEAD often disallowed; fall through to GET.
    }
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", signal: ac.signal, redirect: "follow" })
    }
    return { status: res.status as number | undefined, error: undefined as string | undefined }
  } catch (err: any) {
    return { status: undefined, error: err?.message ?? String(err) }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }
}

export const WaitTool = Tool.define(
  "wait",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const start = Date.now()
          const deadline = start + params.seconds * 1000
          const pollIntervalMs = params.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS
          const stableRequiredMs = params.stable_ms ?? DEFAULT_STABLE_REQUIRED_MS
          const cancelTarget = params.cancel_if_file
            ? path.isAbsolute(params.cancel_if_file)
              ? params.cancel_if_file
              : path.resolve(ins.directory, params.cancel_if_file)
            : undefined

          const checkCancel = () =>
            cancelTarget
              ? fs.stat(cancelTarget).pipe(
                  Effect.map(() => true),
                  Effect.catch(() => Effect.succeed(false)),
                )
              : Effect.succeed(false)

          if (params.until_text || params.until_text_pattern) {
            if (!params.until_text || !params.until_text_pattern) {
              throw new Error(
                "wait: until_text and until_text_pattern must be provided together. until_text is the file path to tail; until_text_pattern is the regex to match.",
              )
            }
            const tailBytes = params.text_tail_bytes ?? DEFAULT_TEXT_TAIL_BYTES
            let regex: RegExp
            try {
              regex = compilePattern(params.until_text_pattern, params.text_pattern_flags)
            } catch (err: unknown) {
              throw new Error(`wait: until_text_pattern is not a valid regex: ${(err as Error).message}`)
            }
            const target = path.isAbsolute(params.until_text)
              ? params.until_text
              : path.resolve(ins.directory, params.until_text)

            yield* ctx.metadata({
              title: `wait up to ${params.seconds}s for /${regex.source}/ in ${path.basename(target)}`,
              metadata: {
                mode: "until_text",
                target,
                pattern: regex.source,
                pattern_flags: regex.flags,
                text_tail_bytes: tailBytes,
                seconds: params.seconds,
                reason: params.reason,
                poll_interval_ms: pollIntervalMs,
                cancel_if_file: cancelTarget,
              },
            })

            let aborted = false
            let cancelledByFile = false
            let pollCount = 0
            let matched = false
            let matchText: string | undefined
            let lastTitleUpdate = start

            while (Date.now() < deadline) {
              if (yield* checkCancel()) {
                cancelledByFile = true
                break
              }
              pollCount++

              const tail = yield* Effect.promise(() => readFileTail(target, tailBytes))
              if (typeof tail === "string") {
                const m = regex.exec(tail)
                if (m) {
                  matched = true
                  matchText = m[0].slice(0, 200)
                  break
                }
              }

              const now = Date.now()
              if (now - lastTitleUpdate >= 1000 && now < deadline) {
                lastTitleUpdate = now
                const left = Math.max(0, Math.ceil((deadline - now) / 1000))
                yield* ctx.metadata({
                  title: `wait /${regex.source}/ in ${path.basename(target)} (${left}s left)`,
                  metadata: {
                    mode: "until_text",
                    target,
                    pattern: regex.source,
                    pattern_flags: regex.flags,
                    text_tail_bytes: tailBytes,
                    seconds: params.seconds,
                    reason: params.reason,
                    elapsed_seconds: (now - start) / 1000,
                    remaining_seconds: left,
                    polls: pollCount,
                    poll_interval_ms: pollIntervalMs,
                    cancel_if_file: cancelTarget,
                  },
                })
              }

              const remaining = deadline - Date.now()
              if (remaining <= 0) break
              const tick = yield* abortable(sleepMs(Math.min(pollIntervalMs, remaining)), ctx.abort)
              if (tick === "__aborted__") {
                aborted = true
                break
              }
            }

            const elapsed = (Date.now() - start) / 1000
            return done({
              title: matched
                ? `${path.basename(target)} matched /${regex.source}/ after ${elapsed.toFixed(1)}s`
                : cancelledByFile
                  ? `wait cancelled by file after ${elapsed.toFixed(1)}s`
                  : aborted
                    ? `wait cancelled after ${elapsed.toFixed(1)}s`
                    : `wait timed out after ${elapsed.toFixed(1)}s`,
              metadata: {
                mode: "until_text",
                target,
                pattern: regex.source,
                pattern_flags: regex.flags,
                text_tail_bytes: tailBytes,
                seconds: params.seconds,
                elapsed_seconds: elapsed,
                polls: pollCount,
                reason: params.reason,
                matched,
                match: matchText,
                timed_out: !matched && !aborted && !cancelledByFile,
                aborted,
                poll_interval_ms: pollIntervalMs,
                cancel_if_file: cancelTarget,
                cancelled_by_file: cancelledByFile,
              },
              output: matched
                ? `Pattern /${regex.source}/${regex.flags} matched in ${target} after ${elapsed.toFixed(1)}s. First match: ${matchText}. Reason: ${params.reason}`
                : cancelledByFile
                  ? `Wait cancelled after ${elapsed.toFixed(1)}s because sentinel file exists: ${cancelTarget}. Reason: ${params.reason}`
                  : aborted
                    ? `Wait cancelled after ${elapsed.toFixed(1)}s. Reason: ${params.reason}`
                    : `Timed out after ${elapsed.toFixed(1)}s waiting for /${regex.source}/${regex.flags} in ${target}. Reason: ${params.reason}`,
            })
          }

          if (params.until_url) {
            const expectedStatus = params.until_url_status ?? 200
            yield* ctx.metadata({
              title: `wait up to ${params.seconds}s for ${params.until_url}`,
              metadata: {
                mode: "until_url",
                url: params.until_url,
                expected_status: expectedStatus,
                seconds: params.seconds,
                reason: params.reason,
                poll_interval_ms: pollIntervalMs,
                cancel_if_file: cancelTarget,
              },
            })

            let aborted = false
            let cancelledByFile = false
            let pollCount = 0
            let lastStatus: number | undefined
            let lastError: string | undefined
            let lastTitleUpdate = start
            let ready = false

            while (Date.now() < deadline) {
              if (yield* checkCancel()) {
                cancelledByFile = true
                break
              }
              pollCount++

              const probe = yield* Effect.promise(() =>
                probeUrl(params.until_url!, ctx.abort, Math.min(DEFAULT_URL_TIMEOUT_MS, pollIntervalMs * 2)),
              )
              lastStatus = probe.status
              lastError = probe.error

              if (lastStatus !== undefined && lastStatus === expectedStatus) {
                ready = true
                break
              }

              const now = Date.now()
              if (now - lastTitleUpdate >= 1000 && now < deadline) {
                lastTitleUpdate = now
                const left = Math.max(0, Math.ceil((deadline - now) / 1000))
                yield* ctx.metadata({
                  title: `${params.until_url} ${lastStatus ?? "?"} (${left}s left)`,
                  metadata: {
                    mode: "until_url",
                    url: params.until_url,
                    expected_status: expectedStatus,
                    url_status: lastStatus,
                    seconds: params.seconds,
                    reason: params.reason,
                    elapsed_seconds: (now - start) / 1000,
                    remaining_seconds: left,
                    polls: pollCount,
                    poll_interval_ms: pollIntervalMs,
                    cancel_if_file: cancelTarget,
                  },
                })
              }

              const remaining = deadline - Date.now()
              if (remaining <= 0) break
              const tick = yield* abortable(sleepMs(Math.min(pollIntervalMs, remaining)), ctx.abort)
              if (tick === "__aborted__") {
                aborted = true
                break
              }
            }

            const elapsed = (Date.now() - start) / 1000
            const titleSuffix = ready
              ? `${params.until_url} ${lastStatus} ready`
              : cancelledByFile
                ? `wait cancelled by file after ${elapsed.toFixed(1)}s`
                : aborted
                  ? `wait cancelled after ${elapsed.toFixed(1)}s`
                  : `wait timed out after ${elapsed.toFixed(1)}s`
            return done({
              title: titleSuffix,
              metadata: {
                mode: "until_url",
                url: params.until_url,
                expected_status: expectedStatus,
                url_status: lastStatus,
                seconds: params.seconds,
                elapsed_seconds: elapsed,
                polls: pollCount,
                reason: params.reason,
                ready,
                timed_out: !ready && !aborted && !cancelledByFile,
                aborted,
                poll_interval_ms: pollIntervalMs,
                cancel_if_file: cancelTarget,
                cancelled_by_file: cancelledByFile,
              },
              output: ready
                ? `URL ${params.until_url} returned ${lastStatus} after ${elapsed.toFixed(1)}s. Reason: ${params.reason}`
                : cancelledByFile
                  ? `Wait cancelled after ${elapsed.toFixed(1)}s because sentinel file exists: ${cancelTarget}. Last status: ${lastStatus ?? lastError ?? "no response"}. Reason: ${params.reason}`
                  : aborted
                    ? `Wait cancelled after ${elapsed.toFixed(1)}s. Last status: ${lastStatus ?? lastError ?? "no response"}. Reason: ${params.reason}`
                    : `Timed out after ${elapsed.toFixed(1)}s polling ${params.until_url}. Last status: ${lastStatus ?? lastError ?? "no response"} (expected ${expectedStatus}). Reason: ${params.reason}`,
            })
          }

          if (params.until_pid_exit !== undefined) {
            const pid = params.until_pid_exit
            yield* ctx.metadata({
              title: `wait up to ${params.seconds}s for pid ${pid} to exit`,
              metadata: {
                mode: "until_pid_exit",
                pid,
                seconds: params.seconds,
                reason: params.reason,
                poll_interval_ms: pollIntervalMs,
                cancel_if_file: cancelTarget,
              },
            })

            let aborted = false
            let cancelledByFile = false
            let pollCount = 0
            let exited = false
            let lastTitleUpdate = start

            while (Date.now() < deadline) {
              if (yield* checkCancel()) {
                cancelledByFile = true
                break
              }
              pollCount++

              if (!isProcessAlive(pid)) {
                exited = true
                break
              }

              const now = Date.now()
              if (now - lastTitleUpdate >= 1000 && now < deadline) {
                lastTitleUpdate = now
                const left = Math.max(0, Math.ceil((deadline - now) / 1000))
                yield* ctx.metadata({
                  title: `pid ${pid} alive (${left}s left)`,
                  metadata: {
                    mode: "until_pid_exit",
                    pid,
                    seconds: params.seconds,
                    reason: params.reason,
                    elapsed_seconds: (now - start) / 1000,
                    remaining_seconds: left,
                    polls: pollCount,
                    poll_interval_ms: pollIntervalMs,
                    cancel_if_file: cancelTarget,
                  },
                })
              }

              const remaining = deadline - Date.now()
              if (remaining <= 0) break
              const tick = yield* abortable(sleepMs(Math.min(pollIntervalMs, remaining)), ctx.abort)
              if (tick === "__aborted__") {
                aborted = true
                break
              }
            }

            const elapsed = (Date.now() - start) / 1000
            return done({
              title: exited
                ? `pid ${pid} exited after ${elapsed.toFixed(1)}s`
                : cancelledByFile
                  ? `wait cancelled by file after ${elapsed.toFixed(1)}s`
                  : aborted
                    ? `wait cancelled after ${elapsed.toFixed(1)}s`
                    : `pid ${pid} still alive after ${elapsed.toFixed(1)}s (timeout)`,
              metadata: {
                mode: "until_pid_exit",
                pid,
                seconds: params.seconds,
                elapsed_seconds: elapsed,
                polls: pollCount,
                reason: params.reason,
                exited,
                timed_out: !exited && !aborted && !cancelledByFile,
                aborted,
                poll_interval_ms: pollIntervalMs,
                cancel_if_file: cancelTarget,
                cancelled_by_file: cancelledByFile,
              },
              output: exited
                ? `Process ${pid} exited after ${elapsed.toFixed(1)}s. Reason: ${params.reason}`
                : cancelledByFile
                  ? `Wait cancelled after ${elapsed.toFixed(1)}s because sentinel file exists: ${cancelTarget}. Reason: ${params.reason}`
                  : aborted
                    ? `Wait cancelled after ${elapsed.toFixed(1)}s. Reason: ${params.reason}`
                    : `Timed out after ${elapsed.toFixed(1)}s waiting for pid ${pid} to exit. Reason: ${params.reason}`,
            })
          }

          if (!params.until_file) {
            yield* ctx.metadata({
              title: `wait ${params.seconds}s - ${params.reason}`,
              metadata: {
                mode: "fixed",
                seconds: params.seconds,
                reason: params.reason,
                poll_interval_ms: pollIntervalMs,
                cancel_if_file: cancelTarget,
              },
            })

            let aborted = false
            let cancelledByFile = false
            let pollCount = 0
            let lastTitleUpdate = start

            while (Date.now() < deadline) {
              if (yield* checkCancel()) {
                cancelledByFile = true
                break
              }

              const remaining = deadline - Date.now()
              if (remaining <= 0) break

              const result = yield* abortable(sleepMs(Math.min(pollIntervalMs, 1000, remaining)), ctx.abort)
              if (result === "__aborted__") {
                aborted = true
                break
              }
              pollCount++

              const now = Date.now()
              if (now - lastTitleUpdate >= 1000 && now < deadline) {
                lastTitleUpdate = now
                const left = Math.max(0, Math.ceil((deadline - now) / 1000))
                yield* ctx.metadata({
                  title: `wait ${left}s left - ${params.reason}`,
                  metadata: {
                    mode: "fixed",
                    seconds: params.seconds,
                    reason: params.reason,
                    elapsed_seconds: (now - start) / 1000,
                    remaining_seconds: left,
                    polls: pollCount,
                    poll_interval_ms: pollIntervalMs,
                    cancel_if_file: cancelTarget,
                  },
                })
              }
            }

            const elapsed = (Date.now() - start) / 1000
            return done({
              title: cancelledByFile
                ? `wait cancelled by file after ${elapsed.toFixed(1)}s`
                : aborted
                  ? `wait cancelled after ${elapsed.toFixed(1)}s`
                  : `waited ${elapsed.toFixed(1)}s`,
              metadata: {
                mode: "fixed",
                seconds: params.seconds,
                elapsed_seconds: elapsed,
                reason: params.reason,
                aborted,
                polls: pollCount,
                poll_interval_ms: pollIntervalMs,
                cancel_if_file: cancelTarget,
                cancelled_by_file: cancelledByFile,
              },
              output: cancelledByFile
                ? `Wait cancelled after ${elapsed.toFixed(1)}s because sentinel file exists: ${cancelTarget}. Reason: ${params.reason}`
                : aborted
                  ? `Wait cancelled after ${elapsed.toFixed(1)}s. Reason: ${params.reason}`
                  : `Waited ${elapsed.toFixed(1)}s. Reason: ${params.reason}`,
            })
          }

          const target = path.isAbsolute(params.until_file)
            ? params.until_file
            : path.resolve(ins.directory, params.until_file)

          yield* ctx.metadata({
            title: `wait up to ${params.seconds}s for ${path.basename(target)}`,
            metadata: {
              mode: "until_file",
              target,
              seconds: params.seconds,
              reason: params.reason,
              min_size_bytes: params.min_size_bytes,
              poll_interval_ms: pollIntervalMs,
              stable_ms: stableRequiredMs,
              cancel_if_file: cancelTarget,
            },
          })

          let lastSize = -1
          let lastChanged = Date.now()
          let pollCount = 0
          let aborted = false
          let cancelledByFile = false
          let lastTitleSize = -1

          while (Date.now() < deadline) {
            if (yield* checkCancel()) {
              cancelledByFile = true
              break
            }
            pollCount++

            const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (info && info.type === "File") {
              const size = Number(info.size ?? 0)

              // Refresh progress when the file grows by at least 1 MB.
              const sizeDeltaMb = lastTitleSize < 0 ? Infinity : Math.abs(size - lastTitleSize) / 1024 / 1024
              if (sizeDeltaMb >= 1) {
                lastTitleSize = size
                const elapsedNow = (Date.now() - start) / 1000
                const targetSuffix = params.min_size_bytes ? ` / ${mb(params.min_size_bytes)} MB` : ""
                yield* ctx.metadata({
                  title: `${path.basename(target)} ${mb(size)} MB${targetSuffix} (${elapsedNow.toFixed(0)}s)`,
                  metadata: {
                    mode: "until_file",
                    target,
                    seconds: params.seconds,
                    elapsed_seconds: elapsedNow,
                    size_bytes: size,
                    polls: pollCount,
                    reason: params.reason,
                    poll_interval_ms: pollIntervalMs,
                    stable_ms: stableRequiredMs,
                    min_size_bytes: params.min_size_bytes,
                    cancel_if_file: cancelTarget,
                  },
                })
              }

              if (size !== lastSize) {
                lastSize = size
                lastChanged = Date.now()
              }

              const stableFor = Date.now() - lastChanged
              const meetsSize = params.min_size_bytes === undefined || size >= params.min_size_bytes
              if (stableFor >= stableRequiredMs && meetsSize) {
                const elapsed = (Date.now() - start) / 1000
                return done({
                  title: `${path.basename(target)} ready (${mb(size)} MB)`,
                  metadata: {
                    mode: "until_file",
                    target,
                    seconds: params.seconds,
                    elapsed_seconds: elapsed,
                    size_bytes: size,
                    polls: pollCount,
                    reason: params.reason,
                    ready: true,
                    poll_interval_ms: pollIntervalMs,
                    stable_ms: stableRequiredMs,
                    min_size_bytes: params.min_size_bytes,
                    cancel_if_file: cancelTarget,
                  },
                  output: `File ready after ${elapsed.toFixed(1)}s: ${target} (${mb(size)} MB, stable ${(stableFor / 1000).toFixed(0)}s). Reason: ${params.reason}`,
                })
              }
            }

            const remaining = deadline - Date.now()
            if (remaining <= 0) break

            const tick = yield* abortable(sleepMs(Math.min(pollIntervalMs, remaining)), ctx.abort)
            if (tick === "__aborted__") {
              aborted = true
              break
            }
          }

          const elapsed = (Date.now() - start) / 1000
          const lastInfo = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const sizeNow = lastInfo && lastInfo.type === "File" ? Number(lastInfo.size ?? 0) : 0
          const reachedMin = params.min_size_bytes === undefined || sizeNow >= params.min_size_bytes
          return done({
            title: cancelledByFile
              ? `wait cancelled by file after ${elapsed.toFixed(1)}s`
              : aborted
                ? `wait cancelled after ${elapsed.toFixed(1)}s`
                : `wait timed out after ${elapsed.toFixed(1)}s`,
            metadata: {
              mode: "until_file",
              target,
              seconds: params.seconds,
              elapsed_seconds: elapsed,
              size_bytes: sizeNow,
              polls: pollCount,
              reason: params.reason,
              timed_out: !aborted && !cancelledByFile,
              aborted,
              reached_min_size: reachedMin,
              poll_interval_ms: pollIntervalMs,
              stable_ms: stableRequiredMs,
              min_size_bytes: params.min_size_bytes,
              cancel_if_file: cancelTarget,
              cancelled_by_file: cancelledByFile,
            },
            output: cancelledByFile
              ? `Wait cancelled after ${elapsed.toFixed(1)}s because sentinel file exists: ${cancelTarget}. Last size: ${mb(sizeNow)} MB. Reason: ${params.reason}`
              : aborted
                ? `Wait cancelled after ${elapsed.toFixed(1)}s. Last size: ${mb(sizeNow)} MB. Reason: ${params.reason}`
                : `Timed out after ${elapsed.toFixed(1)}s waiting for ${target}. Last observed size: ${mb(sizeNow)} MB${params.min_size_bytes ? ` (min required: ${mb(params.min_size_bytes)} MB, reached: ${reachedMin})` : ""}. Reason: ${params.reason}`,
          })
        }),
    }
  }),
)
