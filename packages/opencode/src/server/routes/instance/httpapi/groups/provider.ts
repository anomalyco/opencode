import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"
import { ProviderID } from "@/provider/schema"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/provider"

const RemoveAccountPayload = Schema.Struct({
  providerID: Schema.String,
  recordID: Schema.String,
  namespace: Schema.optional(Schema.String),
})
const SetActivePayload = Schema.Struct({
  providerID: Schema.String,
  recordID: Schema.String,
  namespace: Schema.optional(Schema.String),
})
const UpdateAccountPayload = Schema.Struct({
  providerID: Schema.String,
  recordID: Schema.String,
  namespace: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
})
const RemoveAccountResult = Schema.Struct({
  removed: Schema.Boolean,
  remaining: NonNegativeInt,
})
const SetActiveResult = Schema.Struct({
  success: Schema.Boolean,
  anthropicUsage: Schema.optional(Schema.Unknown),
})
const UpdateAccountResult = Schema.Struct({
  success: Schema.Boolean,
})
const AccountHealth = Schema.Struct({
  successCount: NonNegativeInt,
  failureCount: NonNegativeInt,
  lastStatusCode: Schema.optional(Schema.Int),
  cooldownUntil: Schema.optional(Schema.Number),
})
const AccountUsage = Schema.Struct({
  id: Schema.String,
  label: Schema.optional(Schema.String),
  isActive: Schema.Boolean,
  health: AccountHealth,
})
const ProviderUsage = Schema.Struct({
  accounts: Schema.Array(AccountUsage),
  anthropicUsage: Schema.optional(Schema.Unknown),
})
const UsageResult = Schema.Record(Schema.String, ProviderUsage)
const RecordIdParam = Schema.Struct({
  recordId: Schema.String,
})
const BrowserSessionStatus = Schema.Struct({
  recordId: Schema.String,
  enabled: Schema.Boolean,
  profilePath: Schema.String,
  lastRefresh: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
  isConfigured: Schema.Boolean,
  label: Schema.optional(Schema.String),
})
const BrowserActionResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
})

const ProviderAuthErrorName = Schema.Union([
  Schema.Literal("BadRequest"),
  Schema.Literal("ProviderAuthOauthMissing"),
  Schema.Literal("ProviderAuthOauthCodeMissing"),
  Schema.Literal("ProviderAuthOauthCallbackFailed"),
  Schema.Literal("ProviderAuthValidationFailed"),
])
export class ProviderAuthApiError extends Schema.ErrorClass<ProviderAuthApiError>("ProviderAuthError")(
  {
    name: ProviderAuthErrorName,
    data: Schema.Struct({
      providerID: Schema.optional(ProviderID),
      field: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

export const ProviderApi = HttpApi.make("provider")
  .add(
    HttpApiGroup.make("provider")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ListResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.list",
            summary: "List providers",
            description: "Get a list of all available AI providers, including both available and connected ones.",
          }),
        ),
        HttpApiEndpoint.get("auth", `${root}/auth`, {
          query: WorkspaceRoutingQuery,
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
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.AuthorizeInput,
          success: described(Schema.UndefinedOr(ProviderAuth.Authorization), "Authorization URL and method"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.authorize",
            summary: "Start OAuth authorization",
            description: "Start the OAuth authorization flow for a provider.",
          }),
        ),
        HttpApiEndpoint.post("callback", `${root}/:providerID/oauth/callback`, {
          params: { providerID: ProviderID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.CallbackInput,
          success: described(Schema.Boolean, "OAuth callback processed successfully"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.callback",
            summary: "Handle OAuth callback",
            description: "Handle the OAuth callback from a provider after user authorization.",
          }),
        ),
        HttpApiEndpoint.delete("removeAccount", `${root}/auth/account`, {
          query: WorkspaceRoutingQuery,
          payload: RemoveAccountPayload,
          success: described(RemoveAccountResult, "Account removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "auth.removeAccount",
            summary: "Remove OAuth account",
            description: "Remove an OAuth account record from a provider.",
          }),
        ),
        HttpApiEndpoint.post("setActive", `${root}/auth/active`, {
          query: WorkspaceRoutingQuery,
          payload: SetActivePayload,
          success: described(SetActiveResult, "Active account updated"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "auth.setActive",
            summary: "Set active OAuth account",
            description: "Set the active OAuth account for a provider.",
          }),
        ),
        HttpApiEndpoint.patch("updateAccount", `${root}/auth/account`, {
          query: WorkspaceRoutingQuery,
          payload: UpdateAccountPayload,
          success: described(UpdateAccountResult, "Account updated"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "auth.updateAccount",
            summary: "Update OAuth account",
            description: "Update OAuth account metadata.",
          }),
        ),
        HttpApiEndpoint.get("usage", `${root}/auth/usage`, {
          query: WorkspaceRoutingQuery,
          success: described(UsageResult, "OAuth usage by provider"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "auth.usage",
            summary: "Get OAuth account usage",
            description: "Get OAuth account health and Anthropic usage details.",
          }),
        ),
        HttpApiEndpoint.get("browserSessions", `${root}/auth/browser-session`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(BrowserSessionStatus), "Browser sessions"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.browser.sessions",
            summary: "List browser sessions",
            description: "List OAuth browser sessions for automatic token refresh.",
          }),
        ),
        HttpApiEndpoint.get("browserSession", `${root}/auth/browser-session/:recordId`, {
          params: RecordIdParam,
          query: WorkspaceRoutingQuery,
          success: described(BrowserSessionStatus, "Browser session status"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.browser.session.status",
            summary: "Get browser session status",
            description: "Get OAuth browser session status for an account.",
          }),
        ),
        HttpApiEndpoint.post("setupBrowserSession", `${root}/auth/browser-session/:recordId/setup`, {
          params: RecordIdParam,
          query: WorkspaceRoutingQuery,
          success: described(BrowserActionResult, "Browser session setup result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.browser.session.setup",
            summary: "Set up browser session",
            description: "Open a browser session and bind it to an OAuth account.",
          }),
        ),
        HttpApiEndpoint.post("refreshBrowserSession", `${root}/auth/browser-session/:recordId/refresh`, {
          params: RecordIdParam,
          query: WorkspaceRoutingQuery,
          success: described(BrowserActionResult, "Browser refresh result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.browser.session.refresh",
            summary: "Refresh browser session",
            description: "Refresh OAuth tokens using a configured browser session.",
          }),
        ),
        HttpApiEndpoint.delete("removeBrowserSession", `${root}/auth/browser-session/:recordId`, {
          params: RecordIdParam,
          query: WorkspaceRoutingQuery,
          success: described(BrowserActionResult, "Browser session removal result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.browser.session.remove",
            summary: "Remove browser session",
            description: "Remove an OAuth browser session profile.",
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
