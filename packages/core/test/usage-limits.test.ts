import { expect } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Provider } from "@opencode/core/provider"
import { UsageLimits } from "@opencode/core/usage-limits"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Effect, Exit, Layer } from "effect"
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const unused = () => Effect.die("unused")

const signedIn = Credential.OAuth.make({
  type: "oauth",
  methodID: Integration.MethodID.make("device"),
  access: "console-access",
  refresh: "console-refresh",
  expires: 1,
  metadata: { server: "https://dev.opencode.ai/console", orgID: "wrk_anomaly", orgName: "Anomaly" },
})

const budget = {
  policyID: "policy_engineering",
  ruleID: "rule_astra",
  limitDollars: 20,
  spentDollars: 15,
  scope: "each",
  per: "model",
  modelCount: 1,
  coverage: "models",
  models: [
    {
      providerID: "opencode",
      connectionID: "conn_managed",
      modelID: "gpt-6-astra",
      name: "GPT-6 Astra",
      spentDollars: 15,
    },
  ],
  vendors: [{ id: "openai", name: "OpenAI" }],
  inputPriceAtLeast: 3,
  picked: false,
  shared: false,
  resetsAt: "2026-11-01T00:00:00.000Z",
}

const meter = (status: string, percent: number) => ({ status, percent, resetsAt: "2026-10-24T17:00:00.000Z" })

/** The active credential of each integration, and the `opencode-go` provider: the Console's or the models.dev one. */
type Setup = {
  readonly credentials: Partial<Record<string, Credential.Value>>
  readonly provider?: { readonly integrationID: string; readonly baseURL?: string }
}

const services = (setup: Setup, respond: (url: string) => Response, requests: HttpClientRequest.HttpClientRequest[]) =>
  UsageLimits.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Integration.Service, {
          revision: () => 0,
          get: unused,
          connection: {
            active: (integrationID) =>
              Effect.succeed(
                setup.credentials[integrationID] && {
                  type: "credential" as const,
                  id: Credential.ID.make(integrationID),
                  label: integrationID,
                  method: setup.credentials[integrationID].type === "oauth" ? ("oauth" as const) : ("key" as const),
                },
              ),
            resolve: (connection) =>
              Effect.succeed(connection.type === "credential" ? setup.credentials[connection.id] : undefined),
            key: unused,
            external: unused,
            activate: unused,
            update: unused,
            remove: unused,
            status: unused,
          },
          oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
          command: { connect: unused, status: unused, cancel: unused },
        }),
        Layer.mock(Provider.Service, {
          get: () =>
            Effect.succeed(
              setup.provider && {
                ...Provider.Info.empty(Provider.ID.make("opencode-go")),
                integrationID: Integration.ID.make(setup.provider.integrationID),
                ...(setup.provider.baseURL ? { settings: { baseURL: setup.provider.baseURL } } : {}),
              },
            ),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
            Effect.sync(() => {
              requests.push(request)
              return HttpClientResponse.fromWeb(request, respond(request.url))
            }),
          ),
        ),
      ),
    ),
  )

/** Reads usage limits for a location whose active OpenCode Console connection resolves to `credential`. */
const read = (
  credential: Credential.Value | undefined,
  respond: (url: string) => Response,
  requests: HttpClientRequest.HttpClientRequest[] = [],
) =>
  Effect.flatMap(UsageLimits.Service, (limits) => limits.get()).pipe(
    Effect.provide(services({ credentials: { opencode: credential } }, respond, requests)),
  )

/** Reads how Go is connected. */
const readGo = (
  setup: Setup,
  respond: (url: string) => Response,
  requests: HttpClientRequest.HttpClientRequest[] = [],
) =>
  Effect.flatMap(UsageLimits.Service, (limits) => limits.go()).pipe(Effect.provide(services(setup, respond, requests)))

it.effect("reads the member's Go allowance and budgets from the Console they signed in to", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const limits = yield* read(
      signedIn,
      (url) =>
        url.endsWith("/zen/go/v1/usage")
          ? Response.json({
              usage: { rolling: meter("ok", 42), weekly: meter("ok", 18), monthly: meter("rate-limited", 100) },
            })
          : Response.json([budget]),
      requests,
    )

    expect(limits).toEqual({
      workspace: {
        id: "wrk_anomaly",
        name: "Anomaly",
        usageURL: "https://dev.opencode.ai/console/wrk_anomaly/activity/overview",
      },
      go: {
        rolling: { percent: 42, limited: false, resetsAt: Date.parse("2026-10-24T17:00:00.000Z") },
        weekly: { percent: 18, limited: false, resetsAt: Date.parse("2026-10-24T17:00:00.000Z") },
        monthly: { percent: 100, limited: true, resetsAt: Date.parse("2026-10-24T17:00:00.000Z") },
      },
      budgets: [
        {
          id: "rule_astra",
          limit: Money.USD.make(20),
          spent: Money.USD.make(15),
          scope: "each",
          per: "model",
          coverage: "models",
          models: [
            {
              providerID: Provider.ID.make("opencode"),
              modelID: Model.ID.make("gpt-6-astra"),
              name: "GPT-6 Astra",
              spent: Money.USD.make(15),
            },
          ],
          vendors: ["OpenAI"],
          inputPriceAtLeast: Money.USDPerMillionTokens.make(3),
          picked: false,
          shared: false,
          resetsAt: Date.parse("2026-11-01T00:00:00.000Z"),
        },
      ],
    })
    // Console reads the workspace from x-org-id; inference, which serves Go, from x-opencode-org-id.
    expect(
      requests
        .map((request) => ({
          url: request.url,
          authorization: request.headers.authorization,
          workspace: Object.entries(request.headers).filter(([name]) => name.endsWith("org-id")),
        }))
        .toSorted((a, b) => a.url.localeCompare(b.url)),
    ).toEqual([
      {
        url: "https://dev.opencode.ai/console/api/policies/current-budgets",
        authorization: "Bearer console-access",
        workspace: [["x-org-id", "wrk_anomaly"]],
      },
      {
        url: "https://dev.opencode.ai/zen/go/v1/usage",
        authorization: "Bearer console-access",
        workspace: [["x-opencode-org-id", "wrk_anomaly"]],
      },
    ])
  }),
)

it.effect("has no Go allowance or budgets to show where Console refuses them", () =>
  Effect.gen(function* () {
    // Go refuses a workspace without the member's subscription; Console refuses budgets to a service account's key.
    const limits = yield* read(signedIn, () => Response.json({ type: "error" }, { status: 403 }))

    expect(limits).toEqual({
      workspace: {
        id: "wrk_anomaly",
        name: "Anomaly",
        usageURL: "https://dev.opencode.ai/console/wrk_anomaly/activity/overview",
      },
      budgets: [],
    })
  }),
)

it.effect("has nothing to show for a location that isn't signed in to OpenCode Console", () =>
  Effect.gen(function* () {
    expect(yield* read(undefined, () => Response.json([budget]))).toBeUndefined()
  }),
)

it.effect("reports a Console that can't answer as unavailable", () =>
  Effect.gen(function* () {
    // Go has nothing to show, so only the Console's failure can fail the read.
    const exit = yield* read(signedIn, (url) =>
      url.endsWith("/current-budgets")
        ? new Response("upstream down", { status: 502 })
        : Response.json({ type: "error" }, { status: 403 }),
    ).pipe(Effect.exit)

    expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
      value: { _tag: "UsageLimits.UnavailableError" },
    })
  }),
)

const goKey = Credential.Key.make({ type: "key", key: "go-key" })

const goUsage = () =>
  Response.json({ usage: { rolling: meter("ok", 42), weekly: meter("ok", 18), monthly: meter("ok", 7) } })

const allowance = {
  rolling: { percent: 42, limited: false, resetsAt: Date.parse("2026-10-24T17:00:00.000Z") },
  weekly: { percent: 18, limited: false, resetsAt: Date.parse("2026-10-24T17:00:00.000Z") },
  monthly: { percent: 7, limited: false, resetsAt: Date.parse("2026-10-24T17:00:00.000Z") },
}

const anomaly = { id: "wrk_anomaly", name: "Anomaly", goURL: "https://dev.opencode.ai/console/wrk_anomaly/go" }

// The models.dev provider, which Go keys connect; the Console's replaces it while the account's workspace has Go.
const modelsDevGo = { integrationID: "opencode-go", baseURL: "https://dev.opencode.ai/zen/go/v1" }
const consoleGo = { integrationID: "opencode", baseURL: "https://dev.opencode.ai/zen/go/v1" }

const headers = (requests: HttpClientRequest.HttpClientRequest[]) =>
  requests.map((request) => ({
    url: request.url,
    authorization: request.headers.authorization,
    workspace: Object.entries(request.headers).filter(([name]) => name.endsWith("org-id")),
  }))

it.effect("reads Go through the account whose workspace has it", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const go = yield* readGo({ credentials: { opencode: signedIn }, provider: consoleGo }, goUsage, requests)

    expect(go).toEqual({ connection: "account", integrationID: "opencode", workspace: anomaly, usage: allowance })
    expect(headers(requests)).toEqual([
      {
        url: "https://dev.opencode.ai/zen/go/v1/usage",
        authorization: "Bearer console-access",
        workspace: [["x-opencode-org-id", "wrk_anomaly"]],
      },
    ])
  }),
)

it.effect("has no allowance for an account whose workspace has no active Go", () =>
  Effect.gen(function* () {
    const go = yield* readGo({ credentials: { opencode: signedIn }, provider: modelsDevGo }, () =>
      Response.json({ type: "error" }, { status: 403 }),
    )

    expect(go).toEqual({ connection: "account", integrationID: "opencode", workspace: anomaly })
  }),
)

it.effect("reads Go for a key without naming its workspace", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const go = yield* readGo({ credentials: { "opencode-go": goKey }, provider: modelsDevGo }, goUsage, requests)

    expect(go).toEqual({ connection: "key", integrationID: "opencode-go", usage: allowance })
    expect(headers(requests)).toEqual([
      { url: "https://dev.opencode.ai/zen/go/v1/usage", authorization: "Bearer go-key", workspace: [] },
    ])
  }),
)

it.effect("has no allowance for a key whose workspace has no active Go", () =>
  Effect.gen(function* () {
    const go = yield* readGo({ credentials: { "opencode-go": goKey }, provider: modelsDevGo }, () =>
      Response.json({ type: "error" }, { status: 403 }),
    )

    expect(go).toEqual({ connection: "key", integrationID: "opencode-go" })
  }),
)

it.effect("reads the key that Go requests use while the account's workspace has no Go", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const go = yield* readGo(
      { credentials: { opencode: signedIn, "opencode-go": goKey }, provider: modelsDevGo },
      goUsage,
      requests,
    )

    expect(go).toEqual({ connection: "key", integrationID: "opencode-go", usage: allowance })
    expect(headers(requests).map((request) => request.authorization)).toEqual(["Bearer go-key"])
  }),
)

it.effect("reads the account once its workspace's Go provider replaces the key's", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const go = yield* readGo(
      { credentials: { opencode: signedIn, "opencode-go": goKey }, provider: consoleGo },
      goUsage,
      requests,
    )

    expect(go).toEqual({ connection: "account", integrationID: "opencode", workspace: anomaly, usage: allowance })
    expect(headers(requests).map((request) => request.authorization)).toEqual(["Bearer console-access"])
  }),
)

it.effect("has no Go connection without a credential", () =>
  Effect.gen(function* () {
    expect(yield* readGo({ credentials: {}, provider: modelsDevGo }, goUsage)).toBeUndefined()
  }),
)
