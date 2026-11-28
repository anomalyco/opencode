export * as ClaudeWebSearchProvider from "./websearch.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Stream } from "effect"
import { Credential } from "../../../credential.js"
import { ClaudeAccounts } from "./claude/accounts.js"
import type { ClaudeIO } from "./claude/io.js"
import { ClaudeQueryOptions } from "./claude/query-options.js"
import { ClaudeWebSearch } from "./claude/websearch.js"
import { ClaudeProvider } from "./provider.js"

// Never made the default: users pick it in their config
export const register = Effect.fn("ClaudeWebSearchProvider.register")(function* (ctx: Context, io: ClaudeIO.Interface) {
  const credentials = yield* Credential.Service
  const state = { connected: (yield* ctx.integration.connection.active(ClaudeProvider.ID)) !== undefined }

  yield* ctx.websearch.transform((editor) => {
    if (!state.connected) return
    editor.add({
      id: ClaudeProvider.ID,
      name: "Claude Agent",
      execute: (input) => search(ctx, io, input.query).pipe(Effect.provideService(Credential.Service, credentials)),
    })
  })

  yield* ctx.event.subscribe({ types: ["credential.switched"] }).pipe(
    Stream.filter((event) => String(event.data.integrationID) === ClaudeProvider.ID),
    Stream.runForEach(() =>
      Effect.gen(function* () {
        state.connected = (yield* ctx.integration.connection.active(ClaudeProvider.ID)) !== undefined
        yield* ctx.websearch.reload()
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
})

const search = Effect.fn("ClaudeWebSearchProvider.search")(function* (
  ctx: Context,
  io: ClaudeIO.Interface,
  query: string,
) {
  const executable = io.which()
  if (!executable) return yield* Effect.fail(new Error("Install Claude Code and run `claude auth login` first"))
  const provider = Option.getOrUndefined(yield* ctx.provider.get({ providerID: ClaudeProvider.ID }).pipe(Effect.option))
  // Includes the active account's folder when no `settings.configDir` is set, so a search runs on the chats' account
  const connection = yield* ClaudeProvider.connection(ctx)
  // Chats move to the next account folder when a plan limit refuses them, and the search follows them there
  const last = yield* ctx.storage.get(ClaudeAccounts.LAST)
  const dir = ClaudeQueryOptions.configDirs(provider?.data.settings?.configDir).find((dir) => dir === last)
  return yield* ClaudeWebSearch.search({
    executable,
    io,
    connection: ClaudeQueryOptions.withoutDefaultFolder(
      dir ? { ...connection, CLAUDE_CONFIG_DIR: dir } : connection,
      io,
    ),
    query,
  })
})
