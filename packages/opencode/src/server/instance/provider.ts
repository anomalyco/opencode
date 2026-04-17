import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config"
import { Provider } from "../../provider"
import { ModelsDev } from "../../provider"
import { ProviderAuth } from "../../provider"
import { ProviderID } from "../../provider/schema"
import { AppRuntime } from "../../effect/app-runtime"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Effect } from "effect"

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ListResult.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await AppRuntime.runPromise(
          Effect.gen(function* () {
            const svc = yield* Provider.Service
            const cfg = yield* Config.Service
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
            const connected = yield* svc.list()
            const providers = Object.assign(
              mapValues(filtered, (x) => Provider.fromModelsDevProvider(x)),
              connected,
            )
            return {
              all: Object.values(providers),
              default: Provider.defaultModelIDs(providers),
              connected: Object.keys(connected),
            }
          }),
        )
        return c.json({
          all: result.all,
          default: result.default,
          connected: result.connected,
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Methods.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await AppRuntime.runPromise(ProviderAuth.Service.use((svc) => svc.methods())))
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.zod.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.AuthorizeInput.zod),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, inputs } = c.req.valid("json")
        const result = await AppRuntime.runPromise(
          ProviderAuth.Service.use((svc) =>
            svc.authorize({
              providerID,
              method,
              inputs,
            }),
          ),
        )
        return c.json(result)
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.CallbackInput.zod),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await AppRuntime.runPromise(
          ProviderAuth.Service.use((svc) =>
            svc.callback({
              providerID,
              method,
              code,
            }),
          ),
        )
        return c.json(true)
      },
    ),
)
