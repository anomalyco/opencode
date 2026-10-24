export * as ClaudeSessionHooks from "./session.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { RequestKind } from "../language-model/request-kind.js"
import { ClaudeProvider } from "./provider.js"

// OpenCode records stopped tools (including a plain permission rejection) with this structured error.
const isAborted = Schema.is(Schema.Struct({ error: Schema.Struct({ type: Schema.Literal("aborted") }) }))

export const register = Effect.fn("ClaudeSessionHooks.register")(function* (ctx: Context) {
  yield* ctx.session.hook(
    "model.request",
    (event) =>
      Effect.gen(function* () {
        event.headers[RequestKind.HEADER] = event.kind
        if (event.kind !== "primary") return
        const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie)
        if (session.fork) event.headers[RequestKind.FORK_HEADER] = session.fork.sessionID
      }),
    { providerID: ClaudeProvider.ID },
  )
  yield* ctx.session.hook(
    "context",
    (event) =>
      Effect.sync(() => {
        // Let Claude choose its normal output budget. Later hooks can still set an explicit maxTokens.
        // Compaction has its own hook, so it keeps OpenCode's summary budget.
        delete event.options.maxTokens
        // Preserve tool error status before the AI SDK bridge flattens error results to plain text.
        event.messages.forEach((message, index) => {
          const content = message.content.map((part) => {
            if (part.type !== "tool-result" || part.result.type !== "error") return part
            const flags = {
              ...part.providerMetadata?.[ClaudeProvider.ID],
              toolError: true,
              toolAborted: isAborted(part.result.value),
            }
            return { ...part, providerMetadata: { ...part.providerMetadata, [ClaudeProvider.ID]: flags } }
          })
          event.messages[index] = { ...message, content }
        })
      }),
    { providerID: ClaudeProvider.ID },
  )
  // Claude Code already retries API failures. Replaying the whole turn here also retries permanent billing errors.
  yield* ctx.session.hook(
    "retry",
    (event) =>
      Effect.sync(() => {
        event.decision = { retry: false }
      }),
    { providerID: ClaudeProvider.ID },
  )
})
