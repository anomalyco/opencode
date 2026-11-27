import { expect } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Flag } from "@opencode/core/flag"
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

const chatgpt = Credential.OAuth.make({
  type: "oauth",
  methodID: Integration.MethodID.make("chatgpt-browser"),
  access: "codex-access",
  metadata: { accountID: "acct_chatgpt" },
  refresh: "chatgpt-refresh",
  expires: 0,
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

/** Reads usage limits for a location whose active OpenCode Console connection resolves to `credential`. */
const read = (
  credential: Credential.Value | undefined,
  respond: (url: string) => Response,
  requests: HttpClientRequest.HttpClientRequest[] = [],
  openaiCredential?: Credential.Value,
  overrides = "openai_usage",
) =>
  Effect.flatMap(UsageLimits.Service, (limits) => limits.get()).pipe(
    Effect.provide(
      UsageLimits.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Flag.testLayer([], { overrides }),
            Layer.mock(Credential.Service, {
              get: (id) =>
                Effect.succeed(
                  openaiCredential &&
                    new Credential.Info({
                      id,
                      integrationID: Integration.ID.make("openai"),
                      label: "OpenAI",
                      value: openaiCredential,
                    }),
                ),
            }),
            Layer.mock(Integration.Service, {
              revision: () => 0,
              get: unused,
              connection: {
                active: (integrationID) => {
                  const value = integrationID === Integration.ID.make("openai") ? openaiCredential : credential
                  return Effect.succeed(
                    value && {
                      type: "credential" as const,
                      id: Credential.ID.make(integrationID === Integration.ID.make("openai") ? "openai" : "console"),
                      label: "Anomaly",
                      method: "oauth" as const,
                    },
                  )
                },
                resolve: (connection) =>
                  openaiCredential?.type === "oauth" &&
                  openaiCredential.methodID === "chatgpt-token-sharing" &&
                  connection.type === "credential" &&
                  connection.id === "openai"
                    ? Effect.die("token sharing must not refresh for a settings link")
                    : Effect.succeed(
                        connection.type === "credential" && connection.id === Credential.ID.make("openai")
                          ? openaiCredential
                          : credential,
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
      allowances: [
        {
          providerID: Provider.ID.make("opencode-go"),
          name: "OpenCode Go",
          windows: [
            {
              id: "rolling",
              percent: 42,
              limited: false,
              resetsAt: Date.parse("2026-10-24T17:00:00.000Z"),
            },
            {
              id: "weekly",
              percent: 18,
              limited: false,
              resetsAt: Date.parse("2026-10-24T17:00:00.000Z"),
            },
            {
              id: "monthly",
              percent: 100,
              limited: true,
              resetsAt: Date.parse("2026-10-24T17:00:00.000Z"),
            },
          ],
        },
      ],
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
      allowances: [],
      budgets: [],
    })
  }),
)

it.effect("reads OpenAI Codex quota windows from the active ChatGPT OAuth connection", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const limits = yield* read(
      undefined,
      () =>
        Response.json({
          plan_type: "plus",
          rate_limit: {
            allowed: true,
            primary_window: {
              used_percent: 37,
              limit_window_seconds: 18_000,
              reset_at: 1_792_252_800,
            },
            secondary_window: {
              used_percent: 81,
              limit_window_seconds: 604_800,
              reset_at: 1_792_598_400,
            },
          },
          additional_rate_limits: [
            {
              limit_name: "reviews",
              rate_limit: {
                allowed: false,
                primary_window: {
                  used_percent: 100,
                  limit_window_seconds: 86_400,
                  reset_at: 1_792_339_200,
                },
              },
            },
          ],
        }),
      requests,
      chatgpt,
    )

    expect(limits).toEqual({
      allowances: [
        {
          providerID: Provider.ID.openai,
          name: "OpenAI",
          plan: "plus",
          windows: [
            {
              id: "codex-primary",
              windowSeconds: 18_000,
              percent: 37,
              limited: false,
              resetsAt: 1_792_252_800_000,
            },
            {
              id: "codex-secondary",
              windowSeconds: 604_800,
              percent: 81,
              limited: false,
              resetsAt: 1_792_598_400_000,
            },
            {
              id: "additional:reviews-primary",
              name: "reviews",
              windowSeconds: 86_400,
              percent: 100,
              limited: true,
              resetsAt: 1_792_339_200_000,
            },
          ],
        },
      ],
      budgets: [],
    })
    expect(
      requests.map((request) => ({
        url: request.url,
        authorization: request.headers.authorization,
        account: request.headers["chatgpt-account-id"],
      })),
    ).toEqual([
      {
        url: "https://chatgpt.com/backend-api/wham/usage",
        authorization: `Bearer ${chatgpt.access}`,
        account: "acct_chatgpt",
      },
    ])
  }),
)

it.effect("links token sharing to ChatGPT settings without sending its token to Codex", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const info = yield* read(undefined, () => new Response(null, { status: 401 }), requests, {
      ...chatgpt,
      methodID: Integration.MethodID.make("chatgpt-token-sharing"),
    })
    expect(requests).toHaveLength(0)
    expect(info?.allowances[0]?.usageURL).toBe("https://chatgpt.com/settings/usage")
  }),
)

it.effect("reads only Console when OpenAI usage is disabled", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const info = yield* read(signedIn, () => new Response(null, { status: 403 }), requests, chatgpt, "-openai_usage")
    expect(info?.workspace?.id).toBe("wrk_anomaly")
    expect(requests.map((request) => new URL(request.url).hostname)).toEqual(["dev.opencode.ai", "dev.opencode.ai"])
  }),
)

it.effect("keeps the healthy source when either subscription endpoint fails", () =>
  Effect.gen(function* () {
    const console = yield* read(
      signedIn,
      (url) => new Response(null, { status: url.startsWith("https://chatgpt.com") ? 401 : 403 }),
      [],
      chatgpt,
    )
    expect(console?.workspace?.id).toBe("wrk_anomaly")
    expect(console?.unavailable).toEqual([Provider.ID.openai])
    const codex = yield* read(
      signedIn,
      (url) =>
        url.startsWith("https://chatgpt.com")
          ? Response.json({
              rate_limit: { primary_window: { used_percent: 2, limit_window_seconds: 18000, reset_at: 42 } },
            })
          : new Response(null, { status: 502 }),
      [],
      { ...chatgpt, methodID: Integration.MethodID.make("chatgpt-headless") },
    )
    expect(codex?.allowances[0]?.windows[0]?.resetsAt).toBe(42000)
    expect(codex?.unavailable).toEqual([Provider.ID.opencode])
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
