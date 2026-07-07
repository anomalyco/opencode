import os from "os"
import { InstallationVersion } from "../../installation/version"
import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { ProviderV2 } from "../../provider"

export const GitLabPlugin = define({
  id: "opencode.provider.gitlab",
  effect: Effect.fn(function* (ctx) {
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
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.gitlab) return
        const featureFlags =
          typeof evt.options.featureFlags === "object" && evt.options.featureFlags ? evt.options.featureFlags : {}
        const id = evt.model.modelID ?? evt.model.id
        if (id.startsWith("duo-workflow-")) {
          const gitlab = yield* Effect.promise(() => import("gitlab-ai-provider")).pipe(Effect.orDie)
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
})
