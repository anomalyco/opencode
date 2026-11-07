export * as TestSessions from "./sessions"

import type { LanguageModelV3Prompt, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { SessionRequestKind } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import { ClaudeAccounts } from "@opencode/core/plugin/provider/claude-agent/claude/accounts"
import { ClaudeQueryOptions } from "@opencode/core/plugin/provider/claude-agent/claude/query-options"
import { ClaudeSessions } from "@opencode/core/plugin/provider/claude-agent/claude/sessions"
import { ClaudeStatus } from "@opencode/core/plugin/provider/claude-agent/claude/status"
import { ClaudeAgentLanguageModel } from "@opencode/core/plugin/provider/claude-agent/language-model/claude-agent-language-model"
import { RequestKind } from "@opencode/core/plugin/provider/claude-agent/language-model/request-kind"
import type { SessionRecord } from "@opencode/core/plugin/provider/claude-agent/sync/record"
import { FakeClaude } from "./fake-claude"
import { FakeIO } from "./fake-io"

export function storage() {
  const data = new Map<string, unknown>()
  return {
    data,
    get: (key: string) => Effect.sync(() => data.get(key)),
    set: (key: string, value: SessionRecord.Record | string) =>
      Effect.sync(() => {
        data.set(key, value)
      }),
  }
}

export function prompt(text: string): LanguageModelV3Prompt {
  return [
    { role: "system", content: "You are a concise test assistant." },
    { role: "user", content: [{ type: "text", text }] },
  ]
}

export function followup(text = "What was the marker? Reply only with it."): LanguageModelV3Prompt {
  return [
    ...prompt("Remember the marker COPPER-OTTER. Reply only with that marker."),
    { role: "assistant", content: [{ type: "text", text: "COPPER-OTTER" }] },
    { role: "user", content: [{ type: "text", text }] },
  ]
}

// `settings` are the provider settings from opencode.json, such as `configDir`.
export const model = (sessions: ClaudeSessions.Interface, settings?: Record<string, unknown>) =>
  build((request) => sessions.run(request), settings)

export const rotating = (accounts: ClaudeAccounts.Interface, settings?: Record<string, unknown>) => {
  const configDirs = ClaudeQueryOptions.configDirs(settings?.configDir)
  return build((request) => accounts.run(request, configDirs), settings)
}

const build = Effect.fn(function* (
  run: (request: ClaudeSessions.Request) => Effect.Effect<void, Error>,
  settings?: Record<string, unknown>,
) {
  const context = yield* Effect.context<never>()
  return new ClaudeAgentLanguageModel.Model(
    "haiku",
    { run: (request, signal) => Effect.runPromiseWith(context)(run(request), { signal }) },
    ClaudeQueryOptions.connectionEnv({ settings }),
  )
})

export const start = Effect.fn(function* (
  claude: FakeClaude.Fake,
  saved = storage(),
  settings?: Record<string, unknown>,
) {
  const registry = ClaudeSessions.registry()
  yield* Effect.addFinalizer(() => registry.close())
  const io = FakeIO.make({ claude })
  const input = {
    io,
    status: yield* ClaudeStatus.make(io, () => Effect.succeed({})),
    storage: saved,
    directory: "/tmp/opencode",
  }
  const sessions = yield* registry.attach(input)
  const accounts = ClaudeAccounts.make({ sessions, storage: saved })
  return { registry, input, sessions, accounts, model: yield* rotating(accounts, settings), storage: saved }
})

export function stream(
  model: ClaudeAgentLanguageModel.Model,
  prompt: LanguageModelV3Prompt,
  sessionID = "session-a",
  kind: SessionRequestKind = "primary",
) {
  return Effect.promise(() =>
    model.doStream({ prompt, headers: { [RequestKind.SESSION_HEADER]: sessionID, [RequestKind.HEADER]: kind } }),
  )
}

export async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of stream) parts.push(part)
  return parts
}

export function text(parts: readonly LanguageModelV3StreamPart[]) {
  return parts
    .filter((part) => part.type === "text-delta")
    .map((part) => part.delta)
    .join("")
}

export const reply = Effect.fn(function* (
  model: ClaudeAgentLanguageModel.Model,
  prompt: LanguageModelV3Prompt,
  sessionID = "session-a",
  kind: SessionRequestKind = "primary",
) {
  const result = yield* stream(model, prompt, sessionID, kind)
  return yield* Effect.tryPromise(() => collect(result.stream))
})
