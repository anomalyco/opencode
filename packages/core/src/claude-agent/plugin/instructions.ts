export * as ClaudeInstructions from "./instructions.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { ClaudeSystemPrompt } from "../language-model/system-prompt.js"
import { ClaudeProvider } from "./provider.js"

const KINDS = ["context", "generate", "compaction"] as const

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
          }),
        { providerID: ClaudeProvider.ID },
      ),
    { discard: true },
  )
})
