import os from "os"
import { App } from "../../app.js"
import { Effect, Semaphore, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { DiscoveredWorkflowModel } from "gitlab-ai-provider"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.gitlab
const integrationID = Integration.ID.make("gitlab")

export const GitLabPlugin = define({
  id: "opencode.provider.gitlab",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      models?: DiscoveredWorkflowModel[]
      connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = {}

    const load = Effect.fn("GitLabPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const provider = yield* providers.get(providerID)
      const apiKey =
        credential?.type === "oauth"
          ? credential.access
          : (credential?.key ??
            (typeof provider?.settings?.apiKey === "string" ? provider.settings.apiKey : process.env.GITLAB_TOKEN))
      if (!apiKey) {
        loaded.models = undefined
        loaded.connection = undefined
        return
      }

      const instanceUrl =
        typeof provider?.settings?.instanceUrl === "string"
          ? provider.settings.instanceUrl
          : (process.env.GITLAB_INSTANCE_URL ?? "https://gitlab.com")
      // The SDK owns project detection, GraphQL discovery, caching and token limits.
      const remote = yield* Effect.tryPromise({
        try: async () => {
          const { discoverWorkflowModels } = await import("gitlab-ai-provider")
          return discoverWorkflowModels(
            {
              instanceUrl,
              getHeaders: (): Record<string, string> =>
                credential?.type === "oauth" ? { Authorization: `Bearer ${apiKey}` } : { "PRIVATE-TOKEN": apiKey },
            },
            { workingDirectory: ctx.location.directory },
          )
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to discover GitLab workflow models", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (
        IntegrationConnection.key(connection) !==
        IntegrationConnection.key(yield* ctx.integration.connection.active(integrationID))
      )
        return
      loaded.models = remote?.models
      loaded.connection = connection
    })

    yield* ctx.provider.transform((editor) => {
      const item = editor.get(providerID)
      if (!item || !loaded.models?.length) return
      editor.add({
        info: item.provider,
        sourceConnection: loaded.connection,
        models: [
          ...item.models.values(),
          ...loaded.models
            .filter((model) => !item.models.has(model.id))
            .map((model) => ({
              ...Model.Info.default(providerID, Model.ID.make(model.id)),
              name: `Agent Platform (${model.name})`,
              package: Provider.aisdk("gitlab-ai-provider"),
              settings: { workflowRef: model.ref },
              capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
              limit: { context: model.context, output: model.output },
            })),
        ],
      })
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)

    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "gitlab-ai-provider") return
        const mod = yield* Effect.promise(() => import("gitlab-ai-provider"))
        evt.sdk = mod.createGitLab({
          ...evt.options,
          instanceUrl:
            typeof evt.options.instanceUrl === "string"
              ? evt.options.instanceUrl
              : (process.env.GITLAB_INSTANCE_URL ?? "https://gitlab.com"),
          apiKey: typeof evt.options.apiKey === "string" ? evt.options.apiKey : process.env.GITLAB_TOKEN,
          aiGatewayHeaders: {
            "User-Agent": `${App.useragent(ctx.app)} gitlab-ai-provider/${mod.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
            "anthropic-beta": "context-1m-2025-08-07",
            ...evt.options.aiGatewayHeaders,
          },
          featureFlags: {
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
            ...evt.options.featureFlags,
          },
        })
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.gitlab) return
        const featureFlags =
          typeof evt.options.featureFlags === "object" && evt.options.featureFlags ? evt.options.featureFlags : {}
        const id = evt.model.modelID ?? evt.model.id
        if (id.startsWith("duo-workflow-")) {
          const gitlab = yield* Effect.promise(() => import("gitlab-ai-provider"))
          const workflowRef =
            typeof evt.model.settings?.workflowRef === "string" ? evt.model.settings.workflowRef : undefined
          const workflowDefinition =
            typeof evt.model.settings?.workflowDefinition === "string"
              ? evt.model.settings.workflowDefinition
              : undefined
          const language = evt.sdk.workflowChat(gitlab.isWorkflowModel(id) ? id : "duo-workflow", {
            featureFlags,
            workflowDefinition,
          })
          if (workflowRef) language.selectedModelRef = workflowRef
          evt.language = language
          return
        }
        evt.language = evt.sdk.agenticChat(id, {
          aiGatewayHeaders: evt.options.aiGatewayHeaders,
          featureFlags,
        })
      }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)
