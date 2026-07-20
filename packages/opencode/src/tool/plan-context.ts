import { Effect } from "effect"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { isOverflow } from "@/session/overflow"

export function tokenCount(tokens: SessionV1.Assistant["tokens"]) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function estimateContext(input: {
  cfg: ConfigV1.Info
  model: Provider.Model
  tokens: SessionV1.Assistant["tokens"]
}) {
  if (input.model.limit.context === 0) return undefined

  const count = tokenCount(input.tokens)
  if (count === 0) return undefined

  const context = input.model.limit.input || input.model.limit.context
  if (context === 0) return undefined

  return {
    percent: Math.round((count / context) * 100),
    recommended: isOverflow({ cfg: input.cfg, tokens: input.tokens, model: input.model }),
  }
}

export function resolveBuildModel(input: {
  agent?: Pick<Agent.Info, "model">
  provider: Pick<Provider.Interface, "defaultModel" | "getModel">
}) {
  return Effect.gen(function* () {
    const selected =
      input.agent?.model ?? (yield* input.provider.defaultModel().pipe(Effect.catch(() => Effect.succeed(undefined))))
    if (!selected) return undefined

    return yield* input.provider
      .getModel(selected.providerID, selected.modelID)
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
  })
}
