// kilocode_change - Kilo Gateway server routes
/**
 * Kilo Gateway specific routes
 * Handles profile fetching and organization management for Kilo Gateway provider
 *
 * This factory function accepts OpenCode dependencies to create Kilo-specific routes
 */

import { fetchProfile, fetchBalance } from "../api/profile.js"
import { fetchKilocodeNotifications, KilocodeNotificationSchema } from "../api/notifications.js"
import { KILO_API_BASE } from "../api/constants.js"

// Type definitions for OpenCode dependencies (injected at runtime)
type Hono = any
type DescribeRoute = any
type Validator = any
type Resolver = any
type Errors = any
type Auth = any
type Z = any

interface KiloRoutesDeps {
  Hono: new () => Hono
  describeRoute: DescribeRoute
  validator: Validator
  resolver: Resolver
  errors: Errors
  Auth: Auth
  z: Z
}

/**
 * Create Kilo Gateway routes with OpenCode dependencies injected
 *
 * @example
 * ```typescript
 * import { createKiloRoutes } from "@kilocode/kilo-gateway"
 * import { Hono } from "hono"
 * import { describeRoute, validator, resolver } from "hono-openapi"
 * import z from "zod"
 * import { errors } from "../error"
 * import { Auth } from "../../auth"
 *
 * export const KiloRoutes = createKiloRoutes({
 *   Hono,
 *   describeRoute,
 *   validator,
 *   resolver,
 *   errors,
 *   Auth,
 *   z,
 * })
 * ```
 */
export function createKiloRoutes(deps: KiloRoutesDeps) {
  const { Hono, describeRoute, validator, resolver, errors, Auth, z } = deps

  const Organization = z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
  })

  const Profile = z.object({
    email: z.string(),
    name: z.string().optional(),
    organizations: z.array(Organization).optional(),
  })

  const Balance = z.object({
    balance: z.number(),
  })

  const ProfileWithBalance = z.object({
    profile: Profile,
    balance: Balance.nullable(),
    currentOrgId: z.string().nullable(),
  })

  return new Hono()
    .get(
      "/profile",
      describeRoute({
        summary: "Get Kilo Gateway profile",
        description: "Fetch user profile and organizations from Kilo Gateway",
        operationId: "kilo.profile",
        responses: {
          200: {
            description: "Profile data",
            content: {
              "application/json": {
                schema: resolver(ProfileWithBalance),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      async (c: any) => {
        // Get Kilo auth
        const auth = await Auth.get("kilo")

        if (!auth || auth.type !== "oauth") {
          return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)
        }

        const token = auth.access
        const currentOrgId = auth.accountId ?? null

        // Fetch profile and balance in parallel
        // Pass organizationId to fetchBalance to get team balance when in org context
        const [profile, balance] = await Promise.all([
          fetchProfile(token),
          fetchBalance(token, currentOrgId ?? undefined),
        ])

        return c.json({ profile, balance, currentOrgId })
      },
    )
    .post(
      "/organization",
      describeRoute({
        summary: "Update Kilo Gateway organization",
        description: "Switch to a different Kilo Gateway organization",
        operationId: "kilo.organization.set",
        responses: {
          200: {
            description: "Organization updated successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      validator(
        "json",
        z.object({
          organizationId: z.string().nullable(),
        }),
      ),
      async (c: any) => {
        const { organizationId } = c.req.valid("json")

        // Get current Kilo auth
        const auth = await Auth.get("kilo")

        if (!auth || auth.type !== "oauth") {
          return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)
        }

        // Update auth with new organization ID
        await Auth.set("kilo", {
          type: "oauth",
          refresh: auth.refresh,
          access: auth.access,
          expires: auth.expires,
          ...(organizationId && { accountId: organizationId }),
        })

        return c.json(true)
      },
    )
    .post(
      "/fim",
      describeRoute({
        summary: "FIM completion",
        description: "Proxy a Fill-in-the-Middle completion request to the Kilo Gateway",
        operationId: "kilo.fim",
        responses: {
          200: {
            description: "Streaming FIM completion response",
            content: {
              "text/event-stream": {
                schema: resolver(z.any()),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      validator(
        "json",
        z.object({
          prefix: z.string(),
          suffix: z.string(),
          model: z.string().optional(),
          maxTokens: z.number().optional(),
          temperature: z.number().optional(),
        }),
      ),
      async (c: any) => {
        const auth = await Auth.get("kilo")

        if (!auth) {
          return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)
        }

        const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
        if (!token) {
          return c.json({ error: "No valid token found" }, 401)
        }

        const { prefix, suffix, model, maxTokens, temperature } = c.req.valid("json")
        const fimModel = model ?? "mistralai/codestral-2501"
        const fimMaxTokens = maxTokens ?? 256
        const fimTemperature = temperature ?? 0.2

        const baseApiUrl = KILO_API_BASE + "/api/"
        const endpoint = new URL("fim/completions", baseApiUrl)

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            model: fimModel,
            prompt: prefix,
            suffix,
            max_tokens: fimMaxTokens,
            temperature: fimTemperature,
            stream: true,
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          return c.json({ error: `FIM request failed: ${response.status} ${errorText}` }, response.status as any)
        }

        // Stream the response through
        return new Response(response.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        })
      },
    )
    .get(
      "/notifications",
      describeRoute({
        summary: "Get Kilo notifications",
        description: "Fetch notifications from Kilo Gateway for CLI display",
        operationId: "kilo.notifications",
        responses: {
          200: {
            description: "Notifications list",
            content: {
              "application/json": {
                schema: resolver(z.array(KilocodeNotificationSchema)),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      async (c: any) => {
        const auth = await Auth.get("kilo")
        if (!auth) return c.json([])

        const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
        if (!token) return c.json([])

        const organizationId = auth.type === "oauth" ? auth.accountId : undefined
        const notifications = await fetchKilocodeNotifications({
          kilocodeToken: token,
          kilocodeOrganizationId: organizationId,
        })

        return c.json(notifications)
      },
    )
}
