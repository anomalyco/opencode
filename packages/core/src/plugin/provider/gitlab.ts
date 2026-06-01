import os from "os"
import { InstallationVersion } from "../../installation/version"
import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const GitLabPlugin = PluginV2.define({
  id: PluginV2.ID.make("gitlab"),
  effect: Effect.gen(function* () {
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
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
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.gitlab) return
        const featureFlags =
          typeof evt.options.featureFlags === "object" && evt.options.featureFlags ? evt.options.featureFlags : {}
        if (evt.model.apiID.startsWith("duo-workflow-")) {
          const gitlab = yield* Effect.promise(() => import("gitlab-ai-provider")).pipe(Effect.orDie)
          const workflowRef =
            typeof evt.model.options.aisdk.request.workflowRef === "string"
              ? evt.model.options.aisdk.request.workflowRef
              : undefined
          const workflowDefinition =
            typeof evt.model.options.aisdk.request.workflowDefinition === "string"
              ? evt.model.options.aisdk.request.workflowDefinition
              : undefined
          const language = evt.sdk.workflowChat(
            gitlab.isWorkflowModel(evt.model.apiID) ? evt.model.apiID : "duo-workflow",
            {
              featureFlags,
              workflowDefinition,
            },
          )
          if (workflowRef) language.selectedModelRef = workflowRef
          evt.language = language
          return
        }
        evt.language = evt.sdk.agenticChat(evt.model.apiID, {
          aiGatewayHeaders: evt.options.aiGatewayHeaders,
          featureFlags,
        })
      }),
    }
  }),
})
