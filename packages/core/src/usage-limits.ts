export * as UsageLimits from "./usage-limits.js"

import type { HttpRateLimitDetails } from "@opencode/ai/effect"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { UsageLimits } from "@opencode/schema/usage-limits"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Context, Duration, Effect, Layer, Option, Ref, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ConsoleAccess } from "./console-access.js"
import type { Credential } from "./credential.js"
import { Integration } from "./integration.js"

export const Info = UsageLimits.Info
export type Info = UsageLimits.Info

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("UsageLimits.UnavailableError", {
  message: Schema.String,
}) {}

export interface Interface {
  /** The usage limits of the OpenCode Console workspace this location is signed in to, if it is. */
  readonly get: () => Effect.Effect<Info | undefined, UnavailableError>
  /**
   * Remembers the latest rate-limit snapshot a provider's responses reported, so
   * `get` can surface a meter for providers with no Console allowance.
   */
  readonly observe: (providerID: string, snapshot: HttpRateLimitDetails) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UsageLimits") {}

/**
 * The `x-ratelimit-*` snapshot the current model stream last saw. The runner
 * provides one per model call; the executor middleware records into it, so the
 * capture stays with the request that produced it.
 */
export class RateLimitCapture extends Context.Service<
  RateLimitCapture,
  { readonly ref: Ref.Ref<Option.Option<HttpRateLimitDetails>> }
>()("@opencode/UsageLimits.RateLimitCapture") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const integrations = yield* Integration.Service
    const http = yield* HttpClient.HttpClient
    const snapshots = yield* Ref.make(new Map<string, HttpRateLimitDetails>())

    const get = Effect.fn("UsageLimits.get")(function* () {
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
      ).pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(15),
          orElse: () => Effect.fail(new UnavailableError({ message: "OpenCode Console usage limits timed out" })),
        }),
      )
      // Observed headers only: no request leaves this location, so a provider
      // outage can never take down the Console limits above.
      const meta = metaMeter((yield* Ref.get(snapshots)).get("meta"))
      return {
        workspace: {
          id: workspaceID,
          ...(typeof credential.metadata?.orgName === "string" ? { name: credential.metadata.orgName } : {}),
          usageURL: `${server}/${workspaceID}/activity/overview`,
        },
        ...(go === undefined ? {} : { go }),
        ...(meta === undefined ? {} : { meta }),
        budgets,
      }
    })

    const observe = Effect.fn("UsageLimits.observe")(function* (providerID: string, snapshot: HttpRateLimitDetails) {
      // A bare `retry-after` with no quota windows reports no allowance to show.
      if (
        snapshot.limit === undefined &&
        snapshot.remaining === undefined &&
        snapshot.reset === undefined
      )
        return
      yield* Ref.update(snapshots, (previous) => new Map(previous).set(providerID, snapshot))
    })

    return Service.of({ get, observe })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Integration.node, httpClient],
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
  percent: Schema.Finite,
  resetsAt: Schema.DateFromString,
})
const GoUsage = Schema.Struct({ usage: Schema.Struct({ rolling: GoMeter, weekly: GoMeter, monthly: GoMeter }) })

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
                rolling: meter(body.usage.rolling),
                weekly: meter(body.usage.weekly),
                monthly: meter(body.usage.monthly),
              })),
            ),
      ),
      Effect.scoped,
      Effect.mapError(
        (error) => new UnavailableError({ message: `OpenCode Go usage is unavailable: ${error.message}` }),
      ),
    )
}

function meter(value: typeof GoMeter.Type) {
  return { percent: value.percent, limited: value.status === "rate-limited", resetsAt: value.resetsAt.getTime() }
}

/**
 * The Meta quota meter, built from the `x-ratelimit-*` headers Meta's own
 * responses report. Dimensions that name tokens feed `tokens`, everything
 * else feeds `requests`; dimensions without a usable limit are skipped.
 */
function metaMeter(snapshot: HttpRateLimitDetails | undefined): UsageLimits.Meta | undefined {
  if (!snapshot) return undefined
  const dimensions = new Set([...Object.keys(snapshot.limit ?? {}), ...Object.keys(snapshot.remaining ?? {})])
  const meter: { requests?: UsageLimits.MetaMeter; tokens?: UsageLimits.MetaMeter } = {}
  for (const dimension of dimensions) {
    const limit = Number(snapshot.limit?.[dimension])
    const remaining = Number(snapshot.remaining?.[dimension])
    if (!(limit > 0) || !Number.isFinite(remaining)) continue
    const resetsAt = parseReset(snapshot.reset?.[dimension])
    const window: UsageLimits.MetaMeter = {
      percent: Math.max(0, Math.min(100, Math.round(((limit - remaining) / limit) * 100))),
      limited: remaining <= 0,
      ...(resetsAt === undefined ? {} : { resetsAt }),
    }
    if (meter[dimension.toLowerCase().includes("token") ? "tokens" : "requests"] === undefined)
      meter[dimension.toLowerCase().includes("token") ? "tokens" : "requests"] = window
  }
  return meter.requests === undefined && meter.tokens === undefined ? undefined : meter
}

/**
 * When a quota window resets, from a provider `reset` value: a duration like
 * `1s` or `6m0s` counts from now, a large number is an epoch, and anything
 * else tries a date parse. Values that name no future point yield no reset.
 */
function parseReset(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  if (/[dhms]/i.test(text)) {
    const parts = /^(?:(\d+(?:\.\d+)?)\s*d)?(?:(\d+(?:\.\d+)?)\s*h)?(?:(\d+(?:\.\d+)?)\s*m(?!s))?(?:(\d+(?:\.\d+)?)\s*s)?$/i.exec(
      text,
    )
    if (!parts || parts.slice(1).every((part) => part === undefined)) return undefined
    const millis =
      Number(parts[1] ?? 0) * 86_400_000 +
      Number(parts[2] ?? 0) * 3_600_000 +
      Number(parts[3] ?? 0) * 60_000 +
      Number(parts[4] ?? 0) * 1000
    return Number.isFinite(millis) ? Date.now() + millis : undefined
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const epoch = Number(text)
    if (!Number.isFinite(epoch)) return undefined
    // Seconds and milliseconds both appear in the wild; anything smaller is not a usable point in time.
    if (epoch >= 1_000_000_000_000) return epoch
    if (epoch >= 1_000_000_000) return epoch * 1000
    return undefined
  }
  const date = Date.parse(text)
  return Number.isNaN(date) ? undefined : date
}
