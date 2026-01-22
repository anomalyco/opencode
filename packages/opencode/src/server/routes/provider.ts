import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { Auth } from "../../auth"
import { AuthBrowser } from "../../auth/browser"
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
        description: "Switch the active OAuth account for a provider. Returns updated usage data.",
        operationId: "auth.setActive",
        responses: {
          200: {
            description: "Active account switched with updated usage",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    anthropicUsage: z.any().optional(),
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
          namespace: z.string().optional(),
        }),
      ),
      async (c) => {
        const { providerID, recordID, namespace } = c.req.valid("json")
        const ns = namespace ?? "default"
        const success = await Auth.OAuthPool.setActive(providerID, ns, recordID)
        // Fetch updated usage for the newly active account
        const anthropicUsage = success ? await Auth.OAuthPool.fetchAnthropicUsage(providerID, ns, recordID) : null
        return c.json({ success, anthropicUsage: anthropicUsage ?? undefined })
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
    )
    // Browser session routes for auto-relogin
    .get(
      "/auth/browser/sessions",
      describeRoute({
        summary: "List browser sessions",
        description: "Get status of all browser sessions configured for auto-relogin.",
        operationId: "provider.browser.sessions",
        responses: {
          200: {
            description: "List of browser sessions",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      recordId: z.string(),
                      enabled: z.boolean(),
                      profilePath: z.string(),
                      lastRefresh: z.number().optional(),
                      lastError: z.string().optional(),
                      isConfigured: z.boolean(),
                      label: z.string().optional(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const sessions = await AuthBrowser.listAll()
        const accounts = await Auth.OAuthPool.list("anthropic", "default")
        const accountMap = new Map(accounts.map((a) => [a.id, a]))

        const result = sessions.map((s) => ({
          ...s,
          label: accountMap.get(s.recordId)?.label,
        }))

        return c.json(result)
      },
    )
    .get(
      "/auth/browser/sessions/:recordId",
      describeRoute({
        summary: "Get browser session status",
        description: "Get status of a specific browser session.",
        operationId: "provider.browser.session.status",
        responses: {
          200: {
            description: "Browser session status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    recordId: z.string(),
                    enabled: z.boolean(),
                    profilePath: z.string(),
                    lastRefresh: z.number().optional(),
                    lastError: z.string().optional(),
                    isConfigured: z.boolean(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          recordId: z.string().meta({ description: "OAuth record ID" }),
        }),
      ),
      async (c) => {
        const { recordId } = c.req.valid("param")
        const session = await AuthBrowser.status(recordId)
        return c.json(session)
      },
    )
    .post(
      "/auth/browser/sessions/:recordId/setup",
      describeRoute({
        summary: "Setup browser session",
        description:
          "Start browser session setup. Opens a visible browser for user to log in. Returns tokens on success.",
        operationId: "provider.browser.session.setup",
        responses: {
          200: {
            description: "Browser session setup successful",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    message: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 500),
        },
      }),
      validator(
        "param",
        z.object({
          recordId: z.string().meta({ description: "OAuth record ID" }),
        }),
      ),
      async (c) => {
        const { recordId } = c.req.valid("param")

        // Verify the account exists
        const accounts = await Auth.OAuthPool.list("anthropic", "default")
        const account = accounts.find((a) => a.id === recordId)
        if (!account) {
          return c.json({ success: false, message: "Account not found" }, 400)
        }

        try {
          const tokens = await AuthBrowser.setup(recordId)

          // Update the auth store with new tokens
          await Auth.OAuthPool.updateRecord("anthropic", recordId, "default", {
            access: tokens.access,
            refresh: tokens.refresh,
            expires: tokens.expires,
          })

          return c.json({
            success: true,
            message: "Browser session configured successfully",
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ success: false, message }, 500)
        }
      },
    )
    .post(
      "/auth/browser/sessions/:recordId/refresh",
      describeRoute({
        summary: "Refresh tokens via browser session",
        description: "Attempt to refresh OAuth tokens using the existing browser session (headless).",
        operationId: "provider.browser.session.refresh",
        responses: {
          200: {
            description: "Token refresh result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    message: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 500),
        },
      }),
      validator(
        "param",
        z.object({
          recordId: z.string().meta({ description: "OAuth record ID" }),
        }),
      ),
      async (c) => {
        const { recordId } = c.req.valid("param")

        const session = await AuthBrowser.status(recordId)
        if (!session.isConfigured) {
          return c.json({ success: false, message: "Browser session not configured" }, 400)
        }

        try {
          const tokens = await AuthBrowser.refresh(recordId)

          // Update the auth store with new tokens
          await Auth.OAuthPool.updateRecord("anthropic", recordId, "default", {
            access: tokens.access,
            refresh: tokens.refresh,
            expires: tokens.expires,
          })

          return c.json({
            success: true,
            message: "Tokens refreshed successfully",
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ success: false, message }, 500)
        }
      },
    )
    .delete(
      "/auth/browser/sessions/:recordId",
      describeRoute({
        summary: "Remove browser session",
        description: "Remove a browser session and its stored profile data.",
        operationId: "provider.browser.session.remove",
        responses: {
          200: {
            description: "Browser session removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 500),
        },
      }),
      validator(
        "param",
        z.object({
          recordId: z.string().meta({ description: "OAuth record ID" }),
        }),
      ),
      async (c) => {
        const { recordId } = c.req.valid("param")

        try {
          await AuthBrowser.remove(recordId)
          return c.json(true)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ error: message }, 500)
        }
      },
    ),
)
