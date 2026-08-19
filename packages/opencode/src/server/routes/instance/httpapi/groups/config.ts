import { Config } from "@/config/config"
import { ConfigReload } from "@/config/reload"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Provider } from "@/provider/provider"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/config"

const BootstrapCycle = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const ConfigReloadResponse = Schema.Struct({
  success: Schema.Boolean,
  immediate: Schema.Boolean,
  bootstrapCycle: Schema.optional(BootstrapCycle),
})
export const ConfigReloadStatusResponse = Schema.Struct({
  pending: Schema.Boolean,
  executing: Schema.Boolean,
  bootstrapCycle: Schema.optional(BootstrapCycle),
})
export const ConfigBootstrapCompleteQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  cycle: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
})
export const ConfigBootstrapCompleteResponse = Schema.Struct({
  success: Schema.Boolean,
})

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("get", root, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigV1.Info, "Get config info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.get",
            summary: "Get configuration",
            description: "Retrieve the current OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.patch("update", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigV1.Info,
          success: described(ConfigV1.Info, "Successfully updated config"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.update",
            summary: "Update configuration",
            description: "Update OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ConfigProvidersResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
        HttpApiEndpoint.post("reload", `${root}/reload`, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigReloadResponse, "Configuration reload request result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.reload",
            summary: "Reload configuration",
            description: "Reload OpenCode configuration files and plugins without restarting the client.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const ConfigLifecycleApi = HttpApi.make("config-lifecycle")
  .add(
    HttpApiGroup.make("config-lifecycle")
      .add(
        HttpApiEndpoint.get("reloadStatus", `${root}/reload/status`, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigReloadStatusResponse, "Configuration reload status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.reloadStatus",
            summary: "Get config reload status",
            description: "Return the current reload lifecycle state for clients that need to poll for bootstrap cycles.",
          }),
        ),
        HttpApiEndpoint.post("bootstrapComplete", `${root}/bootstrap-complete`, {
          query: ConfigBootstrapCompleteQuery,
          success: described(ConfigBootstrapCompleteResponse, "Bootstrap completion result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.bootstrapComplete",
            summary: "Complete config reload bootstrap",
            description: "Release the reload blocker after the TUI has bootstrapped against the new instance.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config lifecycle",
          description: "Config reload lifecycle routes that must work while an instance is rebooting.",
        }),
      )
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode config lifecycle HttpApi",
      version: "0.0.1",
      description: "Config reload lifecycle endpoints outside instance bootstrap.",
    }),
  )
