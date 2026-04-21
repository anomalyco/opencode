import { ProviderAuth } from "@/provider"
import { Config } from "@/config"
import { ModelsDev } from "@/provider"
import { Provider } from "@/provider"
import { ProviderID } from "@/provider/schema"
import { mapValues } from "remeda"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/provider"

export const ProviderApi = HttpApi.make("provider")
  .add(
    HttpApiGroup.make("provider")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: Provider.ListResult,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.list",
            summary: "List providers",
            description: "Get a list of all available AI providers, including both available and connected ones.",
          }),
        ),
        HttpApiEndpoint.get("auth", `${root}/auth`, {
          success: ProviderAuth.Methods,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.auth",
            summary: "Get provider auth methods",
            description: "Retrieve available authentication methods for all AI providers.",
          }),
        ),
        HttpApiEndpoint.get("accounts", `${root}/:providerID/accounts`, {
          params: { providerID: ProviderID },
          success: Schema.Array(ProviderAuth.AccountInfo),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.accounts",
            summary: "List provider accounts",
            description: "List connected accounts for a specific provider and indicate the active account.",
          }),
        ),
        HttpApiEndpoint.post("activateAccount", `${root}/:providerID/accounts/activate`, {
          params: { providerID: ProviderID },
          payload: ProviderAuth.ActivateAccountInput,
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.accounts.activate",
            summary: "Activate provider account",
            description: "Set the active account for a specific provider.",
          }),
        ),
        HttpApiEndpoint.post("authorize", `${root}/:providerID/oauth/authorize`, {
          params: { providerID: ProviderID },
          payload: ProviderAuth.AuthorizeInput,
          success: ProviderAuth.Authorization,
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
          success: Schema.Boolean,
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
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const providerHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* Effect.promise(() => ModelsDev.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
          filtered[key] = value
        }
      }
      const connected = yield* provider.list()
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
      )
      return {
        all: Object.values(providers),
        default: Provider.defaultModelIDs(providers),
        connected: Object.keys(connected),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const accounts = Effect.fn("ProviderHttpApi.accounts")(function* (ctx: { params: { providerID: ProviderID } }) {
      return yield* svc
        .accounts({ providerID: ctx.params.providerID })
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
    })

    const activateAccount = Effect.fn("ProviderHttpApi.activateAccount")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: ProviderAuth.ActivateAccountInput
    }) {
      yield* svc
        .activateAccount({
          providerID: ctx.params.providerID,
          accountKey: ctx.payload.accountKey,
        })
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      const result = yield* svc
        .authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          accountKey: ctx.payload.accountKey,
          inputs: ctx.payload.inputs,
        })
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      if (!result) return yield* new HttpApiError.BadRequest({})
      return result
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* svc
        .callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          accountKey: ctx.payload.accountKey,
          code: ctx.payload.code,
        })
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    return HttpApiBuilder.group(ProviderApi, "provider", (handlers) =>
      handlers
        .handle("list", list)
        .handle("auth", auth)
        .handle("accounts", accounts)
        .handle("activateAccount", activateAccount)
        .handle("authorize", authorize)
        .handle("callback", callback),
    )
  }),
).pipe(
  Layer.provide(ProviderAuth.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Config.defaultLayer),
)
