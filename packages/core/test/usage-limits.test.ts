import { expect } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { UsageLimits } from "@opencode/core/usage-limits"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
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

const META_URL = "https://meta.example/usage"

const metaKey = Credential.Key.make({ type: "key", key: "meta-key" })

/** Sets `META_USAGE_URL` for one read; Meta is otherwise unconfigured. */
const withMetaURL = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      process.env.META_USAGE_URL = META_URL
    }),
    () => effect,
    () => Effect.sync(() => void delete process.env.META_USAGE_URL),
  )

/** Reads usage limits for a location whose active connections resolve to `connections`. */
const read = (
  connections: { console?: Credential.Value; meta?: Credential.Value } | undefined,
  respond: (url: string) => Response,
  requests: HttpClientRequest.HttpClientRequest[] = [],
) =>
  Effect.flatMap(UsageLimits.Service, (limits) => limits.get()).pipe(
    Effect.provide(
      UsageLimits.layer.pipe(
        Layer.provide(
          Layer.merge(
            Layer.mock(Integration.Service, {
              revision: () => 0,
              get: unused,
              connection: {
                active: (id: Integration.ID) =>
                  Effect.succeed(
                    id === "meta"
                      ? connections?.meta && {
                          type: "credential" as const,
                          id: Credential.ID.make("meta"),
                          label: "Meta",
                          method: "key" as const,
                        }
                      : connections?.console && {
                          type: "credential" as const,
                          id: Credential.ID.make("console"),
                          label: "Anomaly",
                          method: "oauth" as const,
                        },
                  ),
                resolve: (connection) =>
                  Effect.succeed(
                    connection.type === "credential" && connection.id === "meta"
                      ? connections?.meta
                      : connections?.console,
                  ),
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
      ),
    ),
  )

it.effect("reads the member's Go allowance and budgets from the Console they signed in to", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const limits = yield* read(
      { console: signedIn },
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
    const limits = yield* read({ console: signedIn }, () => Response.json({ type: "error" }, { status: 403 }))

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
    const exit = yield* read({ console: signedIn }, (url) =>
      url.endsWith("/current-budgets")
        ? new Response("upstream down", { status: 502 })
        : Response.json({ type: "error" }, { status: 403 }),
    ).pipe(Effect.exit)

    expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
      value: { _tag: "UsageLimits.UnavailableError" },
    })
  }),
)

it.effect("attaches the Meta monthly meter from the stored Meta connection", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const limits = yield* withMetaURL(
      read(
        { console: signedIn, meta: metaKey },
        (url) =>
          url === META_URL
            ? Response.json({ usage: { monthly: meter("ok", 63) } })
            : url.endsWith("/zen/go/v1/usage")
              ? Response.json({
                  usage: { rolling: meter("ok", 42), weekly: meter("ok", 18), monthly: meter("ok", 55) },
                })
              : Response.json([budget]),
        requests,
      ),
    )

    expect(limits?.workspace).toEqual({
      id: "wrk_anomaly",
      name: "Anomaly",
      usageURL: "https://dev.opencode.ai/console/wrk_anomaly/activity/overview",
    })
    expect(limits?.meta).toEqual({
      monthly: { percent: 63, limited: false, resetsAt: Date.parse("2026-10-24T17:00:00.000Z") },
    })
    // The Meta read authenticates with the stored Meta key, not the Console credential.
    expect(requests.find((request) => request.url === META_URL)?.headers.authorization).toBe(
      "Bearer meta-key",
    )
  }),
)

it.effect("keeps the Console limits when the Meta endpoint fails", () =>
  Effect.gen(function* () {
    const limits = yield* withMetaURL(
      read({ console: signedIn, meta: metaKey }, (url) =>
        url === META_URL
          ? new Response("meta down", { status: 500 })
          : url.endsWith("/zen/go/v1/usage")
            ? Response.json({
                usage: { rolling: meter("ok", 42), weekly: meter("ok", 18), monthly: meter("ok", 55) },
              })
            : Response.json([budget]),
      ),
    )

    expect(limits?.workspace.id).toBe("wrk_anomaly")
    expect(limits?.go?.monthly.percent).toBe(55)
    expect(limits?.budgets).toHaveLength(1)
    expect(limits).not.toHaveProperty("meta")
  }),
)

it.effect("has no Meta meter without a Meta connection", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const limits = yield* withMetaURL(
      read(
        { console: signedIn },
        (url) =>
          url === META_URL
            ? Response.json({ usage: { monthly: meter("ok", 63) } })
            : url.endsWith("/zen/go/v1/usage")
              ? Response.json({
                  usage: { rolling: meter("ok", 42), weekly: meter("ok", 18), monthly: meter("ok", 55) },
                })
              : Response.json([budget]),
        requests,
      ),
    )

    expect(limits).not.toHaveProperty("meta")
    expect(requests.some((request) => request.url === META_URL)).toBe(false)
  }),
)

it.effect("has nothing to show for Meta alone without a Console workspace", () =>
  Effect.gen(function* () {
    // The Meta meter only attaches to a Console workspace; it never fabricates one.
    const limits = yield* withMetaURL(
      read({ meta: metaKey }, () => Response.json({ usage: { monthly: meter("ok", 63) } })),
    )
    expect(limits).toBeUndefined()
  }),
)

it.effect("reports a Console that can't answer as unavailable even when Meta also fails", () =>
  Effect.gen(function* () {
    const exit = yield* withMetaURL(
      read({ console: signedIn, meta: metaKey }, (url) =>
        url === META_URL
          ? new Response("meta down", { status: 500 })
          : url.endsWith("/current-budgets")
            ? new Response("upstream down", { status: 502 })
            : Response.json({ type: "error" }, { status: 403 }),
      ),
    ).pipe(Effect.exit)

    expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
      value: { _tag: "UsageLimits.UnavailableError" },
    })
  }),
)
