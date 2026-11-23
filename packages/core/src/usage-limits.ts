export * as UsageLimits from "./usage-limits.js"

import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { UsageLimits } from "@opencode/schema/usage-limits"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Context, Duration, Effect, Layer, Result, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ConsoleAccess } from "./console-access.js"
import { Flag } from "./flag.js"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"

export const Info = UsageLimits.Info
export type Info = UsageLimits.Info

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("UsageLimits.UnavailableError", {
  message: Schema.String,
}) {}

export interface Interface {
  /** Usage reported by the location's connected subscription providers. */
  readonly get: () => Effect.Effect<Info | undefined, UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UsageLimits") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const integrations = yield* Integration.Service
    const http = yield* HttpClient.HttpClient
    const flags = yield* Flag.Service
    const credentials = yield* Credential.Service

    const get = Effect.fn("UsageLimits.get")(function* () {
      const [workspace, subscription] = yield* Effect.all(
        [
          readSource(readConsole(integrations, http)),
          readSource(
            flags
              .enabled("openai_usage")
              .pipe(
                Effect.flatMap((enabled) =>
                  enabled ? readOpenAI(integrations, credentials, http) : Effect.succeed(undefined),
                ),
              ),
          ),
        ],
        { concurrency: 2 },
      )
      const console = Result.isSuccess(workspace) ? workspace.success : undefined
      const openai = Result.isSuccess(subscription) ? subscription.success : undefined
      if (!console && !openai) {
        if (Result.isFailure(workspace)) return yield* workspace.failure
        if (Result.isFailure(subscription)) return yield* subscription.failure
        return undefined
      }
      return {
        ...(console ? { workspace: console.workspace } : {}),
        ...(Result.isFailure(workspace)
          ? { unavailable: [Provider.ID.opencode] }
          : Result.isFailure(subscription)
            ? { unavailable: [Provider.ID.openai] }
            : {}),
        allowances: [...(console?.allowances ?? []), ...(openai ? [openai] : [])],
        budgets: console?.budgets ?? [],
      }
    })

    return Service.of({ get })
  }),
)

function readSource<A>(read: Effect.Effect<A, UnavailableError>) {
  return read.pipe(
    Effect.timeoutOrElse({
      // Return partial results before the dialog's 15-second load deadline.
      duration: Duration.seconds(10),
      orElse: () => Effect.fail(new UnavailableError({ message: "Provider usage limits timed out" })),
    }),
    Effect.result,
  )
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Integration.node, Credential.node, Flag.node, httpClient],
})

// One budget as `GET /api/policies/current-budgets` describes it.
const ConsoleBudget = Schema.Struct({
  ruleID: Schema.String,
  limitDollars: Schema.Finite,
  spentDollars: Schema.Finite,
  scope: UsageLimits.Budget.fields.scope,
  per: UsageLimits.Budget.fields.per,
  coverage: UsageLimits.Budget.fields.coverage,
  models: Schema.Array(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
      name: Schema.String,
      spentDollars: Schema.optional(Schema.Finite),
    }),
  ),
  vendors: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  inputPriceAtLeast: Schema.optional(Schema.Finite),
  picked: Schema.Boolean,
  shared: Schema.Boolean,
  resetsAt: Schema.DateFromString,
})

const GoMeter = Schema.Struct({
  status: Schema.Literals(["ok", "rate-limited"]),
  percent: UsageLimits.Window.fields.percent,
  resetsAt: Schema.DateFromString,
})
const GoUsage = Schema.Struct({ usage: Schema.Struct({ rolling: GoMeter, weekly: GoMeter, monthly: GoMeter }) })
const OpenAIWindow = Schema.Struct({
  used_percent: UsageLimits.Window.fields.percent,
  limit_window_seconds: Schema.Finite,
  reset_at: Schema.Finite,
})
const OpenAIRateLimit = Schema.Struct({
  primary_window: Schema.optional(Schema.NullOr(OpenAIWindow)),
  secondary_window: Schema.optional(Schema.NullOr(OpenAIWindow)),
})
const OpenAIAdditionalRateLimit = Schema.Struct({
  limit_name: Schema.String,
  rate_limit: Schema.optional(Schema.NullOr(OpenAIRateLimit)),
})
const OpenAIUsage = Schema.Struct({
  plan_type: Schema.optional(Schema.NullOr(Schema.String)),
  rate_limit: Schema.optional(Schema.NullOr(OpenAIRateLimit)),
  additional_rate_limits: Schema.optional(Schema.NullOr(Schema.Array(OpenAIAdditionalRateLimit))),
  code_review_rate_limit: Schema.optional(Schema.NullOr(OpenAIRateLimit)),
})

function readConsole(integrations: Integration.Interface, http: HttpClient.HttpClient) {
  return Effect.gen(function* () {
    const connection = yield* integrations.connection.active(Integration.ID.make("opencode"))
    if (!connection) return undefined
    const credential = yield* integrations.connection
      .resolve(connection)
      .pipe(Effect.mapError((error) => new UnavailableError({ message: error.message })))
    if (!credential || credential.type === "external") return undefined
    const workspaceID = credential.metadata?.orgID
    if (typeof workspaceID !== "string") return undefined
    const server = ConsoleAccess.server(credential)
    const [budgets, go] = yield* Effect.all(
      [readBudgets(http, server, credential), readGo(http, server, credential, workspaceID)],
      { concurrency: 2 },
    )
    return {
      workspace: {
        id: workspaceID,
        ...(typeof credential.metadata?.orgName === "string" ? { name: credential.metadata.orgName } : {}),
        usageURL: `${server}/${workspaceID}/activity/overview`,
      },
      allowances: go ? [go] : [],
      budgets,
    }
  })
}

function readOpenAI(
  integrations: Integration.Interface,
  credentials: Credential.Interface,
  http: HttpClient.HttpClient,
) {
  return Effect.gen(function* () {
    const connection = yield* integrations.connection.active(Integration.ID.make("openai"))
    if (connection?.type !== "credential" || connection.method !== "oauth") return undefined
    const stored = (yield* credentials.get(connection.id))?.value
    if (stored?.type !== "oauth") return undefined
    // Token-sharing grants target api.openai.com/v1, not the Codex backend.
    if (
      stored.methodID === "chatgpt-token-sharing" ||
      (stored.methodID === "chatgpt-browser" && typeof stored.metadata?.clientID === "string")
    )
      return {
        providerID: Provider.ID.openai,
        name: "ChatGPT",
        usageURL: "https://chatgpt.com/settings/usage",
        windows: [],
      }
    if (stored.methodID !== "chatgpt-browser" && stored.methodID !== "chatgpt-headless") return undefined
    const credential = yield* integrations.connection
      .resolve(connection)
      .pipe(Effect.mapError((error) => new UnavailableError({ message: error.message })))
    if (credential?.type !== "oauth" || credential.methodID !== stored.methodID) return undefined
    const usage = yield* readOpenAIUsage(http, credential)
    const windows = [
      ...(usage.rate_limit ? rateLimitWindows("codex", usage.rate_limit) : []),
      ...(usage.code_review_rate_limit
        ? rateLimitWindows("code-review", usage.code_review_rate_limit, "Code review")
        : []),
      ...(usage.additional_rate_limits ?? []).flatMap((limit) =>
        limit.rate_limit ? rateLimitWindows(`additional:${limit.limit_name}`, limit.rate_limit, limit.limit_name) : [],
      ),
    ]
    if (windows.length === 0) return undefined
    return {
      providerID: Provider.ID.openai,
      name: "OpenAI",
      ...(usage.plan_type ? { plan: usage.plan_type } : {}),
      windows,
    }
  })
}

function readOpenAIUsage(http: HttpClient.HttpClient, credential: Credential.OAuth) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get("https://chatgpt.com/backend-api/wham/usage").pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(credential.access),
        HttpClientRequest.setHeaders(
          typeof credential.metadata?.accountID === "string"
            ? { "ChatGPT-Account-Id": credential.metadata.accountID }
            : {},
        ),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(OpenAIUsage)),
      Effect.scoped,
      Effect.mapError((error) => new UnavailableError({ message: `OpenAI usage is unavailable: ${error.message}` })),
    )
}

/** Every budget covering the member. Console refuses a service account's key with 403, and it has no budgets. */
function readBudgets(http: HttpClient.HttpClient, server: string, credential: Credential.Key | Credential.OAuth) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${server}/api/policies/current-budgets`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders(ConsoleAccess.headers(credential)),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        response.status === 403
          ? Effect.succeed([])
          : HttpClientResponse.filterStatusOk(response).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(ConsoleBudget))),
              Effect.map((budgets) =>
                budgets.map((budget) => ({
                  id: budget.ruleID,
                  limit: Money.USD.make(budget.limitDollars),
                  spent: Money.USD.make(budget.spentDollars),
                  scope: budget.scope,
                  per: budget.per,
                  coverage: budget.coverage,
                  models: budget.models.map((model) => ({
                    providerID: Provider.ID.make(model.providerID),
                    modelID: Model.ID.make(model.modelID),
                    name: model.name,
                    ...(model.spentDollars === undefined ? {} : { spent: Money.USD.make(model.spentDollars) }),
                  })),
                  vendors: budget.vendors.map((vendor) => vendor.name),
                  ...(budget.inputPriceAtLeast === undefined
                    ? {}
                    : { inputPriceAtLeast: Money.USDPerMillionTokens.make(budget.inputPriceAtLeast) }),
                  picked: budget.picked,
                  shared: budget.shared,
                  resetsAt: budget.resetsAt.getTime(),
                })),
              ),
            ),
      ),
      Effect.scoped,
      Effect.mapError(
        (error) => new UnavailableError({ message: `OpenCode Console budgets are unavailable: ${error.message}` }),
      ),
    )
}

/**
 * The Go allowance, from the inference API that shares the Console's origin. Go refuses (403) a workspace the member
 * doesn't subscribe to Go in, which has no allowance to show.
 */
function readGo(
  http: HttpClient.HttpClient,
  server: string,
  credential: Credential.Key | Credential.OAuth,
  workspaceID: string,
) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${new URL(server).origin}/zen/go/v1/usage`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(credential.type === "oauth" ? credential.access : credential.key),
        HttpClientRequest.setHeader("x-opencode-org-id", workspaceID),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        response.status === 403
          ? Effect.succeed(undefined)
          : HttpClientResponse.filterStatusOk(response).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(GoUsage)),
              Effect.map((body) => ({
                providerID: Provider.ID.make("opencode-go"),
                name: "OpenCode Go",
                windows: [
                  meter("rolling", body.usage.rolling),
                  meter("weekly", body.usage.weekly),
                  meter("monthly", body.usage.monthly),
                ],
              })),
            ),
      ),
      Effect.scoped,
      Effect.mapError(
        (error) => new UnavailableError({ message: `OpenCode Go usage is unavailable: ${error.message}` }),
      ),
    )
}

function meter(id: string, value: typeof GoMeter.Type) {
  return {
    id,
    percent: value.percent,
    limited: value.status === "rate-limited",
    resetsAt: value.resetsAt.getTime(),
  }
}

function rateLimitWindows(id: string, limit: typeof OpenAIRateLimit.Type, name?: string) {
  return (["primary", "secondary"] as const).flatMap((slot) => {
    const window = limit[`${slot}_window`]
    return window
      ? [
          {
            id: `${id}-${slot}`,
            ...(name === undefined ? {} : { name }),
            windowSeconds: window.limit_window_seconds,
            percent: window.used_percent,
            limited: window.used_percent >= 100,
            resetsAt: window.reset_at * 1000,
          },
        ]
      : []
  })
}
