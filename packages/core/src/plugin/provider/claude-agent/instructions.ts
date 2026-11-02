export * as ClaudeInstructions from "./instructions.js"

import type { SystemPart } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema } from "effect"
import { ClaudeSystemPrompt } from "./language-model/system-prompt.js"
import { ClaudeProvider } from "./provider.js"

const KINDS = ["context", "generate", "compaction"] as const

const InstructionsMetadata = Schema.Struct({
  experimental: Schema.Struct({
    instructions: Schema.Array(Schema.Struct({ key: Schema.String, text: Schema.String })),
  }),
})

// Claude Code writes its own date and environment, so OpenCode's would repeat them.
const SUPPLIED_BY_CLAUDE = new Set(["core/date", "core/environment"])

export const register = Effect.fn("ClaudeInstructions.register")(function* (ctx: Context) {
  yield* Effect.forEach(
    KINDS,
    (kind) =>
      ctx.session.hook(
        kind,
        (event) =>
          Effect.gen(function* () {
            const agent = yield* ctx.agent.get({ agentID: event.agent }).pipe(Effect.orDie)
            // Read the role from the resolved agent, not by guessing which prompt text is a built-in.
            event.options[ClaudeSystemPrompt.AGENT_OPTION] = agent.data.system ?? ""
            // Built-in providers register before user plugins, so `event.system` still grows after this hook
            // returns. Read it when the request is built instead of folding it into a string here. A plugin that
            // assigns the option itself still wins: the setter replaces the accessor with a plain value.
            const option = ClaudeSystemPrompt.INSTRUCTIONS_OPTION
            Object.defineProperty(event.options, option, {
              enumerable: true,
              configurable: true,
              get: () => instructions(event.system),
              set: (value: unknown) =>
                Object.defineProperty(event.options, option, {
                  value,
                  enumerable: true,
                  configurable: true,
                  writable: true,
                }),
            })
          }),
        { providerID: ClaudeProvider.ID },
      ),
    { discard: true },
  )
})

// The first part is OpenCode's own prompt, which Claude Code's prompt replaces.
function instructions(system: ReadonlyArray<SystemPart>) {
  const texts: string[] = []
  for (const part of system.slice(1)) {
    const metadata = Schema.decodeUnknownOption(InstructionsMetadata)(part.metadata)
    if (Option.isNone(metadata)) {
      texts.push(part.text)
      continue
    }
    for (const source of metadata.value.experimental.instructions) {
      if (SUPPLIED_BY_CLAUDE.has(source.key)) continue
      texts.push(source.text)
    }
  }
  return texts.join("\n\n")
}
