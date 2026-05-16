import { ProviderAuth } from "@/provider/auth"
import { Auth } from "@/auth"
import { AuthBrowser } from "@/auth/browser"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models"
import { Provider } from "@/provider/provider"
import { ProviderID } from "@/provider/schema"
import { mapValues } from "remeda"
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError } from "../groups/provider"

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

function tryBadRequest<Value>(fn: () => PromiseLike<Value>) {
  return Effect.tryPromise({
    try: fn,
    catch: () => new HttpApiError.BadRequest({}),
  })
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
      )
      return {
        all: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
        connected: Object.keys(connected),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      return true
    })

    const removeAccount = Effect.fn("ProviderHttpApi.removeAccount")(function* (ctx: {
      payload: { providerID: string; recordID: string; namespace?: string }
    }) {
      return yield* tryBadRequest(() =>
        Auth.OAuthPool.removeRecord(ctx.payload.providerID, ctx.payload.recordID, ctx.payload.namespace ?? "default"),
      )
    })

    const setActive = Effect.fn("ProviderHttpApi.setActive")(function* (ctx: {
      payload: { providerID: string; recordID: string; namespace?: string }
    }) {
      const namespace = ctx.payload.namespace ?? "default"
      const success = yield* tryBadRequest(() =>
        Auth.OAuthPool.setActive(ctx.payload.providerID, namespace, ctx.payload.recordID),
      )
      if (!success) return { success, anthropicUsage: undefined }
      const anthropicUsage = yield* tryBadRequest(() =>
        Auth.OAuthPool.fetchAnthropicUsage(ctx.payload.providerID, namespace, ctx.payload.recordID),
      )
      return { success, anthropicUsage: anthropicUsage ?? undefined }
    })

    const updateAccount = Effect.fn("ProviderHttpApi.updateAccount")(function* (ctx: {
      payload: { providerID: string; recordID: string; namespace?: string; label?: string }
    }) {
      const success = yield* tryBadRequest(() =>
        Auth.OAuthPool.updateRecord(ctx.payload.providerID, ctx.payload.recordID, ctx.payload.namespace ?? "default", {
          label: ctx.payload.label,
        }),
      )
      return { success }
    })

    const usage = Effect.fn("ProviderHttpApi.usage")(function* () {
      const auth = yield* tryBadRequest(() => Auth.all())
      const result: Record<
        string,
        {
          accounts: Awaited<ReturnType<typeof Auth.OAuthPool.getUsage>>
          anthropicUsage?: Awaited<ReturnType<typeof Auth.OAuthPool.fetchAnthropicUsage>>
        }
      > = {}
      for (const [providerID, info] of Object.entries(auth)) {
        if (info.type !== "oauth") continue
        const accounts = yield* tryBadRequest(() => Auth.OAuthPool.getUsage(providerID))
        const anthropicUsage = yield* tryBadRequest(() => Auth.OAuthPool.fetchAnthropicUsage(providerID))
        result[providerID] = { accounts, anthropicUsage: anthropicUsage ?? undefined }
      }
      return result
    })

    const browserSessions = Effect.fn("ProviderHttpApi.browserSessions")(function* () {
      const sessions = yield* tryBadRequest(() => AuthBrowser.listAll())
      const accounts = yield* tryBadRequest(() => Auth.OAuthPool.list("anthropic", "default"))
      return sessions.map((session) => ({
        ...session,
        label: accounts.find((account) => account.id === session.recordId)?.label,
      }))
    })

    const browserSession = Effect.fn("ProviderHttpApi.browserSession")(function* (ctx: {
      params: { recordId: string }
    }) {
      return yield* tryBadRequest(() => AuthBrowser.status(ctx.params.recordId))
    })

    const setupBrowserSession = Effect.fn("ProviderHttpApi.setupBrowserSession")(function* (ctx: {
      params: { recordId: string }
    }) {
      const accounts = yield* tryBadRequest(() => Auth.OAuthPool.list("anthropic", "default"))
      if (!accounts.some((account) => account.id === ctx.params.recordId)) {
        return { success: false, message: "Account not found" }
      }
      return yield* Effect.promise(async () => {
        try {
          const tokens = await AuthBrowser.setup(ctx.params.recordId)
          await Auth.OAuthPool.updateRecord("anthropic", ctx.params.recordId, "default", {
            access: tokens.access,
            refresh: tokens.refresh,
            expires: tokens.expires,
          })
          return { success: true, message: "Browser session configured successfully" }
        } catch (error) {
          return { success: false, message: error instanceof Error ? error.message : String(error) }
        }
      })
    })

    const refreshBrowserSession = Effect.fn("ProviderHttpApi.refreshBrowserSession")(function* (ctx: {
      params: { recordId: string }
    }) {
      const accounts = yield* tryBadRequest(() => Auth.OAuthPool.list("anthropic", "default"))
      if (!accounts.some((account) => account.id === ctx.params.recordId)) {
        return { success: false, message: "Account not found" }
      }
      const session = yield* tryBadRequest(() => AuthBrowser.status(ctx.params.recordId))
      if (!session.isConfigured) return { success: false, message: "Browser session not configured" }
      return yield* Effect.promise(async () => {
        try {
          const tokens = await AuthBrowser.refresh(ctx.params.recordId)
          await Auth.OAuthPool.updateRecord("anthropic", ctx.params.recordId, "default", {
            access: tokens.access,
            refresh: tokens.refresh,
            expires: tokens.expires,
          })
          return { success: true, message: "Tokens refreshed successfully" }
        } catch (error) {
          return { success: false, message: error instanceof Error ? error.message : String(error) }
        }
      })
    })

    const removeBrowserSession = Effect.fn("ProviderHttpApi.removeBrowserSession")(function* (ctx: {
      params: { recordId: string }
    }) {
      const accounts = yield* tryBadRequest(() => Auth.OAuthPool.list("anthropic", "default"))
      if (!accounts.some((account) => account.id === ctx.params.recordId)) {
        return { success: false, message: "Account not found" }
      }
      return yield* Effect.promise(async () => {
        try {
          await AuthBrowser.remove(ctx.params.recordId)
          return { success: true, message: "Browser session removed" }
        } catch (error) {
          return { success: false, message: error instanceof Error ? error.message : String(error) }
        }
      })
    })

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
      .handle("removeAccount", removeAccount)
      .handle("setActive", setActive)
      .handle("updateAccount", updateAccount)
      .handle("usage", usage)
      .handle("browserSessions", browserSessions)
      .handle("browserSession", browserSession)
      .handle("setupBrowserSession", setupBrowserSession)
      .handle("refreshBrowserSession", refreshBrowserSession)
      .handle("removeBrowserSession", removeBrowserSession)
  }),
)
