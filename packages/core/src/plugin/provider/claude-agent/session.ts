export * as ClaudeSessionHooks from "./session.js"

import { AssistantMessage, ToolMessage, type ToolResultPart } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { SessionModelRequest } from "../../../session/model-request.js"
import type { ClaudeIO } from "./claude/io.js"
import type { ClaudeStatus } from "./claude/status.js"
import { RequestKind } from "./language-model/request-kind.js"
import { ClaudeProvider } from "./provider.js"

// OpenCode records stopped tools (including a plain permission rejection) with this structured error.
const isAborted = Schema.is(Schema.Struct({ error: Schema.Struct({ type: Schema.Literal("aborted") }) }))

const flagToolError = (part: ToolResultPart): ToolResultPart => {
  if (part.result.type !== "error") return part
  const flags = {
    ...part.providerMetadata?.[ClaudeProvider.ID],
    toolError: true,
    toolAborted: isAborted(part.result.value),
  }
  return { ...part, providerMetadata: { ...part.providerMetadata, [ClaudeProvider.ID]: flags } }
}

// Decided once per session and saved: a session whose budget changed would cut its images differently, and Claude Code
// would fork it and replay the history. A fork shares its source's Claude history, so it keeps the source's budget.
const largeImages: (
  ctx: Context,
  status: ClaudeStatus.Interface,
  io: ClaudeIO.Interface,
  sessionID: Session.ID,
) => Effect.Effect<boolean> = Effect.fn("ClaudeSessionHooks.largeImages")(function* (ctx, status, io, sessionID) {
  const key = `images/${sessionID}`
  const saved = yield* ctx.storage.get(key)
  if (typeof saved === "boolean") return saved
  const session = yield* ctx.session.get({ sessionID }).pipe(Effect.orDie)
  const large = session.fork
    ? yield* largeImages(ctx, status, io, session.fork.sessionID)
    : yield* ClaudeProvider.firstParty(ctx, status, io)
  yield* ctx.storage.set(key, large)
  return large
})

export const register = Effect.fn("ClaudeSessionHooks.register")(function* (
  ctx: Context,
  status: ClaudeStatus.Interface,
  io: ClaudeIO.Interface,
) {
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
        event.messages = event.messages.map((message) => {
          if (message.role === "tool")
            return new ToolMessage({ ...message, content: message.content.map(flagToolError) })
          if (message.role !== "assistant") return message
          const content = message.content.map((part) => (part.type === "tool-result" ? flagToolError(part) : part))
          return new AssistantMessage({ ...message, content })
        })
      }),
    { providerID: ClaudeProvider.ID },
  )
  // OpenCode lets Claude Agent's images grow past the default budget, up to what Anthropic's own API accepts. Other
  // backends (Bedrock, Vertex, Foundry, gateways) take 20-32 MB, so they keep the default.
  yield* Effect.forEach(
    ["context", "generate", "compaction", "title"] as const,
    (kind) =>
      ctx.session.hook(
        kind,
        (event) =>
          Effect.gen(function* () {
            const bounded = SessionModelRequest.boundImages(event.messages)
            // Within the default budget both budgets send the same, so there is nothing to decide yet.
            if (bounded === event.messages) return
            if (yield* largeImages(ctx, status, io, event.sessionID)) return
            event.messages = [...bounded]
          }),
        { providerID: ClaudeProvider.ID },
      ),
    { discard: true },
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
