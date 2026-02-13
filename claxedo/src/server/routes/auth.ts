/**
 * Auth routes: PUT /auth/:providerID
 * OpenCode-compatible endpoint: store provider credentials (encrypted) in Convex.
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { extractApiKeyFromAuthPayload, storeProviderCredential } from "../../services/identity.ts"
import { getIdentity } from "../middleware/auth.ts"
import type { GatewayContext } from "../context.ts"

export const AuthRoutes = lazy(() =>
  new Hono<GatewayContext>().put("/:providerID", async (c) => {
    const providerID = c.req.param("providerID")
    const body = (await c.req.json().catch(() => null)) as any

    if (!extractApiKeyFromAuthPayload(body)) {
      return c.json({ error: "Invalid auth payload (expected { type: 'api', key: string })" }, 400)
    }

    const identity = getIdentity(c)

    await storeProviderCredential({
      providerID,
      authPayload: body,
      organizationId: identity.organizationId,
    })

    return c.json(true)
  }),
)
