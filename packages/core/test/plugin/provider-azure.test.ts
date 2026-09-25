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

// Nothing listens here, so tests that are not about deployments never find any.
const offline = { resource: () => "http://127.0.0.1:1/openai", management: "http://127.0.0.1:1" }

const addPlugin = Effect.fn(function* (endpoints = offline) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* make(endpoints).effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function eventually<A, R>(
  effect: Effect.Effect<A, never, R>,
  predicate: (value: A) => boolean,
  remaining = 3000,
): Effect.Effect<A, Error, R> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

type AzureRequest = {
  readonly method: string
  readonly path: string
  readonly key: string | null
  readonly authorization: string | null
  readonly body: string
}

function withAzure<A, E, R>(
  respond: (request: AzureRequest) => Response | Promise<Response>,
  fx: (input: { endpoints: typeof offline; requests: AzureRequest[] }) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const requests: AzureRequest[] = []
      const server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const url = new URL(request.url)
          const received = {
            method: request.method,
            path: url.pathname + url.search,
            key: request.headers.get("api-key"),
            authorization: request.headers.get("authorization"),
            body: await request.text(),
          }
          requests.push(received)
          return respond(received)
        },
      })
      return { requests, server }
    }),
    ({ requests, server }) =>
      fx({
        requests,
        endpoints: { resource: () => `${server.url.origin}/openai`, management: server.url.origin },
      }),
    ({ server }) => Effect.promise(() => server.stop(true)),
  )
}

const seedCatalog = Effect.gen(function* () {
  const catalog = yield* Provider.Service
  yield* catalog.transform((editor) => {
    editor.update(Provider.ID.azure, (provider) => {
      provider.package = "@opencode/ai/providers/azure/responses"
    })
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

const azureModels = Effect.gen(function* () {
  const models = yield* Model.Service
  return (yield* models.all())
    .filter((model) => model.providerID === Provider.ID.azure)
    .toSorted((a, b) => a.id.localeCompare(b.id))
})

const cliTokens = (args: readonly string[]) => ({
  accessToken: `${args[args.indexOf("--scope") + 1]}-token`,
  expires_on: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
})

const account = (name: string) => ({
  id: `/subscriptions/sub/resourceGroups/rg-${name}/providers/Microsoft.CognitiveServices/accounts/${name}`,
  resourceName: name,
  resourceGroup: `rg-${name}`,
  location: "swedencentral",
})

function withEnv<A, E, R>(vars: Record<string, string | undefined>, fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    fx,
    (previous) =>
      Effect.sync(() => {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        })
      }),
  )
}

function withAzureCommands<A, E, R>(run: (args: readonly string[]) => unknown, fx: () => Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const processes = yield* AppProcess.Service
    const directory = (yield* Location.Service).directory
    const executable = `${directory}/${process.platform === "win32" ? "az.cmd" : "az"}`
    yield* Effect.promise(() =>
      Bun.write(executable, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n"),
    )
    yield* Effect.promise(() => chmod(executable, 0o755))
    const fake = AppProcess.Service.of({
      ...processes,
      run: (command) => {
        if (command._tag !== "StandardCommand") return processes.run(command)
        const value = run(command.args)
        if (value instanceof Error) {
          return Effect.fail(new AppProcess.AppProcessError({ command: "az", cause: value }))
        }
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
    return yield* withEnv(
      {
        PATH: `${directory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      },
      () => fx().pipe(Effect.provideService(AppProcess.Service, fake)),
    )
  })
}

const azureCredential = Effect.gen(function* () {
  const credentials = yield* Credential.Service
  return yield* credentials.create({
    integrationID: Integration.ID.make("azure"),
    value: Credential.OAuth.make({
      type: "oauth",
      methodID: Integration.MethodID.make("azure-cli"),
      access: "stored-token",
      refresh: "azure-cli",
      expires: Date.now() + 60 * 60 * 1000,
      metadata: { resourceName: "test-resource" },
    }),
  })
})

const keyCredential = Effect.gen(function* () {
  const credentials = yield* Credential.Service
  return yield* credentials.create({
    integrationID: Integration.ID.make("azure"),
    value: Credential.Key.make({ type: "key", key: "secret", configuration: { resourceName: "test-resource" } }),
  })
})

describe("AzurePlugin", () => {
  it.effect("registers a resource name form when the environment does not provide one", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(Integration.ID.make("azure")))?.methods).toContainEqual({
          type: "key",
          label: "API key",
          form: [
            {
              type: "string",
              key: "resourceName",
              title: "Enter Azure Resource Name",
              placeholder: "e.g. my-models",
              required: true,
            },
          ],
        })
      }),
    ),
  )

  it.effect("hides Azure CLI authentication when the Azure CLI is not installed", () =>
    withEnv({ PATH: "/nonexistent" }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integration = yield* (yield* Integration.Service).get(Integration.ID.make("azure"))
        expect(integration?.methods.some((method) => method.type === "oauth")).toBe(false)
      }),
    ),
  )

  it.live("registers Azure CLI authentication alongside API keys", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      withAzureCommands(
        () => [],
        () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const integration = yield* (yield* Integration.Service).get(Integration.ID.make("azure"))
            expect(integration?.methods).toContainEqual({
              id: Integration.MethodID.make("azure-cli"),
              type: "oauth",
              label: "Microsoft Entra ID (Azure CLI)",
              form: [
                {
                  type: "string",
                  key: "resourceName",
                  title: "Enter Azure Resource Name",
                  description: "Leave empty to use the resource of your Azure CLI session",
                  placeholder: "e.g. my-models",
                  required: false,
                },
              ],
            })
          }),
      ),
    ),
  )

  it.live("does not invoke Azure CLI at startup without an Azure connection", () => {
    const commands: string[] = []
    return withEnv(
      {
        AZURE_RESOURCE_NAME: undefined,
        AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined,
      },
      () =>
        withAzureCommands(
          (args) => {
            commands.push(args.join(" "))
            return []
          },
          () =>
            Effect.gen(function* () {
              yield* addPlugin()
              expect(commands).toEqual([])
              const integration = yield* (yield* Integration.Service).get(Integration.ID.make("azure"))
              expect(integration?.methods.some((method) => method.type === "oauth")).toBe(true)
            }),
        ),
    )
  })

  it.live("connects with the Azure CLI and accepts legacy token expiration", () => {
    const commands: string[][] = []
    return withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      withAzureCommands(
        (args) => {
          commands.push([...args])
          return {
            accessToken: "legacy-cli-token",
            expiresOn: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }
        },
        () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const integrations = yield* Integration.Service
            const integrationID = Integration.ID.make("azure")
            const attempt = yield* integrations.oauth.connect({
              integrationID,
              methodID: Integration.MethodID.make("azure-cli"),
              answer: { resourceName: "test-resource" },
            })
            yield* Effect.gen(function* () {
              const status = yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })
              if (status.status !== "complete") return yield* Effect.fail(new Error("Azure CLI authorization pending"))
            }).pipe(Effect.retry({ times: 1500, schedule: Schedule.spaced("1 millis") }))

            const credential = (yield* (yield* Credential.Service).list(integrationID))[0]?.value
            expect(credential).toMatchObject({
              type: "oauth",
              access: "legacy-cli-token",
              metadata: { resourceName: "test-resource" },
            })
            expect(commands).toEqual([
              [
                "account",
                "get-access-token",
                "--scope",
                "https://cognitiveservices.azure.com/.default",
                "--output",
                "json",
              ],
            ])
          }),
      ),
    )
  })

  it.live("does not invoke Azure CLI at startup with an existing connection", () => {
    const commands: string[][] = []
    return withAzureCommands(
      (args) => {
        commands.push([...args])
        return []
      },
      () =>
        withAzure(
          () => Response.json({ data: [{ id: "gpt-5-mini", model: "gpt-5-mini", status: "succeeded" }] }),
          ({ endpoints, requests }) =>
            Effect.gen(function* () {
              const catalog = yield* Provider.Service
              const models = yield* Model.Service
              yield* seedCatalog
              yield* azureCredential
              yield* addPlugin(endpoints)

              // Startup serves the whole catalog; the deployments arrive afterwards without blocking it.
              expect(commands).toEqual([])
              expect(requests).toEqual([])
              expect((yield* catalog.get(Provider.ID.azure))?.settings?.resourceName).toBe("test-resource")
              expect(yield* models.get(Provider.ID.azure, Model.ID.make("gpt-5-mini"))).toBeDefined()
              expect(yield* models.get(Provider.ID.azure, Model.ID.make("gpt-5-nano"))).toBeDefined()

              const deployed = yield* eventually(azureModels, (list) => list.length === 1)
              expect(deployed.map((model) => model.id)).toEqual([Model.ID.make("gpt-5-mini")])
              expect(requests).toEqual([
                {
                  method: "GET",
                  path: "/openai/deployments?api-version=2022-12-01",
                  key: null,
                  authorization: "Bearer stored-token",
                  body: "",
                },
              ])
              expect(commands).toEqual([])
            }),
        ),
    )
  })

  it.live("does not refresh an expired Azure CLI token while starting", () => {
    const commands: string[][] = []
    return withAzureCommands(
      (args) => {
        commands.push([...args])
        return { accessToken: "refreshed-token", expires_on: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) }
      },
      () =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("azure"),
            value: Credential.OAuth.make({
              type: "oauth",
              methodID: Integration.MethodID.make("azure-cli"),
              access: "expired-token",
              refresh: "azure-cli",
              expires: Date.now() - 60 * 60 * 1000,
              metadata: { resourceName: "test-resource" },
            }),
          })
          const catalog = yield* Provider.Service
          yield* catalog.transform((editor) => {
            editor.update(Provider.ID.azure, (provider) => {
              provider.package = "@opencode/ai/providers/azure/responses"
            })
          })
          yield* addPlugin()

          expect(commands).toEqual([])
          expect((yield* catalog.get(Provider.ID.azure))?.settings?.resourceName).toBe("test-resource")
        }),
    )
  })

  it.live("narrows the catalog to the deployments listed with an API key", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      withAzure(
        () =>
          Response.json({
            data: [
              { id: "gpt-5-mini-eu", model: "gpt-5-mini", status: "succeeded" },
              { id: "gpt-5-mini", model: "gpt-5-mini", status: "succeeded" },
              { id: "nano-b", model: "gpt-5-nano", status: "succeeded" },
              { id: "nano-a", model: "gpt-5-nano", status: "succeeded" },
              { id: "DeepSeek-V4-Flash", model: "DeepSeek-V4-Flash", status: "succeeded" },
              { id: "gpt-5-pending", model: "gpt-5", status: "creating" },
              { id: "fine-tuned", model: "gpt-4o-mini.ft-123", status: "succeeded" },
              { id: 42 },
            ],
          }),
        ({ endpoints, requests }) =>
          Effect.gen(function* () {
            const catalog = yield* Provider.Service
            yield* seedCatalog
            yield* keyCredential
            yield* addPlugin(endpoints)

            const deployed = yield* eventually(azureModels, (list) => list.length === 5)
            expect(deployed.map((model) => [model.id, model.modelID, model.name])).toEqual([
              [Model.ID.make("deepseek-v4-flash"), Model.ID.make("DeepSeek-V4-Flash"), "DeepSeek-V4-Flash"],
              // The deployment named after its model keeps the model ID even though Azure listed another first.
              [Model.ID.make("gpt-5-mini"), Model.ID.make("gpt-5-mini"), "GPT-5 Mini"],
              [Model.ID.make("gpt-5-mini-eu"), Model.ID.make("gpt-5-mini-eu"), "GPT-5 Mini (gpt-5-mini-eu)"],
              // Custom deployment IDs are stable independently of the other deployments of the same model.
              [Model.ID.make("nano-a"), Model.ID.make("nano-a"), "GPT-5 Nano (nano-a)"],
              [Model.ID.make("nano-b"), Model.ID.make("nano-b"), "GPT-5 Nano (nano-b)"],
            ])
            // A further deployment of a model keeps the catalog facts of that model.
            expect(deployed[2]?.limit).toEqual({ context: 400_000, output: 128_000 })
            // The resource name entered with the API key reaches catalog endpoints, not only the request route.
            expect(deployed[0]?.settings?.baseURL).toBe("https://test-resource.services.ai.azure.com/models")
            expect((yield* catalog.get(Provider.ID.azure))?.settings?.resourceName).toBe("test-resource")
            expect(requests).toEqual([
              {
                method: "GET",
                path: "/openai/deployments?api-version=2022-12-01",
                key: "secret",
                authorization: null,
                body: "",
              },
            ])
          }),
      ),
    ),
  )

  it.live("lists deployments through the management API when the resource does not", () => {
    const commands: string[][] = []
    const resource = account("test-resource")
    return withAzureCommands(
      (args) => {
        commands.push([...args])
        return cliTokens(args)
      },
      () =>
        withAzure(
          (request) => {
            if (request.path.startsWith("/openai/deployments"))
              return new Response("Resource not found", { status: 404 })
            if (request.path.startsWith("/providers/Microsoft.ResourceGraph/resources"))
              return Response.json({ data: [resource] })
            return Response.json({
              value: [
                {
                  name: "gpt-production",
                  properties: { model: { format: "OpenAI", name: "gpt-5-mini" }, provisioningState: "Succeeded" },
                },
                {
                  name: "gpt-5-nano",
                  properties: { model: { format: "OpenAI", name: "gpt-5-nano" }, provisioningState: "Failed" },
                },
              ],
            })
          },
          ({ endpoints, requests }) =>
            Effect.gen(function* () {
              yield* seedCatalog
              yield* azureCredential
              yield* addPlugin(endpoints)

              const deployed = yield* eventually(azureModels, (list) => list.length === 1)
              expect(deployed.map((model) => [model.id, model.modelID])).toEqual([
                [Model.ID.make("gpt-production"), Model.ID.make("gpt-production")],
              ])
              expect(commands).toEqual([
                ["account", "get-access-token", "--scope", "https://management.azure.com/.default", "--output", "json"],
              ])
              expect(requests.slice(1).map((request) => [request.method, request.path, request.authorization])).toEqual(
                [
                  [
                    "POST",
                    "/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01",
                    "Bearer https://management.azure.com/.default-token",
                  ],
                  [
                    "GET",
                    `${resource.id}/deployments?api-version=2024-10-01`,
                    "Bearer https://management.azure.com/.default-token",
                  ],
                ],
              )
              expect(requests[1]?.body).toContain("resourceName =~ 'test-resource'")
            }),
        ),
    )
  })

  it.live("keeps the catalog when deployments cannot be listed", () =>
    withAzure(
      () => new Response("Unavailable", { status: 503 }),
      ({ endpoints, requests }) =>
        Effect.gen(function* () {
          yield* seedCatalog
          yield* keyCredential
          yield* addPlugin(endpoints)

          yield* eventually(Effect.succeed(requests), (list) => list.length === 1)
          yield* Effect.promise(() => Bun.sleep(25))
          expect((yield* azureModels).map((model) => model.id)).toEqual([
            Model.ID.make("deepseek-v4-flash"),
            Model.ID.make("gpt-5"),
            Model.ID.make("gpt-5-mini"),
            Model.ID.make("gpt-5-nano"),
          ])
        }),
    ),
  )

  it.live("keeps the listed deployments while the Azure CLI cannot refresh its token", () => {
    const commands: string[][] = []
    return withAzureCommands(
      (args) => {
        commands.push([...args])
        return new Error("az: please run 'az login' to setup account")
      },
      () =>
        withAzure(
          () => Response.json({ data: [{ id: "gpt-5-mini", model: "gpt-5-mini", status: "succeeded" }] }),
          ({ endpoints }) =>
            Effect.gen(function* () {
              const credentials = yield* Credential.Service
              const bus = yield* Bus.Service
              yield* seedCatalog
              const credential = yield* azureCredential
              yield* addPlugin(endpoints)
              yield* eventually(azureModels, (list) => list.length === 1)

              // A failed refresh of the same account retains its last successful inventory.
              yield* credentials.update(credential.id, {
                value: Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("azure-cli"),
                  access: "expired-token",
                  refresh: "azure-cli",
                  expires: Date.now() - 60 * 60 * 1000,
                  metadata: { resourceName: "test-resource" },
                }),
              })
              yield* bus.publish(
                Credential.Event.Switched,
                { integrationID: Integration.ID.make("azure"), credentialID: credential.id },
                { global: true },
              )
              yield* eventually(Effect.succeed(commands), (list) => list.length > 0)
              yield* Effect.promise(() => Bun.sleep(25))

              expect((yield* azureModels).map((model) => model.id)).toEqual([Model.ID.make("gpt-5-mini")])
            }),
        ),
    )
  })

  it.live("hides the previous account's inventory while its refresh is in flight", () => {
    const pending = Promise.withResolvers<Response>()
    const calls: AzureRequest[] = []
    return withAzure(
      (request) => {
        calls.push(request)
        if (calls.length === 2) return pending.promise
        return Response.json({
          data: [
            {
              id: request.key === "secret" ? "production-a" : "production-b",
              model: "gpt-5-mini",
              status: "succeeded",
            },
          ],
        })
      },
      ({ endpoints }) =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const credentials = yield* Credential.Service
          const providers = yield* Provider.Service
          yield* seedCatalog
          const first = yield* keyCredential
          yield* addPlugin(endpoints)
          const previous = yield* eventually(azureModels, (list) => list.some((model) => model.id === "production-a"))

          yield* bus.publish(
            Credential.Event.Switched,
            { integrationID: Integration.ID.make("azure"), credentialID: first.id },
            { global: true },
          )
          yield* eventually(Effect.succeed(calls), (list) => list.length === 2)
          const next = yield* credentials.create({
            integrationID: Integration.ID.make("azure"),
            value: Credential.Key.make({
              type: "key",
              key: "other-key",
              configuration: { resourceName: "other-resource" },
            }),
          })
          expect(yield* azureModels).toEqual([])
          expect((yield* providers.available()).some((provider) => provider.id === Provider.ID.azure)).toBe(false)

          pending.resolve(Response.json({ data: [{ id: "stale", model: "gpt-5-nano", status: "succeeded" }] }))
          const deployed = yield* eventually(azureModels, (list) => list.length === 1 && list[0]?.id === "production-b")
          expect(deployed[0]?.settings?.resourceName).toBe("other-resource")
          expect((yield* providers.snapshot()).records.get(Provider.ID.azure)?.sourceConnection).toMatchObject({
            type: "credential",
            id: next.id,
          })
          expect(previous.map((model) => model.id)).toEqual([Model.ID.make("production-a")])
        }),
    )
  })

  it.live("keeps deployment IDs when another deployment of the same model is removed", () => {
    const inventory = { names: ["nano-a", "nano-b"] }
    return withAzure(
      () => Response.json({ data: inventory.names.map((id) => ({ id, model: "gpt-5-nano", status: "succeeded" })) }),
      ({ endpoints }) =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          yield* seedCatalog
          const credential = yield* keyCredential
          yield* addPlugin(endpoints)
          const before = yield* eventually(azureModels, (list) => list.length === 2)
          expect(before.map((model) => model.id)).toEqual([Model.ID.make("nano-a"), Model.ID.make("nano-b")])

          inventory.names = ["nano-b"]
          yield* bus.publish(
            Credential.Event.Switched,
            { integrationID: Integration.ID.make("azure"), credentialID: credential.id },
            { global: true },
          )
          const after = yield* eventually(azureModels, (list) => list.length === 1)
          expect(after).toEqual([before[1]])
        }),
    )
  })

  it.live("loads all management deployment pages before publishing the inventory", () => {
    const pending = Promise.withResolvers<Response>()
    const state = { url: "" }
    return withAzureCommands(cliTokens, () =>
      withAzure(
        (request) => {
          if (request.path.startsWith("/openai/deployments")) return new Response("Not found", { status: 404 })
          if (request.method === "POST") return Response.json({ data: [account("test-resource")] })
          if (request.path === "/page-2") return pending.promise
          return Response.json({
            nextLink: `${state.url}/page-2`,
            value: [{ name: "mini", properties: { model: { name: "gpt-5-mini" }, provisioningState: "Succeeded" } }],
          })
        },
        ({ endpoints, requests }) =>
          Effect.gen(function* () {
            state.url = endpoints.management
            yield* seedCatalog
            yield* azureCredential
            yield* addPlugin(endpoints)
            yield* eventually(Effect.succeed(requests), (list) => list.length === 4)
            expect(requests[3]).toMatchObject({
              path: "/page-2",
              authorization: "Bearer https://management.azure.com/.default-token",
            })
            expect(yield* azureModels).toHaveLength(4)
            pending.resolve(
              Response.json({
                value: [
                  { name: "nano", properties: { model: { name: "gpt-5-nano" }, provisioningState: "Succeeded" } },
                ],
              }),
            )
            const deployed = yield* eventually(azureModels, (list) => list.length === 2)
            expect(deployed.map((model) => model.modelID)).toEqual([Model.ID.make("mini"), Model.ID.make("nano")])
          }),
      ),
    )
  })

  it.live("keeps the last complete inventory when a later management page fails", () => {
    const state = { fail: false, url: "" }
    return withAzureCommands(cliTokens, () =>
      withAzure(
        (request) => {
          if (request.path.startsWith("/openai/deployments")) return new Response("Not found", { status: 404 })
          if (request.method === "POST") return Response.json({ data: [account("test-resource")] })
          if (request.path === "/page-2") return new Response("Unavailable", { status: 503 })
          if (state.fail)
            return Response.json({
              nextLink: `${state.url}/page-2`,
              value: [{ name: "nano", properties: { model: { name: "gpt-5-nano" }, provisioningState: "Succeeded" } }],
            })
          return Response.json({
            value: [{ name: "mini", properties: { model: { name: "gpt-5-mini" }, provisioningState: "Succeeded" } }],
          })
        },
        ({ endpoints, requests }) =>
          Effect.gen(function* () {
            state.url = endpoints.management
            const bus = yield* Bus.Service
            yield* seedCatalog
            const credential = yield* azureCredential
            yield* addPlugin(endpoints)
            yield* eventually(azureModels, (list) => list.length === 1 && list[0]?.id === "mini")
            state.fail = true
            yield* bus.publish(
              Credential.Event.Switched,
              { integrationID: Integration.ID.make("azure"), credentialID: credential.id },
              { global: true },
            )
            yield* eventually(Effect.succeed(requests), (list) => list.length === 7)
            expect((yield* azureModels).map((model) => model.id)).toEqual([Model.ID.make("mini")])
          }),
      ),
    )
  })

  it.live("keeps the catalog for a custom endpoint", () =>
    withAzure(
      () => Response.json({ data: [{ id: "gpt-5-mini", model: "gpt-5-mini", status: "succeeded" }] }),
      ({ endpoints, requests }) =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          yield* seedCatalog
          yield* catalog.transform((editor) => {
            editor.update(Provider.ID.azure, (provider) => {
              provider.settings = { baseURL: "https://gateway.example/azure" }
            })
          })
          yield* keyCredential
          yield* addPlugin(endpoints)

          yield* Effect.promise(() => Bun.sleep(50))
          expect(requests).toEqual([])
          expect(yield* azureModels).toHaveLength(4)
        }),
    ),
  )

  it.live("leaves a model that is configured explicitly to the configuration", () =>
    withAzure(
      () => Response.json({ data: [{ id: "gpt-5-mini", model: "gpt-5-mini", status: "succeeded" }] }),
      ({ endpoints }) =>
        Effect.gen(function* () {
          yield* seedCatalog
          yield* keyCredential
          yield* addPlugin(endpoints)
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
          expect(deployed.map((model) => [model.id, model.modelID, model.name, model.limit.context])).toEqual([
            [Model.ID.make("gpt-5-mini"), Model.ID.make("gpt-5-mini"), "GPT-5 Mini", 400_000],
            [Model.ID.make("gpt-5-nano"), Model.ID.make("nano-production"), "GPT-5 Nano", 300_000],
          ])
        }),
    ),
  )

  it.live("uses the only Azure resource of the Azure CLI session while connecting", () => {
    const commands: string[][] = []
    return withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      withAzureCommands(
        (args) => {
          commands.push([...args])
          return cliTokens(args)
        },
        () =>
          withAzure(
            (request) =>
              request.method === "POST"
                ? Response.json({ data: [account("detected-resource")] })
                : Response.json({ data: [] }),
            ({ endpoints, requests }) =>
              Effect.gen(function* () {
                yield* addPlugin(endpoints)
                // Looking the resource up belongs to connecting, never to startup.
                expect(commands).toEqual([])
                const integrations = yield* Integration.Service
                const integrationID = Integration.ID.make("azure")
                const attempt = yield* integrations.oauth.connect({
                  integrationID,
                  methodID: Integration.MethodID.make("azure-cli"),
                })
                yield* eventually(
                  integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }).pipe(Effect.orDie),
                  (status) => status.status !== "pending",
                )

                expect((yield* (yield* Credential.Service).list(integrationID))[0]?.value).toMatchObject({
                  type: "oauth",
                  access: "https://cognitiveservices.azure.com/.default-token",
                  metadata: { resourceName: "detected-resource" },
                })
                expect(commands.map((args) => args[3])).toEqual([
                  "https://management.azure.com/.default",
                  "https://cognitiveservices.azure.com/.default",
                ])
                expect(requests[0]?.body).toContain("isnotempty(resourceName)")
              }),
          ),
      ),
    )
  })

  it.live("offers resources across all Resource Graph pages instead of choosing the first page's only resource", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      withAzureCommands(cliTokens, () =>
        withAzure(
          (request) =>
            Response.json(
              request.body.includes('"$skipToken":"next"')
                ? { data: [account("second-resource")] }
                : { data: [account("first-resource")], $skipToken: "next" },
            ),
          ({ endpoints, requests }) =>
            Effect.gen(function* () {
              yield* addPlugin(endpoints)
              const integrations = yield* Integration.Service
              const integrationID = Integration.ID.make("azure")
              const attempt = yield* integrations.oauth.connect({
                integrationID,
                methodID: Integration.MethodID.make("azure-cli"),
              })
              const status = yield* eventually(
                integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }).pipe(Effect.orDie),
                (status) => status.status !== "pending",
              )

              expect(status).toMatchObject({
                status: "failed",
                message: "Found 2 Azure resources. Connect again to choose one.",
              })
              expect(requests).toHaveLength(2)
              expect(JSON.parse(requests[1].body)).toEqual({
                query: JSON.parse(requests[0].body).query,
                options: { $skipToken: "next" },
              })
              expect(yield* (yield* Credential.Service).list(integrationID)).toEqual([])
              const methods = (yield* integrations.get(integrationID))?.methods ?? []
              expect(methods.find((method) => method.type === "oauth")?.form).toEqual([
                {
                  type: "string",
                  key: "resourceName",
                  title: "Enter Azure Resource Name",
                  placeholder: "e.g. my-models",
                  required: true,
                  options: [
                    {
                      value: "first-resource",
                      label: "first-resource",
                      description: "rg-first-resource · swedencentral",
                    },
                    {
                      value: "second-resource",
                      label: "second-resource",
                      description: "rg-second-resource · swedencentral",
                    },
                  ],
                  custom: true,
                },
              ])
              // An API key cannot look resources up, so its prompt stays a plain required name.
              expect(methods.find((method) => method.type === "key")?.form).toEqual([
                {
                  type: "string",
                  key: "resourceName",
                  title: "Enter Azure Resource Name",
                  placeholder: "e.g. my-models",
                  required: true,
                },
              ])
            }),
        ),
      ),
    ),
  )

  it.effect("uses the correct bearer token audience for Azure and Foundry requests", () =>
    withAzureCommands(
      (args) => {
        if (args.includes("get-access-token")) {
          const scope = args[args.indexOf("--scope") + 1]
          return { accessToken: `${scope}-token`, expires_on: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) }
        }
        return []
      },
      () =>
        Effect.gen(function* () {
          yield* azureCredential
          yield* addPlugin()
          const hooks = yield* PluginHooks.Service
          const model = Model.Ref.make({ providerID: Provider.ID.azure, id: Model.ID.make("gpt-5-mini") })
          const azure = yield* hooks.trigger("session", "http.request", {
            sessionID: Session.ID.make("ses_azure"),
            agent: Agent.ID.make("build"),
            model,
            kind: "primary",
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
            sessionID: Session.ID.make("ses_foundry"),
            agent: Agent.ID.make("build"),
            model,
            kind: "primary",
            request: new Request("https://test-resource.services.ai.azure.com/anthropic/v1/messages", {
              headers: { "x-api-key": "stored-token" },
            }),
          })
          expect(foundry.request.headers.get("authorization")).toBe("Bearer https://ai.azure.com/.default-token")
          expect(foundry.request.headers.has("x-api-key")).toBe(false)

          const handshake = yield* hooks.trigger("session", "experimental.ws.handshake", {
            sessionID: Session.ID.make("ses_azure_ws"),
            agent: Agent.ID.make("build"),
            model,
            kind: "primary",
            url: "wss://test-resource.openai.azure.com/openai/v1/responses",
            headers: { "api-key": "stored-token", "x-keep": "yes" },
          })
          expect(handshake.headers).toMatchObject({
            authorization: "Bearer https://cognitiveservices.azure.com/.default-token",
            "x-keep": "yes",
          })
          expect(handshake.headers).not.toHaveProperty("api-key")
        }),
    ),
  )

  it.effect("resolves resourceName from env", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.azure, (item) => {
            item.package = "@opencode/ai/providers/azure/responses"
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("resolves resourceName from the legacy env", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "legacy-resource" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.azure, (item) => {
            item.package = "@opencode/ai/providers/azure/responses"
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.azure)).settings?.resourceName).toBe("legacy-resource")
      }),
    ),
  )

  it.effect("expands provider and model resource URLs", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env", AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "legacy-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.azure, (provider) => {
            provider.package = "@opencode/ai/providers/openai-compatible"
            provider.activation = "enabled"
            provider.settings = {
              baseURL: "https://${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}.cognitiveservices.azure.com/openai",
            }
          })
          catalog.models.update(Provider.ID.azure, Model.ID.make("anthropic"), (model) => {
            model.package = "@opencode/ai/providers/anthropic"
            model.settings = {
              resourceName: "model-resource",
              baseURL: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1",
            }
          })
        })
        yield* addPlugin()

        expect(required(yield* catalog.get(Provider.ID.azure)).settings).toMatchObject({
          resourceName: "from-env",
          baseURL: "https://from-env.cognitiveservices.azure.com/openai",
        })
        expect(required(yield* models.get(Provider.ID.azure, Model.ID.make("anthropic"))).settings).toMatchObject({
          resourceName: "model-resource",
          baseURL: "https://model-resource.services.ai.azure.com/anthropic/v1",
        })
      }),
    ),
  )

  it.effect("keeps explicit resourceName over env and ignores other providers", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.azure, (item) => {
            item.package = "@opencode/ai/providers/azure/responses"
            item.settings = { resourceName: "from-config" }
          })
          catalog.update(Provider.ID.openai, () => {})
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.azure)).settings?.resourceName).toBe("from-config")
        expect(required(yield* catalog.get(Provider.ID.openai)).settings?.resourceName).toBeUndefined()
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is blank", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.azure, (item) => {
            item.package = "@opencode/ai/providers/azure/responses"
            item.settings = { resourceName: "" }
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is whitespace", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.azure, (item) => {
            item.package = "@opencode/ai/providers/azure/responses"
            item.settings = { resourceName: "   " }
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("stores the Azure Responses WebSocket preference on the provider", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const service = yield* Model.Service
        const models = {
          responses: Model.ID.make("responses"),
          chat: Model.ID.make("chat"),
          preview: Model.ID.make("preview"),
          deploymentURL: Model.ID.make("deployment-url"),
          gateway: Model.ID.make("gateway"),
          nonAzure: Model.ID.make("non-azure"),
        }
        yield* catalog.transform((editor) => {
          editor.update(Provider.ID.azure, (provider) => {
            provider.package = "@opencode/ai/providers/azure/responses"
            provider.activation = "enabled"
          })
          editor.models.update(Provider.ID.azure, models.responses, () => {})
          editor.models.update(Provider.ID.azure, models.chat, (model) => {
            model.package = "@opencode/ai/providers/azure/chat"
          })
          editor.models.update(Provider.ID.azure, models.preview, (model) => {
            model.settings = { apiVersion: "2025-04-01-preview" }
          })
          editor.models.update(Provider.ID.azure, models.deploymentURL, (model) => {
            model.settings = { useDeploymentBasedUrls: true }
          })
          editor.models.update(Provider.ID.azure, models.gateway, (model) => {
            model.settings = { baseURL: "https://gateway.example/azure" }
          })
          editor.models.update(Provider.ID.azure, models.nonAzure, (model) => {
            model.package = "@opencode/ai/providers/anthropic"
          })
        })

        yield* addPlugin()

        expect((yield* catalog.get(Provider.ID.azure))?.settings?.transport).toBe("websocket")
        for (const modelID of [
          models.responses,
          models.chat,
          models.preview,
          models.deploymentURL,
          models.gateway,
          models.nonAzure,
        ]) {
          const model = required(yield* service.get(Provider.ID.azure, modelID))
          expect(model.settings?.transport).toBeUndefined()
        }
      }),
    ),
  )
})
