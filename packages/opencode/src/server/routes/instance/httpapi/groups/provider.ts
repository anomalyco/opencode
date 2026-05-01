import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"
import { ProviderID } from "@/provider/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/provider"

export const ProviderApi = HttpApi.make("provider")
  .add(
    HttpApiGroup.make("provider")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: described(Provider.ListResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.list",
            summary: "List providers",
            description: "Get a list of all available AI providers, including both available and connected ones.",
          }),
        ),
        HttpApiEndpoint.get("auth", `${root}/auth`, {
          success: described(ProviderAuth.Methods, "Provider auth methods"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.auth",
            summary: "Get provider auth methods",
            description: "Retrieve available authentication methods for all AI providers.",
          }),
        ),
        HttpApiEndpoint.post("authorize", `${root}/:providerID/oauth/authorize`, {
          params: { providerID: ProviderID },
          payload: ProviderAuth.AuthorizeInput,
          success: described(Schema.UndefinedOr(ProviderAuth.Authorization), "Authorization URL and method"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.authorize",
            summary: "Start OAuth authorization",
            description: "Start the OAuth authorization flow for a provider.",
          }),
        ),
        HttpApiEndpoint.post("callback", `${root}/:providerID/oauth/callback`, {
          params: { providerID: ProviderID },
          payload: ProviderAuth.CallbackInput,
          success: described(Schema.Boolean, "OAuth callback processed successfully"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.callback",
            summary: "Handle OAuth callback",
            description: "Handle the OAuth callback from a provider after user authorization.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "provider",
          description: "Experimental HttpApi provider routes.",
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
