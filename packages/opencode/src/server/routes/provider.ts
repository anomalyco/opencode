import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { Auth } from "../../auth"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

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
                schema: resolver(
                  z.object({
                    all: ModelsDev.Provider.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const allProviders = await ModelsDev.get()
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const connected = await Provider.list()
        const providers = Object.assign(
          mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
          connected,
        )
        return c.json({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
          connected: Object.keys(connected),
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
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
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
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method } = c.req.valid("json")
        const result = await ProviderAuth.authorize({
          providerID,
          method,
        })
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
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
        })
        return c.json(true)
      },
    )
    .get(
      "/auth/usage",
      describeRoute({
        summary: "Get auth usage",
        description: "Get rate limit and usage information for authenticated providers.",
        operationId: "auth.usage",
        responses: {
          200: {
            description: "Usage information per provider and account",
            content: {
              "application/json": {
                schema: resolver(z.any().meta({ ref: "AuthUsage" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const all = await Auth.all()
        const result: Record<
          string,
          {
            accounts: Awaited<ReturnType<typeof Auth.OAuthPool.getUsage>>
            anthropicUsage?: Awaited<ReturnType<typeof Auth.OAuthPool.fetchAnthropicUsage>>
          }
        > = {}

        for (const [providerID, info] of Object.entries(all)) {
          if (info.type === "oauth") {
            const accounts = await Auth.OAuthPool.getUsage(providerID)
            const anthropicUsage = await Auth.OAuthPool.fetchAnthropicUsage(providerID)
            result[providerID] = { accounts, anthropicUsage: anthropicUsage ?? undefined }
          }
        }

        return c.json(result)
      },
    )
    .post(
      "/auth/active",
      describeRoute({
        summary: "Set active OAuth account",
        description: "Switch the active OAuth account for a provider.",
        operationId: "auth.setActive",
        responses: {
          200: {
            description: "Active account switched",
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
        "json",
        z.object({
          providerID: z.string(),
          recordID: z.string(),
          namespace: z.string().optional(),
        }),
      ),
      async (c) => {
        const { providerID, recordID, namespace } = c.req.valid("json")
        await Auth.OAuthPool.setActive(providerID, recordID, namespace ?? "default")
        return c.json(true)
      },
    )
    .delete(
      "/auth/account",
      describeRoute({
        summary: "Delete OAuth account",
        description: "Remove an OAuth account from a provider.",
        operationId: "auth.deleteAccount",
        responses: {
          200: {
            description: "Account deleted",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    remaining: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          providerID: z.string(),
          recordID: z.string(),
        }),
      ),
      async (c) => {
        const { providerID, recordID } = c.req.valid("json")
        const result = await Auth.OAuthPool.removeRecord(providerID, recordID)
        return c.json({ success: result.removed, remaining: result.remaining })
      },
    ),
)
