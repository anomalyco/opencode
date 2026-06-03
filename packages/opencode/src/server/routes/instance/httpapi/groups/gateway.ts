import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { GatewayAuthorization } from "../middleware/gateway-authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

export const GatewayPaths = {
  models: "/v1/models",
  chatCompletions: "/v1/chat/completions",
  vscodeConfig: "/v1/vscode-config",
} as const

const OpenAIModel = Schema.Struct({
  id: Schema.String,
  object: Schema.Literal("model"),
  created: Schema.Number,
  owned_by: Schema.String,
})

const ModelList = Schema.Struct({
  object: Schema.Literal("list"),
  data: Schema.Array(OpenAIModel),
})

// OpenAI-compatible model gateway. opencode exposes every model from every
// enabled provider (with the user's already-configured credentials) so an
// OpenAI client — e.g. VSCode's "Bring your own key" custom endpoint — can use
// them. Requests are passed straight through to the underlying model; the
// opencode agent loop does not run.
export const GatewayApi = HttpApi.make("gateway").add(
  HttpApiGroup.make("gateway")
    .add(
      HttpApiEndpoint.get("models", GatewayPaths.models, {
        query: WorkspaceRoutingQuery,
        success: ModelList,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "gateway.models",
          summary: "List models (OpenAI-compatible)",
          description: "List every model from every enabled provider in the OpenAI `/v1/models` format.",
        }),
      ),
      HttpApiEndpoint.post("chatCompletions", GatewayPaths.chatCompletions, {
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "gateway.chatCompletions",
          summary: "Chat completions (OpenAI-compatible)",
          description:
            "OpenAI Chat Completions endpoint. Supports streaming (SSE) and non-streaming responses and passes tool definitions through to the client.",
        }),
      ),
      HttpApiEndpoint.get("vscodeConfig", GatewayPaths.vscodeConfig, {
        query: WorkspaceRoutingQuery,
        success: Schema.Unknown,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "gateway.vscodeConfig",
          summary: "VSCode chatLanguageModels.json",
          description:
            "Helper that returns a ready-to-use VSCode `chatLanguageModels.json` for every enabled model.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(GatewayAuthorization)
    .annotateMerge(
      OpenApi.annotations({ title: "gateway", description: "OpenAI-compatible model gateway routes." }),
    ),
)
