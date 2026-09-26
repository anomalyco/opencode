import os from "os"
import { InstallationVersion } from "../../installation/version"
import { Effect } from "effect"
import { define } from "../internal"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import type { Service as LocationService } from "../../location"

type WorkflowModel = {
  readonly id: string
  readonly name: string
  readonly ref: string
  readonly context: number
  readonly output: number
}

type WorkflowDiscovery = {
  readonly models: readonly WorkflowModel[]
}

async function discoverWorkflowModels(input: {
  readonly instanceUrl: string
  readonly token: string
  readonly auth: "key" | "oauth"
  readonly directory: string
}) {
  try {
    const gitlab = await import("gitlab-ai-provider")
    const result = (await gitlab.discoverWorkflowModels(
      {
        instanceUrl: input.instanceUrl,
        getHeaders: (): Record<string, string> =>
          input.auth === "oauth" ? { Authorization: `Bearer ${input.token}` } : { "PRIVATE-TOKEN": input.token },
      },
      { workingDirectory: input.directory },
    )) as WorkflowDiscovery
    return result.models
  } catch {
    return []
  }
}

export const GitLabPlugin = define<LocationService>({
  id: "gitlab",
  effect: Effect.fn(function* (ctx) {
    const locationModule = yield* Effect.promise(() => import("../../location"))
    const location = yield* locationModule.Service
    const connection = yield* ctx.integration.connection.active("gitlab")
    const credential = connection
      ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
      : undefined
    const auth = credential?.type === "oauth" ? "oauth" : "key"
    const token =
      credential?.type === "oauth"
        ? credential.access
        : credential?.type === "key"
          ? credential.key
          : process.env.GITLAB_TOKEN

    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        const provider = catalog.provider.get(ProviderV2.ID.gitlab)
        if (!provider) return

        const configuredToken =
          typeof provider.provider.request.body.apiKey === "string" ? provider.provider.request.body.apiKey : token
        if (!configuredToken) return

        const instanceUrl =
          typeof provider.provider.request.body.instanceUrl === "string"
            ? provider.provider.request.body.instanceUrl
            : (process.env.GITLAB_INSTANCE_URL ??
              (typeof provider.provider.api.url === "string" ? provider.provider.api.url : "https://gitlab.com"))
        const models = yield* Effect.promise(() =>
          discoverWorkflowModels({
            instanceUrl,
            token: configuredToken,
            auth,
            directory: location.directory,
          }),
        )

        for (const item of models) {
          const modelID = ModelV2.ID.make(item.id)
          if (catalog.model.get(ProviderV2.ID.gitlab, modelID)) continue
          catalog.model.update(ProviderV2.ID.gitlab, modelID, (model) => {
            model.name = `Agent Platform (${item.name})`
            model.family = ModelV2.Family.make("")
            model.api = {
              id: modelID,
              type: "aisdk",
              package: "gitlab-ai-provider",
              url: instanceUrl,
            }
            model.request.body.workflowRef = item.ref
            model.capabilities = {
              tools: true,
              input: ["text", "image", "pdf"],
              output: ["text"],
            }
            model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
            model.limit = { context: item.context, output: item.output }
            model.status = "active"
            model.enabled = true
          })
        }
      }),
    )

    yield* ctx.aisdk.sdk(
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
            "User-Agent": `opencode/${InstallationVersion} gitlab-ai-provider/${mod.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
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
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.gitlab) return
        const featureFlags =
          typeof evt.options.featureFlags === "object" && evt.options.featureFlags ? evt.options.featureFlags : {}
        if (evt.model.api.id.startsWith("duo-workflow-")) {
          const gitlab = yield* Effect.promise(() => import("gitlab-ai-provider")).pipe(Effect.orDie)
          const workflowRef =
            typeof evt.model.request.body.workflowRef === "string" ? evt.model.request.body.workflowRef : undefined
          const workflowDefinition =
            typeof evt.model.request.body.workflowDefinition === "string"
              ? evt.model.request.body.workflowDefinition
              : undefined
          const language = evt.sdk.workflowChat(
            gitlab.isWorkflowModel(evt.model.api.id) ? evt.model.api.id : "duo-workflow",
            {
              featureFlags,
              workflowDefinition,
            },
          )
          if (workflowRef) language.selectedModelRef = workflowRef
          evt.language = language
          return
        }
        evt.language = evt.sdk.agenticChat(evt.model.api.id, {
          aiGatewayHeaders: evt.options.aiGatewayHeaders,
          featureFlags,
        })
      }),
    )
  }),
})
