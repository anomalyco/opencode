import { chmod } from "node:fs/promises"
import { Agent } from "@opencode-ai/core/agent"
import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { AzurePlugin } from "@opencode-ai/core/plugin/provider/azure"
import { Provider } from "@opencode-ai/core/provider"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { Session } from "@opencode-ai/core/session"
import { AppProcess } from "@opencode-ai/util/process"
import { fakeSelectorSdk } from "../fixture/selector"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* AzurePlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

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
                  placeholder: "e.g. my-models",
                  required: true,
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
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          yield* catalog.transform((editor) => {
            editor.provider.update(Provider.ID.azure, (provider) => {
              provider.package = Provider.aisdk("@ai-sdk/azure")
            })
            editor.model.update(Provider.ID.azure, Model.ID.make("gpt-5-mini"), () => {})
            editor.model.update(Provider.ID.azure, Model.ID.make("gpt-5-nano"), () => {})
          })
          yield* azureCredential
          yield* addPlugin()

          expect(commands).toEqual([])
          expect((yield* catalog.provider.get(Provider.ID.azure))?.settings?.resourceName).toBe("test-resource")
          expect(yield* catalog.model.get(Provider.ID.azure, Model.ID.make("gpt-5-mini"))).toBeDefined()
          expect(yield* catalog.model.get(Provider.ID.azure, Model.ID.make("gpt-5-nano"))).toBeDefined()
        }),
    )
  })

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
        }),
    ),
  )

  it.effect("resolves resourceName from env", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (item) => {
            item.package = Provider.aisdk("@ai-sdk/azure")
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("resolves resourceName from the legacy env", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "legacy-resource" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (item) => {
            item.package = Provider.aisdk("@ai-sdk/azure")
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("legacy-resource")
      }),
    ),
  )

  it.effect("expands provider and model resource URLs", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env", AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "legacy-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (provider) => {
            provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
            provider.settings = {
              baseURL: "https://${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}.cognitiveservices.azure.com/openai",
            }
          })
          catalog.model.update(Provider.ID.azure, Model.ID.make("anthropic"), (model) => {
            model.package = Provider.aisdk("@ai-sdk/anthropic")
            model.settings = {
              resourceName: "model-resource",
              baseURL: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1",
            }
          })
        })
        yield* addPlugin()

        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings).toMatchObject({
          resourceName: "from-env",
          baseURL: "https://from-env.cognitiveservices.azure.com/openai",
        })
        expect(
          required(yield* catalog.model.get(Provider.ID.azure, Model.ID.make("anthropic"))).settings,
        ).toMatchObject({
          resourceName: "model-resource",
          baseURL: "https://model-resource.services.ai.azure.com/anthropic/v1",
        })
      }),
    ),
  )

  it.effect("keeps explicit resourceName over env and ignores other providers", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (item) => {
            item.package = Provider.aisdk("@ai-sdk/azure")
            item.settings = { resourceName: "from-config" }
          })
          catalog.provider.update(Provider.ID.openai, () => {})
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("from-config")
        expect(required(yield* catalog.provider.get(Provider.ID.openai)).settings?.resourceName).toBeUndefined()
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is blank", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (item) => {
            item.package = Provider.aisdk("@ai-sdk/azure")
            item.settings = { resourceName: "" }
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is whitespace", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (item) => {
            item.package = Provider.aisdk("@ai-sdk/azure")
            item.settings = { resourceName: "   " }
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("allows configured baseURL without resourceName", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) =>
          catalog.provider.update(Provider.ID.azure, (provider) => {
            provider.settings = { ...provider.settings, baseURL: "https://proxy.example.com/openai" }
          }),
        )
        yield* addPlugin()
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(Integration.ID.make("azure")))?.methods).toContainEqual({
          type: "key",
          label: "API key",
        })
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
            modelID: Model.ID.make("deployment"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/azure",
          options: { name: "azure", baseURL: "https://proxy.example.com/openai" },
        })
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("marks only Azure v1 Responses deployments as WebSocket capable", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const models = {
          responses: Model.ID.make("responses"),
          chat: Model.ID.make("chat"),
          preview: Model.ID.make("preview"),
          deploymentURL: Model.ID.make("deployment-url"),
          gateway: Model.ID.make("gateway"),
          nonAzure: Model.ID.make("non-azure"),
        }
        yield* catalog.transform((editor) => {
          editor.provider.update(Provider.ID.azure, (provider) => {
            provider.package = Provider.aisdk("@ai-sdk/azure")
          })
          editor.model.update(Provider.ID.azure, models.responses, () => {})
          editor.model.update(Provider.ID.azure, models.chat, (model) => {
            model.settings = { useCompletionUrls: true }
          })
          editor.model.update(Provider.ID.azure, models.preview, (model) => {
            model.settings = { apiVersion: "2025-04-01-preview" }
          })
          editor.model.update(Provider.ID.azure, models.deploymentURL, (model) => {
            model.settings = { useDeploymentBasedUrls: true }
          })
          editor.model.update(Provider.ID.azure, models.gateway, (model) => {
            model.settings = { baseURL: "https://gateway.example/azure" }
          })
          editor.model.update(Provider.ID.azure, models.nonAzure, (model) => {
            model.package = Provider.aisdk("@ai-sdk/anthropic")
          })
        })

        yield* addPlugin()

        expect(
          required(yield* catalog.model.get(Provider.ID.azure, models.responses)).capabilities.responsesWebsockets,
        ).toBe(true)
        for (const modelID of [models.chat, models.preview, models.deploymentURL, models.gateway, models.nonAzure])
          expect(
            required(yield* catalog.model.get(Provider.ID.azure, modelID)).capabilities.responsesWebsockets,
          ).toBeUndefined()
      }),
    ),
  )

  it.effect("rejects missing resourceName when baseURL is not configured", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const exit = yield* aisdk
          .runSDK({
            model: Model.Info.make({
              ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
              modelID: Model.ID.make("deployment"),
              package: Provider.aisdk("test-provider"),
            }),
            package: "@ai-sdk/azure",
            options: { name: "azure" },
          })
          .pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.effect("selects chat only for completion URLs", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: { useCompletionUrls: true },
      })
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("selects chat from per-call useCompletionUrls", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: { useCompletionUrls: true },
      })
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("ignores model useCompletionUrls when per-call option is unset", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
          body: { useCompletionUrls: true },
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:deployment"])
    }),
  )

  it.effect("uses the legacy Azure selector order and provider guard", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      const ignored = yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.openai, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:deployment"])
      expect(ignored.language).toBeUndefined()
    }),
  )

  it.effect("falls back through the legacy Azure selector order", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      const make = (method: string) => (id: string) => {
        calls.push(`${method}:${id}`)
        return { modelId: id, provider: method, specificationVersion: "v3" }
      }
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("messages-deployment")),
          modelID: Model.ID.make("messages-deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { messages: make("messages"), chat: make("chat"), languageModel: make("languageModel") },
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("language-deployment")),
          modelID: Model.ID.make("language-deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { languageModel: make("languageModel") },
        options: {},
      })
      expect(calls).toEqual(["messages:messages-deployment", "languageModel:language-deployment"])
    }),
  )
})
