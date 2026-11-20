export * as ClaudeAccounts from "./accounts.js"

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { Effect, Option, Schema } from "effect"
import { ClaudeAgentError } from "../language-model/claude-agent-error.js"
import type { ClaudeSessions } from "./sessions.js"

export interface Storage {
  readonly get: (key: string) => Effect.Effect<unknown>
  readonly set: (key: string, value: string) => Effect.Effect<void>
}

export interface Interface {
  readonly run: (request: ClaudeSessions.Request, configDirs: readonly string[]) => Effect.Effect<void, Error>
}

const LAST = "last-account"

export function make(input: { readonly sessions: ClaudeSessions.Interface; readonly storage: Storage }) {
  const read = Effect.fn("ClaudeAccounts.read")(function* (key: string) {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(yield* input.storage.get(key)))
  })

  const run = Effect.fn("ClaudeAccounts.run")(function* (
    request: ClaudeSessions.Request,
    configDirs: readonly string[],
  ) {
    const connection = request.connection
    // An API key or token logs in the same way whatever the folder, so those requests never rotate.
    if (configDirs.length < 2 || connection?.ANTHROPIC_API_KEY || connection?.ANTHROPIC_AUTH_TOKEN) {
      return yield* input.sessions.run(request)
    }
    const own = request.sessionID ? yield* read(`accounts/${request.sessionID}`) : undefined
    const last = yield* read(LAST)
    // Side calls and new forks start on their parent chat's account, which has its transcript and prompt cache.
    const parent = !own && request.sourceID ? yield* read(`accounts/${request.sourceID}`) : undefined
    const from = own ?? parent ?? last
    const start = from ? Math.max(0, configDirs.indexOf(from)) : 0
    const dirs = [...configDirs.slice(start), ...configDirs.slice(0, start)]
    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i]
      const attempt = watch(request.emit)
      yield* input.sessions.run({
        ...request,
        connection: { ...connection, CLAUDE_CONFIG_DIR: dir },
        emit: attempt.emit,
      })
      const error = attempt.error()
      if (!error) {
        // A side call never moves its chat, because the side call's model may have hit a limit of its own.
        if (request.sessionID && dir !== own) yield* input.storage.set(`accounts/${request.sessionID}`, dir)
        if (dir !== last) yield* input.storage.set(LAST, dir)
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
