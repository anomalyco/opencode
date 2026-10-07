import { chmod } from "node:fs/promises"
import { Agent } from "@opencode/core/agent"
import { describe, expect } from "bun:test"
import { Effect, Schedule, Schema } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { make } from "@opencode/core/plugin/provider/azure"
import { Provider } from "@opencode/core/provider"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Session } from "@opencode/core/session"
import { Document, Info } from "@opencode/schema/config"
import { AppProcess } from "@opencode/util/process"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const decodeConfig = Schema.decodeUnknownSync(Info)
const azureID = Integration.ID.make("azure")
const hour = 60 * 60 * 1000
const noResourceEnv = { AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }
const resourceID = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/test-resource"
const managementBearer = "Bearer https://management.azure.com/.default-token"

// Nothing listens here, so tests that are not about deployments never find any.
const offline = { resource: () => "http://127.0.0.1:1/openai", management: "http://127.0.0.1:1" }

const addPlugin = Effect.fn(function* (endpoints = offline) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* make(endpoints).effect(host)
})

const setEnv = (vars: Record<string, string | undefined>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      applyEnv(vars)
      return previous
    }),
    (previous) => Effect.sync(() => applyEnv(previous)),
  )

function applyEnv(vars: Record<string, string | undefined>) {
  Object.entries(vars).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}

type AzureRequest = {
  readonly method: string
  readonly path: string
  readonly origin: string
  readonly key: string | null
  readonly authorization: string | null
}
type Route = (request: AzureRequest) => Response | Promise<Response>

// Answers like Azure: the resource's own deployment list, Resource Graph, and the management API.
const fakeAzure = (routes: { resource?: Route; management?: Route; resources?: () => unknown[] }) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const requests: AzureRequest[] = []
      const server = Bun.serve({
        port: 0,
        fetch: async (raw) => {
          const url = new URL(raw.url)
          const request = {
            method: raw.method,
            path: url.pathname + url.search,
            origin: url.origin,
            key: raw.headers.get("api-key"),
            authorization: raw.headers.get("authorization"),
          }
          requests.push(request)
          if (request.path.startsWith("/openai/deployments")) return routes.resource?.(request) ?? notFound()
          if (request.path.startsWith("/providers/Microsoft.ResourceGraph/")) {
            // The connect form lists every resource; discovery looks up one resource's ID.
            if ((await raw.text()).includes("project resourceName"))
              return routes.resources ? Response.json({ data: routes.resources() }) : unauthorized()
            return Response.json({ data: [{ id: resourceID }] })
          }
          return routes.management?.(request) ?? notFound()
        },
      })
      return { requests, server }
    }),
    ({ server }) => Effect.promise(() => server.stop(true)),
  ).pipe(
    Effect.map(({ requests, server }) => ({
      requests,
      endpoints: { resource: () => `${server.url.origin}/openai`, management: server.url.origin },
    })),
  )

const notFound = () => new Response("Not found", { status: 404 })
const unauthorized = () => new Response("Unauthorized", { status: 401 })
const listed = (id: string, model: string, status = "succeeded") => ({ id, model, status })
const resourceList = (...deployments: unknown[]) => Response.json({ data: deployments })
const managed = (name: string, model: string, provisioningState = "Succeeded") => ({
  name,
  properties: { model: { name: model }, provisioningState },
})
const managementPage = (deployments: unknown[], nextLink?: string) =>
  Response.json({ value: deployments, ...(nextLink === undefined ? {} : { nextLink }) })

const cliToken = (args: readonly string[]) => ({
  accessToken: `${args[args.indexOf("--scope") + 1]}-token`,
  expires_on: Math.floor((Date.now() + hour) / 1000),
})

// The plugin offers the Azure CLI method only when `az` is on PATH, so a stub goes there while the commands it would
// run are answered in process.
const fakeAzureCli = Effect.fn(function* (respond: (args: readonly string[]) => unknown = cliToken) {
  const processes = yield* AppProcess.Service
  const directory = (yield* Location.Service).directory
  const windows = process.platform === "win32"
  const executable = `${directory}/${windows ? "az.cmd" : "az"}`
  yield* Effect.promise(() => Bun.write(executable, windows ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n"))
  yield* Effect.promise(() => chmod(executable, 0o755))
  // The CLI writes its profile with a byte order mark.
  yield* Effect.promise(() =>
    Bun.write(`${directory}/azure/azureProfile.json`, `\uFEFF${JSON.stringify({ subscriptions: [{ id: "sub" }] })}`),
  )
  yield* setEnv({
    PATH: `${directory}${windows ? ";" : ":"}${process.env.PATH}`,
    AZURE_CONFIG_DIR: `${directory}/azure`,
  })
  const commands: string[][] = []
  const fake = AppProcess.Service.of({
    ...processes,
    run: (command) => {
      if (command._tag !== "StandardCommand") return processes.run(command)
      commands.push([...command.args])
      const value = respond(command.args)
      if (value instanceof Error) return Effect.fail(new AppProcess.AppProcessError({ command: "az", cause: value }))
      return Effect.succeed({
        command: `az ${command.args.join(" ")}`,
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify(value)),
        stderr: Buffer.alloc(0),
        stdoutTruncated: false,
        stderrTruncated: false,
      })
    },
  })
  return {
    commands,
    provide: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provideService(AppProcess.Service, fake)),
  }
})

const cliCredential = () =>
  Credential.External.make({
    type: "external",
    methodID: Integration.MethodID.make("azure-cli"),
    metadata: { resourceName: "test-resource" },
  })

const keyCredential = (key = "secret", resourceName = "test-resource") =>
  Credential.Key.make({ type: "key", key, configuration: { resourceName } })

const connect = Effect.fn(function* (value: Credential.Value) {
  const credentials = yield* Credential.Service
  return yield* credentials.create({ integrationID: azureID, value })
})

// Republishing a switch reruns discovery for the connection that is already active.
const announceSwitch = Effect.fn(function* (credentialID: Credential.ID) {
  const bus = yield* Bus.Service
  yield* bus.publish(Credential.Event.Switched, { integrationID: azureID, credentialID }, { global: true })
})

const seedProvider = (settings?: Provider.Settings) =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    yield* catalog.transform((editor) => {
      editor.update(Provider.ID.azure, (provider) => {
        provider.package = "@opencode/ai/providers/azure/responses"
        if (settings) provider.settings = settings
      })
    })
  })

const seedCatalog = Effect.gen(function* () {
  yield* seedProvider()
  const catalog = yield* Provider.Service
  yield* catalog.transform((editor) => {
    editor.models.update(Provider.ID.azure, Model.ID.make("gpt-5"), () => {})
    editor.models.update(Provider.ID.azure, Model.ID.make("gpt-5-mini"), (model) => {
      model.name = "GPT-5 Mini"
      model.limit = { context: 400_000, output: 128_000 }
    })
    editor.models.update(Provider.ID.azure, Model.ID.make("gpt-5-nano"), (model) => {
      model.name = "GPT-5 Nano"
      model.limit = { context: 300_000, output: 64_000 }
    })
    editor.models.update(Provider.ID.azure, Model.ID.make("deepseek-v4-flash"), (model) => {
      model.name = "DeepSeek-V4-Flash"
      model.package = "@opencode/ai/providers/openai-compatible"
      model.settings = { baseURL: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/models" }
    })
  })
})
const catalogIDs = ["deepseek-v4-flash", "gpt-5", "gpt-5-mini", "gpt-5-nano"]

const azureModels = Effect.gen(function* () {
  const models = yield* Model.Service
  return (yield* models.all())
    .filter((model) => model.providerID === Provider.ID.azure)
    .toSorted((a, b) => a.id.localeCompare(b.id))
})
const azureModelIDs = azureModels.pipe(Effect.map((models) => models.map((model): string => model.id)))

const eventually = <A, R>(effect: Effect.Effect<A, never, R>, predicate: (value: A) => boolean) =>
  effect.pipe(
    Effect.filterOrFail(predicate, () => new Error("Timed out waiting for value")),
    Effect.retry({ times: 3000, schedule: Schedule.spaced("1 millis") }),
  )

// Lets a discovery that has received its last answer finish publishing before asserting that nothing changed.
const settle = Effect.promise(() => Bun.sleep(25))

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("AzurePlugin connecting", () => {
  it.effect("hides Azure CLI authentication when the Azure CLI is not installed", () =>
    Effect.gen(function* () {
      yield* setEnv({ PATH: "/nonexistent" })
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect(required(yield* integrations.get(azureID)).methods.some((method) => method.type === "external")).toBe(
        false,
      )
    }),
  )

  it.live("offers the resources the Azure CLI can reach and accepts a typed resource name", () =>
    Effect.gen(function* () {
      yield* setEnv(noResourceEnv)
      const cli = yield* fakeAzureCli()
      const azure = yield* fakeAzure({
        resources: () => [
          { resourceName: "alpha", resourceGroup: "models", location: "eastus" },
          { resourceName: "not a hostname", resourceGroup: "models", location: "eastus" },
          { id: 42 },
        ],
      })
      yield* addPlugin(azure.endpoints).pipe(cli.provide)
      const integrations = yield* Integration.Service
      const field = Effect.gen(function* () {
        const method = required(yield* integrations.get(azureID)).methods.find((method) => method.type === "external")
        const field = method?.type === "external" ? method.form?.[0] : undefined
        return field?.type === "string" ? field : undefined
      })

      const listed = required(yield* eventually(field, (field) => (field?.options?.length ?? 0) > 0))
      expect(listed).toMatchObject({
        key: "resourceName",
        custom: true,
        options: [{ value: "alpha", label: "alpha", description: "models · eastus" }],
      })

      const external = (resourceName: string) =>
        integrations.connection.external({
          integrationID: azureID,
          methodID: Integration.MethodID.make("azure-cli"),
          answer: { resourceName },
        })
      expect(yield* external("not a hostname").pipe(Effect.flip)).toBeInstanceOf(Integration.AuthorizationError)
      yield* external("typed-resource")
      const credentials = yield* Credential.Service
      expect((yield* credentials.list(azureID)).map((item) => item.value)).toEqual([
        Credential.External.make({
          type: "external",
          methodID: Integration.MethodID.make("azure-cli"),
          metadata: { resourceName: "typed-resource" },
        }),
      ])
    }),
  )

  it.effect("moves Azure CLI connections saved as OAuth credentials to external credentials", () =>
    Effect.gen(function* () {
      yield* setEnv({ PATH: "/nonexistent" })
      yield* seedProvider()
      const legacy = yield* connect(
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("azure-cli"),
          access: "stored-token",
          refresh: "azure-cli",
          expires: Date.now() + hour,
          metadata: { resourceName: "test-resource" },
        }),
      )
      yield* addPlugin()

      const credentials = yield* Credential.Service
      expect(required(yield* credentials.get(legacy.id)).value).toEqual(cliCredential())
      const providers = yield* Provider.Service
      expect(required(yield* providers.get(Provider.ID.azure)).settings?.resourceName).toBe("test-resource")
    }),
  )
})

describe("AzurePlugin startup", () => {
  it.live("starts without calling Azure, then lists deployments", () =>
    Effect.gen(function* () {
      const cli = yield* fakeAzureCli()
      const azure = yield* fakeAzure({ management: () => managementPage([managed("gpt-5-mini", "gpt-5-mini")]) })
      yield* seedCatalog
      yield* connect(cliCredential())
      yield* addPlugin(azure.endpoints).pipe(cli.provide)

      expect(cli.commands).toEqual([])
      expect(azure.requests).toEqual([])
      const providers = yield* Provider.Service
      expect(required(yield* providers.get(Provider.ID.azure)).settings?.resourceName).toBe("test-resource")
      expect(yield* azureModelIDs).toEqual(catalogIDs)

      yield* eventually(azureModelIDs, (ids) => ids.length === 1)
      expect(yield* azureModelIDs).toEqual(["gpt-5-mini"])
    }),
  )
})

describe("AzurePlugin discovery", () => {
  it.live("shows the deployments listed with an API key, named after the deployment", () =>
    Effect.gen(function* () {
      yield* setEnv(noResourceEnv)
      const azure = yield* fakeAzure({
        resource: (request) =>
          request.key === "secret"
            ? resourceList(
                listed("gpt-5-mini", "gpt-5-mini"),
                listed("prod-mini", "gpt-5-mini"),
                // Azure compares names without case and may return another case than the one created.
                listed("GPT-5-Nano", "gpt-5-nano"),
                // A deployment named after another model is still the model it deploys.
                listed("gpt-5", "gpt-5-mini"),
                // Azure's model name differs from the catalog, as with `gpt-4` for GPT-4 Turbo.
                listed("deepseek-v4-flash", "DeepSeek-V4-Flash-2026"),
                listed("ft-legal", "gpt-4o-mini.ft-123"),
                listed("pending", "gpt-5", "creating"),
                { id: 42 },
              )
            : unauthorized(),
      })
      yield* seedCatalog
      yield* connect(keyCredential())
      yield* addPlugin(azure.endpoints)

      const deployed = yield* eventually(azureModels, (list) => list.length === 5)
      expect(
        deployed.map((model): [string, string | undefined, string, number] => [
          model.id,
          model.modelID,
          model.name,
          model.limit.context,
        ]),
      ).toEqual([
        ["deepseek-v4-flash", "deepseek-v4-flash", "DeepSeek-V4-Flash", 200_000],
        ["gpt-5", "gpt-5", "GPT-5 Mini (gpt-5)", 400_000],
        ["gpt-5-mini", "gpt-5-mini", "GPT-5 Mini", 400_000],
        ["gpt-5-nano", "GPT-5-Nano", "GPT-5 Nano", 300_000],
        ["prod-mini", "prod-mini", "GPT-5 Mini (prod-mini)", 400_000],
      ])
      // The resource name entered with the API key reaches catalog endpoints, not only the request route.
      expect(deployed[0]?.settings?.baseURL).toBe("https://test-resource.services.ai.azure.com/models")
    }),
  )

  it.live("lists Azure CLI deployments through the management API before the resource's own list", () =>
    Effect.gen(function* () {
      const cli = yield* fakeAzureCli()
      const azure = yield* fakeAzure({
        resource: () => resourceList(listed("from-resource", "gpt-5-nano")),
        management: (request) =>
          request.authorization === managementBearer
            ? managementPage([managed("gpt-production", "gpt-5-mini"), managed("gpt-5-nano", "gpt-5-nano", "Failed")])
            : unauthorized(),
      })
      yield* seedCatalog
      yield* connect(cliCredential())
      yield* addPlugin(azure.endpoints).pipe(cli.provide)

      const deployed = yield* eventually(azureModels, (list) => list.length === 1)
      expect(deployed.map((model) => [model.id, model.name])).toEqual([
        ["gpt-production", "GPT-5 Mini (gpt-production)"],
      ])
    }),
  )

  it.live("falls back to the resource's own list when the Azure CLI cannot read the management API", () =>
    Effect.gen(function* () {
      const cli = yield* fakeAzureCli()
      const azure = yield* fakeAzure({
        resource: (request) =>
          request.authorization === "Bearer https://cognitiveservices.azure.com/.default-token"
            ? resourceList(listed("gpt-5-mini", "gpt-5-mini"))
            : unauthorized(),
      })
      yield* seedCatalog
      yield* connect(cliCredential())
      yield* addPlugin(azure.endpoints).pipe(cli.provide)

      yield* eventually(azureModelIDs, (ids) => ids.length === 1)
      expect(yield* azureModelIDs).toEqual(["gpt-5-mini"])
    }),
  )

  it.live("keeps the catalog for a custom endpoint without listing deployments", () =>
    Effect.gen(function* () {
      const azure = yield* fakeAzure({ resource: () => resourceList(listed("gpt-5-mini", "gpt-5-mini")) })
      yield* seedCatalog
      yield* seedProvider({ baseURL: "https://gateway.example/azure" })
      yield* connect(keyCredential())
      yield* addPlugin(azure.endpoints)

      yield* Effect.promise(() => Bun.sleep(50))
      expect(azure.requests).toEqual([])
      expect(yield* azureModelIDs).toEqual(catalogIDs)
    }),
  )

  it.live("publishes the management list only after its last page", () =>
    Effect.gen(function* () {
      const cli = yield* fakeAzureCli()
      const lastPage = Promise.withResolvers<Response>()
      const asked = Promise.withResolvers<void>()
      const azure = yield* fakeAzure({
        management: (request) => {
          if (!request.path.startsWith("/page-2"))
            return managementPage([managed("mini", "gpt-5-mini")], `${request.origin}/page-2`)
          asked.resolve()
          return lastPage.promise
        },
      })
      yield* seedCatalog
      yield* connect(cliCredential())
      yield* addPlugin(azure.endpoints).pipe(cli.provide)

      yield* Effect.promise(() => asked.promise)
      expect(yield* azureModelIDs).toEqual(catalogIDs)
      lastPage.resolve(managementPage([managed("nano", "gpt-5-nano")]))
      yield* eventually(azureModelIDs, (ids) => ids.length === 2)
      expect(yield* azureModelIDs).toEqual(["mini", "nano"])
    }),
  )

  it.live("keeps the last complete list when a later page fails", () =>
    Effect.gen(function* () {
      const cli = yield* fakeAzureCli()
      const state = { paged: false }
      const fellBack = Promise.withResolvers<void>()
      const azure = yield* fakeAzure({
        resource: () => {
          fellBack.resolve()
          return notFound()
        },
        management: (request) => {
          if (request.path.startsWith("/page-2")) return new Response("Unavailable", { status: 503 })
          if (state.paged) return managementPage([managed("nano", "gpt-5-nano")], `${request.origin}/page-2`)
          return managementPage([managed("mini", "gpt-5-mini")])
        },
      })
      yield* seedCatalog
      const credential = yield* connect(cliCredential())
      yield* addPlugin(azure.endpoints).pipe(cli.provide)
      yield* eventually(azureModelIDs, (ids) => ids.length === 1)

      state.paged = true
      yield* announceSwitch(credential.id)
      yield* Effect.promise(() => fellBack.promise)
      yield* settle
      expect(yield* azureModelIDs).toEqual(["mini"])
    }),
  )

  // The test harness fails any request to a non-local host, so following the link would fail the test.
  it.live("never sends the management token to a page link outside the management endpoint", () =>
    Effect.gen(function* () {
      const cli = yield* fakeAzureCli()
      const fellBack = Promise.withResolvers<void>()
      const azure = yield* fakeAzure({
        resource: () => {
          fellBack.resolve()
          return notFound()
        },
        management: () => managementPage([managed("mini", "gpt-5-mini")], "https://attacker.example/page-2"),
      })
      yield* seedCatalog
      yield* connect(cliCredential())
      yield* addPlugin(azure.endpoints).pipe(cli.provide)

      yield* Effect.promise(() => fellBack.promise)
      yield* settle
      expect(yield* azureModelIDs).toEqual(catalogIDs)
    }),
  )

  it.live("keeps a model that is configured explicitly", () =>
    Effect.gen(function* () {
      const azure = yield* fakeAzure({ resource: () => resourceList(listed("gpt-5-mini", "gpt-5-mini")) })
      yield* seedCatalog
      yield* connect(keyCredential())
      yield* addPlugin(azure.endpoints)
      const plugin = yield* Plugin.Service
      yield* ConfigProviderPlugin.Plugin.effect(yield* PluginHost.make(plugin)).pipe(
        Effect.provide(
          Config.testLayer([
            new Document({
              type: "document",
              info: decodeConfig({
                providers: { azure: { models: { "gpt-5-nano": { modelID: "nano-production" } } } },
              }),
            }),
          ]),
        ),
      )

      const deployed = yield* eventually(azureModels, (list) => list.length === 2)
      expect(
        deployed.map((model): [string, string | undefined, number] => [model.id, model.modelID, model.limit.context]),
      ).toEqual([
        ["gpt-5-mini", "gpt-5-mini", 400_000],
        ["gpt-5-nano", "nano-production", 300_000],
      ])
    }),
  )
})

describe("AzurePlugin switching accounts", () => {
  it.live("shows the new account without waiting for the previous account's discovery", () =>
    Effect.gen(function* () {
      const stuck = Promise.withResolvers<Response>()
      const calls = { count: 0 }
      const azure = yield* fakeAzure({
        resource: (request) => {
          calls.count++
          if (calls.count === 2) return stuck.promise
          return resourceList(listed(request.key === "secret" ? "production-a" : "production-b", "gpt-5-mini"))
        },
      })
      yield* seedCatalog
      const first = yield* connect(keyCredential())
      yield* addPlugin(azure.endpoints)
      yield* eventually(azureModelIDs, (ids) => ids.includes("production-a"))

      // Start a discovery for the first account that Azure never answers.
      yield* announceSwitch(first.id)
      yield* eventually(
        Effect.sync(() => calls.count),
        (count) => count === 2,
      )
      yield* connect(keyCredential("other-key", "other-resource"))

      const deployed = yield* eventually(azureModels, (list) => list.length === 1 && list[0]?.id === "production-b")
      expect(deployed[0]?.settings?.resourceName).toBe("other-resource")

      // The interrupted discovery never publishes the previous account's late answer.
      stuck.resolve(resourceList(listed("stale", "gpt-5-nano")))
      yield* settle
      expect(yield* azureModelIDs).toEqual(["production-b"])
    }),
  )
})

describe("AzurePlugin requests", () => {
  it.live("authorizes Azure, Foundry, and WebSocket requests with a token for their audience", () =>
    Effect.gen(function* () {
      const cli = yield* fakeAzureCli()
      yield* connect(cliCredential())
      yield* addPlugin().pipe(cli.provide)
      const hooks = yield* PluginHooks.Service
      const context = {
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.azure, id: Model.ID.make("gpt-5-mini") }),
        kind: "primary" as const,
      }

      const azure = yield* hooks.trigger("session", "http.request", {
        ...context,
        sessionID: Session.ID.make("ses_azure"),
        request: new Request("https://test-resource.openai.azure.com/openai/v1/responses", {
          headers: { "api-key": "stored-token", "x-keep": "yes" },
        }),
      })
      expect(azure.request.headers.get("authorization")).toBe(
        "Bearer https://cognitiveservices.azure.com/.default-token",
      )
      expect(azure.request.headers.has("api-key")).toBe(false)
      expect(azure.request.headers.get("x-keep")).toBe("yes")

      const foundry = yield* hooks.trigger("session", "http.request", {
        ...context,
        sessionID: Session.ID.make("ses_foundry"),
        request: new Request("https://test-resource.services.ai.azure.com/anthropic/v1/messages", {
          headers: { "x-api-key": "stored-token" },
        }),
      })
      expect(foundry.request.headers.get("authorization")).toBe("Bearer https://ai.azure.com/.default-token")
      expect(foundry.request.headers.has("x-api-key")).toBe(false)

      const handshake = yield* hooks.trigger("session", "experimental.ws.handshake", {
        ...context,
        sessionID: Session.ID.make("ses_azure_ws"),
        url: "wss://test-resource.openai.azure.com/openai/v1/responses",
        headers: { "api-key": "stored-token", "x-keep": "yes" },
      })
      expect(handshake.headers).toMatchObject({
        authorization: "Bearer https://cognitiveservices.azure.com/.default-token",
        "x-keep": "yes",
      })
      expect(handshake.headers).not.toHaveProperty("api-key")
    }),
  )
})

describe("AzurePlugin resource name", () => {
  const cases = [
    { name: "reads AZURE_RESOURCE_NAME", env: { AZURE_RESOURCE_NAME: "from-env" }, expected: "from-env" },
    {
      name: "reads the legacy AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
      env: { AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "legacy-resource" },
      expected: "legacy-resource",
    },
    {
      name: "prefers configuration over the environment",
      env: { AZURE_RESOURCE_NAME: "from-env" },
      settings: { resourceName: "from-config" },
      expected: "from-config",
    },
    {
      name: "ignores a whitespace configured name",
      env: { AZURE_RESOURCE_NAME: "from-env" },
      settings: { resourceName: "   " },
      expected: "from-env",
    },
    {
      name: "prefers the connection's resource over configuration, as requests do",
      env: { AZURE_RESOURCE_NAME: "from-env" },
      settings: { resourceName: "from-config" },
      credential: keyCredential(),
      expected: "test-resource",
    },
    {
      name: "reads the resource of an API key imported from V1",
      env: { AZURE_RESOURCE_NAME: "from-env" },
      credential: Credential.Key.make({ type: "key", key: "secret", metadata: { resourceName: "imported-resource" } }),
      expected: "imported-resource",
    },
  ]

  cases.forEach((item) =>
    it.effect(item.name, () =>
      Effect.gen(function* () {
        yield* setEnv(item.env)
        yield* seedProvider(item.settings)
        const providers = yield* Provider.Service
        yield* providers.transform((editor) => editor.update(Provider.ID.openai, () => {}))
        if (item.credential) yield* connect(item.credential)
        yield* addPlugin()

        expect(required(yield* providers.get(Provider.ID.azure)).settings?.resourceName).toBe(item.expected)
        expect(required(yield* providers.get(Provider.ID.openai)).settings?.resourceName).toBeUndefined()
      }),
    ),
  )

  it.effect("expands provider and model resource URLs", () =>
    Effect.gen(function* () {
      yield* setEnv({ AZURE_RESOURCE_NAME: "from-env", AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "legacy-env" })
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.azure, (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.activation = "enabled"
          provider.settings = {
            baseURL: "https://${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}.cognitiveservices.azure.com/openai",
          }
        })
        editor.models.update(Provider.ID.azure, Model.ID.make("anthropic"), (model) => {
          model.package = "@opencode/ai/providers/anthropic"
          model.settings = {
            resourceName: "model-resource",
            baseURL: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1",
          }
        })
      })
      yield* addPlugin()

      expect(required(yield* providers.get(Provider.ID.azure)).settings).toMatchObject({
        resourceName: "from-env",
        baseURL: "https://from-env.cognitiveservices.azure.com/openai",
      })
      expect(required(yield* models.get(Provider.ID.azure, Model.ID.make("anthropic"))).settings).toMatchObject({
        resourceName: "model-resource",
        baseURL: "https://model-resource.services.ai.azure.com/anthropic/v1",
      })
    }),
  )
})

describe("AzurePlugin transport", () => {
  it.effect("prefers WebSockets on the provider for the Azure Responses API only", () =>
    Effect.gen(function* () {
      yield* setEnv(noResourceEnv)
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const variants: Record<string, (model: Model.MutableInfo) => void> = {
        responses: () => {},
        chat: (model) => {
          model.package = "@opencode/ai/providers/azure/chat"
        },
        preview: (model) => {
          model.settings = { apiVersion: "2025-04-01-preview" }
        },
        "deployment-url": (model) => {
          model.settings = { useDeploymentBasedUrls: true }
        },
        gateway: (model) => {
          model.settings = { baseURL: "https://gateway.example/azure" }
        },
        "non-azure": (model) => {
          model.package = "@opencode/ai/providers/anthropic"
        },
      }
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.azure, (provider) => {
          provider.package = "@opencode/ai/providers/azure/responses"
          provider.activation = "enabled"
        })
        Object.entries(variants).forEach(([id, update]) =>
          editor.models.update(Provider.ID.azure, Model.ID.make(id), update),
        )
      })
      yield* addPlugin()

      expect(required(yield* providers.get(Provider.ID.azure)).settings?.transport).toBe("websocket")
      const transports = yield* Effect.forEach(Object.keys(variants), (id) =>
        models
          .get(Provider.ID.azure, Model.ID.make(id))
          .pipe(Effect.map((model) => required(model).settings?.transport)),
      )
      expect(transports.every((transport) => transport === undefined)).toBe(true)
    }),
  )
})
