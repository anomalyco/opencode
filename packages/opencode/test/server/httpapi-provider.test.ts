import { afterEach, describe, expect } from "bun:test"
import { Effect, FileSystem, Layer, Path } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
const providerID = "test-oauth-parity"
const oauthURL = "https://example.com/oauth"
const oauthInstructions = "Finish OAuth"

function app() {
  return Server.Default().app
}

function providerListHasFetch(list: unknown) {
  if (!Array.isArray(list)) return false
  return list.some((item: unknown) => {
    if (typeof item !== "object" || item === null || !("id" in item) || !("options" in item)) return false
    if (item.id !== "google") return false
    if (typeof item.options !== "object" || item.options === null) return false
    return "fetch" in item.options
  })
}

function hasProviderWithFetch(input: unknown, key: "all" | "providers") {
  if (typeof input !== "object" || input === null) return false
  if (key === "all") return "all" in input && providerListHasFetch(input.all)
  return "providers" in input && providerListHasFetch(input.providers)
}

function requestAuthorize(input: {
  app: ReturnType<typeof app>
  providerID: string
  method: number
  headers: HeadersInit
}) {
  return Effect.promise(async () => {
    const response = await input.app.request(`/provider/${input.providerID}/oauth/authorize`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ method: input.method }),
    })
    return {
      status: response.status,
      body: await response.text(),
    }
  })
}

function writeProviderAuthPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    yield* fs.makeDirectory(path.join(dir, ".opencode", "plugin"), { recursive: true })
    yield* fs.writeFileString(
      path.join(dir, ".opencode", "plugin", "provider-oauth-parity.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-parity",',
        "  server: async () => ({",
        "    auth: {",
        `      provider: "${providerID}",`,
        "      methods: [",
        '        { type: "api", label: "API key" },',
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          authorize: async () => ({",
        `            url: "${oauthURL}",`,
        '            method: "code",',
        `            instructions: "${oauthInstructions}",`,
        "            callback: async () => ({ type: 'success', key: 'token' }),",
        "          }),",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeFunctionOptionsPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    yield* fs.makeDirectory(path.join(dir, ".opencode", "plugin"), { recursive: true })
    yield* fs.writeFileString(
      path.join(dir, ".opencode", "plugin", "provider-function-options.ts"),
      [
        "export default {",
        '  id: "test.provider-function-options",',
        "  server: async () => ({",
        "    auth: {",
        '      provider: "google",',
        "      loader: async (_getAuth, provider) => {",
        "        for (const model of Object.values(provider.models ?? {})) {",
        "          model.cost = { input: 0, output: 0 }",
        "        }",
        "        return {",
        '        apiKey: "",',
        "        fetch: async (input, init) => fetch(input, init),",
        "        }",
        "      },",
        "      methods: [{ type: 'api', label: 'API key' }],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function withProviderProject<A, E, R>(self: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-test-" })

    yield* fs.writeFileString(
      path.join(dir, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", formatter: false, lsp: false }),
    )
    yield* writeProviderAuthPlugin(dir)
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        WithInstance.provide({ directory: dir, fn: () => InstanceRuntime.disposeInstance(Instance.current) }),
      ).pipe(Effect.ignore),
    )

    return yield* self(dir).pipe(provideInstance(dir))
  })
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("provider HttpApi", () => {
  it.live(
    "serves OAuth authorize response shapes",
    withProviderProject((dir) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": dir, "content-type": "application/json" }
        const server = app()

        const api = yield* requestAuthorize({
          app: server,
          providerID,
          method: 0,
          headers,
        })
        // method 0 (api-key style) — authorize() resolves with no further
        // redirect; #26474 changed the wire format to JSON `null` so clients
        // can `.json()` parse uniformly instead of getting an empty body
        // that throws.
        expect(api).toEqual({ status: 200, body: "null" })

        const oauth = yield* requestAuthorize({
          app: server,
          providerID,
          method: 1,
          headers,
        })
        expect(JSON.parse(oauth.body)).toEqual({
          url: oauthURL,
          method: "code",
          instructions: oauthInstructions,
        })
      }),
    ),
  )

  it.live("serves provider lists when auth loaders add runtime fetch options", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-test-" })
      const previous = process.env.OPENCODE_AUTH_CONTENT

      yield* fs.writeFileString(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", formatter: false, lsp: false }),
      )
      yield* writeFunctionOptionsPlugin(dir)
      yield* Effect.sync(() => {
        process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
          google: { type: "oauth", refresh: "dummy", access: "dummy", expires: 9999999999999 },
        })
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
          if (previous !== undefined) process.env.OPENCODE_AUTH_CONTENT = previous
        }),
      )
      const headers = { "x-opencode-directory": dir }
      const providerResponse = yield* Effect.promise(() => Promise.resolve(app().request("/provider", { headers })))
      const configResponse = yield* Effect.promise(() =>
        Promise.resolve(app().request("/config/providers", { headers })),
      )

      expect(providerResponse.status).toBe(200)
      expect(configResponse.status).toBe(200)

      const providerBody = yield* Effect.promise(() => providerResponse.json())
      const configBody = yield* Effect.promise(() => configResponse.json())
      expect(hasProviderWithFetch(providerBody, "all")).toBe(false)
      expect(hasProviderWithFetch(configBody, "providers")).toBe(false)
    }),
  )
})
