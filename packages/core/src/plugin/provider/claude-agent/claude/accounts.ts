export * as ClaudeAccounts from "./accounts.js"

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { Clock, Effect, Option, Schema } from "effect"
import { ClaudeAgentError } from "../language-model/claude-agent-error.js"
import type { ClaudeQueryOptions } from "./query-options.js"
import type { ClaudeSessions } from "./sessions.js"

export interface Storage {
  readonly get: (key: string) => Effect.Effect<unknown>
  readonly set: (key: string, value: string | number) => Effect.Effect<void>
}

export interface Interface {
  readonly run: (
    request: ClaudeSessions.Request,
    configDirs: readonly string[],
    strategy: ClaudeQueryOptions.Strategy,
  ) => Effect.Effect<void, Error>
}

export function make(input: { readonly sessions: ClaudeSessions.Interface; readonly storage: Storage }) {
  const read = Effect.fn("ClaudeAccounts.read")(function* (key: string) {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(yield* input.storage.get(key)))
  })
  const readTime = Effect.fn("ClaudeAccounts.readTime")(function* (key: string) {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Number)(yield* input.storage.get(key)))
  })

  const run = Effect.fn("ClaudeAccounts.run")(function* (
    request: ClaudeSessions.Request,
    configDirs: readonly string[],
    strategy: ClaudeQueryOptions.Strategy,
  ) {
    const connection = request.connection
    // An API key or token logs in the same way whatever the folder, so those requests never rotate.
    if (configDirs.length < 2 || connection?.ANTHROPIC_API_KEY || connection?.ANTHROPIC_AUTH_TOKEN) {
      return yield* input.sessions.run(request)
    }
    const saved = request.sessionID ? yield* read(`accounts/${request.sessionID}`) : undefined
    // A strict chat always starts from the top of the list, so it returns to the first account once that resets.
    const own = strategy === "ordered-strict" ? undefined : saved
    // Side calls and new forks start on their parent chat's account, which has its transcript and prompt cache.
    const parent = !own && request.sourceID ? yield* read(`accounts/${request.sourceID}`) : undefined
    // Each list of accounts takes its own turns, so models with different lists do not disturb each other.
    const turn = `round-robin/${configDirs.join("\n")}`
    const fresh = strategy === "round-robin" && request.sessionID !== undefined && !own && !parent
    const previous = fresh ? yield* read(turn) : undefined
    const next = previous ? (configDirs.indexOf(previous) + 1) % configDirs.length : 0
    const from = own ?? parent
    const start = from ? Math.max(0, configDirs.indexOf(from)) : next
    const rotated = [...configDirs.slice(start), ...configDirs.slice(0, start)]
    const now = yield* Clock.currentTimeMillis
    const limits = yield* Effect.forEach(rotated, (dir) => readTime(`limited/${dir}`))
    const open = rotated.filter((_, i) => now >= (limits[i] ?? 0))
    // With every account limited, still ask Claude, so the chat shows its real error.
    const dirs = open.length > 0 ? open : rotated
    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i]
      const attempt = watch(request.emit)
      yield* input.sessions.run({
        ...request,
        connection: { ...connection, CLAUDE_CONFIG_DIR: dir },
        emit: attempt.emit,
      })
      const error = attempt.error()
      if (error?.limited && error.resetsAt) yield* input.storage.set(`limited/${dir}`, error.resetsAt)
      if (!error) {
        // A side call never moves its chat, because the side call's model may have hit a limit of its own.
        if (request.sessionID && dir !== saved) yield* input.storage.set(`accounts/${request.sessionID}`, dir)
        if (fresh) yield* input.storage.set(turn, dir)
        attempt.flush()
        return
      }
      // Only a limit is worth another account. A retry after Claude has shown output would repeat that output.
      if (!error.limited || attempt.shown() || i === dirs.length - 1) {
        attempt.flush()
        return
      }
      yield* Effect.logInfo("Claude account refused the request, retrying on the next one", {
        from: dir,
        to: dirs[i + 1],
      })
    }
  })

  return { run } satisfies Interface
}

function watch(emit: (message: SDKMessage) => void) {
  const failure = ClaudeAgentError.make()
  let held: SDKMessage[] | undefined = []
  let error: ClaudeAgentError.Failure | undefined

  const flush = () => {
    if (!held) return
    const messages = held
    held = undefined
    for (const message of messages) emit(message)
  }

  return {
    emit(message: SDKMessage) {
      const failed = failure(message)
      if (failed) error = failed
      if (!held) {
        emit(message)
        return
      }
      const visible = message.type === "stream_event" || (message.type === "assistant" && !message.error)
      if (!visible) {
        held.push(message)
        return
      }
      flush()
      emit(message)
    },
    flush,
    shown: () => held === undefined,
    error: () => error,
  }
}
