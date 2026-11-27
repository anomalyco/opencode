import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { UsageLimits } from "@opencode/core/usage-limits"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

/** Requests a location's usage limits from a server whose UsageLimits answers with `get`. */
const request = (get: UsageLimits.Interface["get"]) =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-usage-endpoint-")))
    const global = path.join(tmp.path, "global")
    yield* Effect.promise(() => fs.mkdir(global))
    const handler = yield* ServerFetch.make(
      {
        database: { path: ":memory:" },
        config: { directory: global },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      {
        overrides: [
          UsageLimits.node.replace(
            makeLocationNode({
              service: UsageLimits.Service,
              layer: Layer.succeed(UsageLimits.Service, UsageLimits.Service.of({ get })),
              deps: [],
            }),
          ),
        ],
      },
    )
    const url = new URL("/api/experimental/usage/limits", "http://opencode.local")
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => handler(new Request(url)))
    return { status: response.status, body: yield* Effect.promise(() => response.json()) }
  })

it.live("returns the usage limits of the OpenCode Console workspace a location is signed in to", () =>
  Effect.gen(function* () {
    const limits: UsageLimits.Info = {
      allowances: [],
      workspace: { id: "wrk_anomaly", usageURL: "https://opencode.ai/console/wrk_anomaly/activity/overview" },
      budgets: [
        {
          id: "rule_monthly",
          limit: Money.USD.make(50),
          spent: Money.USD.make(12.5),
          scope: "each",
          per: "set",
          coverage: "all",
          models: [],
          vendors: [],
          picked: false,
          shared: false,
          resetsAt: 1793491200000,
        },
      ],
    }
    const result = yield* request(() => Effect.succeed(limits))

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ data: limits })
  }),
)

it.live("returns subscription windows without a Console workspace", () =>
  Effect.gen(function* () {
    const limits = {
      unavailable: [Provider.ID.opencode],
      allowances: [
        {
          providerID: Provider.ID.openai,
          name: "OpenAI",
          windows: [
            { id: "codex-primary", percent: 18, limited: false, resetsAt: 1793491200000, windowSeconds: 18000 },
          ],
        },
      ],
      budgets: [],
    }
    const result = yield* request(() => Effect.succeed(limits))
    expect(result.status).toBe(200)
    expect(result.body.data).toEqual(limits)
  }),
)

it.live("returns null when no usage data is available", () =>
  Effect.gen(function* () {
    const result = yield* request(() => Effect.succeed(undefined))

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ data: null })
  }),
)

it.live("reports usage limits Console can't provide as unavailable", () =>
  Effect.gen(function* () {
    const result = yield* request(() =>
      Effect.fail(new UsageLimits.UnavailableError({ message: "OpenCode Console budgets are unavailable" })),
    )

    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ message: "OpenCode Console budgets are unavailable", service: "opencode" })
  }),
)
