export * as ClaudeProvider from "./provider.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema, Stream, SubscriptionRef } from "effect"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { ClaudeProbe } from "../claude/probe.js"
import type { ClaudeStatus } from "../claude/status.js"

export const ID = Provider.ID.claudeAgent
export const PACKAGE = "@opencode/claude-agent"

// The model list we keep between starts, so opencode can list models without running `claude`
const CatalogModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  efforts: Schema.Array(Schema.String),
  contextWindow: Schema.optionalKey(Schema.Number),
})
type CatalogModel = typeof CatalogModel.Type
const Catalog = Schema.Array(CatalogModel)
const CATALOG_KEY = "models"

export const register = Effect.fn("ClaudeProvider.register")(function* (ctx: Context, status: ClaudeStatus.Interface) {
  const saved = Schema.decodeUnknownOption(Catalog)(yield* ctx.storage.get(CATALOG_KEY))
  const current = { catalog: Option.getOrElse(saved, (): readonly CatalogModel[] => []) }

  yield* ctx.provider.transform((editor) => {
    editor.add({
      info: {
        id: ID,
        name: "Claude Agent",
        activation: "auto",
        package: Provider.aisdk(PACKAGE),
      },
      models: current.catalog.map(toModel),
    })
  })

  yield* SubscriptionRef.changes(status.state).pipe(
    Stream.runForEach((state) =>
      Effect.gen(function* () {
        if (state.type !== "ready") return
        const next = fromClaude(state.probe.models, current.catalog)
        if (JSON.stringify(next) === JSON.stringify(current.catalog)) return
        current.catalog = next
        yield* ctx.storage.set(CATALOG_KEY, current.catalog)
        yield* ctx.provider.reload()
      }),
    ),
    Effect.forkScoped,
  )

  // Without a saved list there is no model to pick, so the first message that would fill it can never be sent.
  if (current.catalog.length === 0 && (yield* ctx.integration.connection.active(ID))) {
    yield* status.refresh().pipe(Effect.forkScoped)
  }
})

// Context windows only come from the full check, so a chat's startup report keeps the saved ones.
function fromClaude(models: readonly ClaudeProbe.Model[], saved: readonly CatalogModel[]): CatalogModel[] {
  const known = new Map<string, number | undefined>()
  for (const model of saved) known.set(model.id, model.contextWindow)
  const result: CatalogModel[] = []
  for (const model of models) {
    // "default" follows Claude Code's own default, which can change under a running opencode session
    if (model.value === "default") continue
    result.push({
      id: model.value,
      name: model.displayName,
      efforts: model.supportedEffortLevels ?? [],
      contextWindow: model.contextWindow ?? known.get(model.value),
    })
  }
  return result
}

function toModel(model: CatalogModel): Model.Info {
  const defaults = Model.Info.default(ID, Model.ID.make(model.id))
  return {
    ...defaults,
    name: model.name,
    // The SDK reports context windows before a prompt, but not output limits. 0 means unknown in OpenCode.
    limit: { context: model.contextWindow ?? defaults.limit.context, output: 0 },
    // OpenCode picks the title model by family (Model.small).
    family: model.id.includes("haiku") ? Model.Family.make("claude-haiku") : undefined,
    capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
    variants: model.efforts.map((effort) => ({ id: Model.VariantID.make(effort), settings: { effort } })),
    // Covered by the subscription
    cost: [],
  }
}
