export * as ClaudeProvider from "./provider.js"

import type { AccountInfo } from "@anthropic-ai/claude-agent-sdk"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema, Stream, SubscriptionRef } from "effect"
import { Model } from "../../../model.js"
import { Provider } from "../../../provider.js"
import type { ClaudeIO } from "./claude/io.js"
import type { ClaudeProbe } from "./claude/probe.js"
import { ClaudeQueryOptions } from "./claude/query-options.js"
import type { ClaudeStatus } from "./claude/status.js"

export const ID = Provider.ID.claudeAgent
export const PACKAGE = "@opencode/claude-agent"

// The model list we keep between starts, so opencode can list models without running `claude`
const CatalogModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  efforts: Schema.Array(Schema.String),
  contextWindow: Schema.optionalKey(Schema.Number),
  resolvedModel: Schema.optionalKey(Schema.String),
})
type CatalogModel = typeof CatalogModel.Type
const Catalog = Schema.Struct({
  priceSource: Schema.optionalKey(Provider.ID),
  models: Schema.Array(CatalogModel),
})
type Catalog = typeof Catalog.Type
const CATALOG_KEY = "models"

// Mantle is Bedrock serving Anthropic's API, and opencode drops most of its `anthropic.…` IDs from Bedrock's list,
// so it uses Anthropic's prices.
const PRICE_SOURCES: Partial<Record<NonNullable<AccountInfo["apiProvider"]>, Provider.ID>> = {
  firstParty: Provider.ID.anthropic,
  anthropicAws: Provider.ID.anthropic,
  anthropicGoogleCloud: Provider.ID.anthropic,
  mantle: Provider.ID.anthropic,
  bedrock: Provider.ID.amazonBedrock,
  vertex: Provider.ID.googleVertex,
  foundry: Provider.ID.azure,
}

export const register = Effect.fn("ClaudeProvider.register")(function* (
  ctx: Context,
  status: ClaudeStatus.Interface,
  io: ClaudeIO.Interface,
) {
  const saved = Schema.decodeUnknownOption(Catalog)(yield* ctx.storage.get(CATALOG_KEY))
  const current = { catalog: Option.getOrElse(saved, (): Catalog => ({ models: [] })) }

  yield* ctx.provider.transform((editor) => {
    const source = current.catalog.priceSource
    const prices = source ? editor.get(source)?.models : undefined
    editor.add({
      info: {
        id: ID,
        name: "Claude Agent",
        activation: "auto",
        package: Provider.aisdk(PACKAGE),
      },
      models: current.catalog.models.map((model) => toModel(model, prices)),
    })
  })

  yield* SubscriptionRef.changes(status.state).pipe(
    Stream.runForEach((state) =>
      Effect.gen(function* () {
        if (state.type !== "ready") return
        const baseURL = (yield* connection(ctx)).ANTHROPIC_BASE_URL ?? io.env().ANTHROPIC_BASE_URL
        const next = {
          priceSource: priceSource(state.probe.account, baseURL),
          models: fromClaude(state.probe.models, current.catalog.models),
        }
        if (JSON.stringify(next) === JSON.stringify(current.catalog)) return
        current.catalog = next
        yield* ctx.storage.set(CATALOG_KEY, current.catalog)
        yield* ctx.provider.reload()
      }),
    ),
    Effect.forkScoped,
  )

  // Without a saved list there is no model to pick, so the first message that would fill it can never be sent.
  if (current.catalog.models.length === 0 && (yield* ctx.integration.connection.active(ID))) {
    yield* status.refresh().pipe(Effect.forkScoped)
  }
})

export const connection = Effect.fn("ClaudeProvider.connection")(function* (ctx: Context) {
  const provider = yield* ctx.provider.get({ providerID: ID }).pipe(Effect.option)
  if (Option.isNone(provider)) return {}
  const info = provider.value.data
  return ClaudeQueryOptions.connectionEnv({ settings: info.settings, headers: info.headers, body: info.body })
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
      resolvedModel: model.resolvedModel,
    })
  }
  return result
}

// A subscription covers usage, and a custom base URL or an enterprise gateway can bill anything, so they show no cost.
function priceSource(account: AccountInfo, baseURL: string | undefined) {
  if (baseURL) return
  if (account.apiProvider === undefined) return
  if (account.apiProvider === "firstParty" && account.apiKeySource === undefined) return
  return PRICE_SOURCES[account.apiProvider]
}

function toModel(model: CatalogModel, prices: ReadonlyMap<string, Model.Info> | undefined): Model.Info {
  const defaults = Model.Info.default(ID, Model.ID.make(model.id))
  // The 1M context version's price tiers are on the base model
  const id = (model.resolvedModel ?? model.id).replace(/\[1m\]$/, "")
  // Mantle names models `anthropic.claude-…`, and Vertex lists current models as `claude-…@default`
  const priced = prices?.get(id) ?? prices?.get(id.replace(/^anthropic\./, "")) ?? prices?.get(`${id}@default`)
  return {
    ...defaults,
    name: model.name,
    // The SDK reports context windows before a prompt, but not output limits. 0 means unknown in OpenCode.
    limit: { context: model.contextWindow ?? defaults.limit.context, output: 0 },
    // OpenCode picks the title model by family (Model.small).
    family: model.id.includes("haiku") ? Model.Family.make("claude-haiku") : undefined,
    capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
    variants: model.efforts.map((effort) => ({ id: Model.VariantID.make(effort), settings: { effort } })),
    cost: priced?.cost ?? [],
  }
}
