/**
 * Provider routes: /provider, /provider/auth
 */
import { Hono } from "hono"
import type { Context } from "hono"
import { lazy } from "../lib/lazy.ts"
import { logJson, nowMs } from "../lib/logging.ts"
import { getConvex } from "../../clients/index.ts"
import { api } from "../../../convex/_generated/api.js"
import { getIdentity } from "../middleware/auth.ts"
import { getModelsDevProviders } from "../../services/models-cache.ts"
import type { GatewayContext } from "../context.ts"

export const ProviderRoutes = lazy(() =>
  new Hono<GatewayContext>()
    .get("/", async (c: Context<GatewayContext>) => {
      const t0 = nowMs()
      try {
        const tModels = nowMs()
        const providers = await getModelsDevProviders()
        logJson("info", { kind: "provider.models", durationMs: nowMs() - tModels })

        const all = Object.values(providers)
        const defaults: Record<string, string> = {}
        for (const p of all) {
          const first = Object.keys((p as { models?: Record<string, unknown> }).models ?? {})[0]
          if (first) defaults[(p as { id: string }).id] = first
        }

        let connected: string[] = []
        try {
          // Use identity from middleware context (already authenticated)
          const identity = getIdentity(c)
          const tQuery = nowMs()
          const rows = await getConvex().query(api.aiCredentials.listProviders, {
            organizationId: identity.organizationId,
          })
          logJson("info", { kind: "provider.query", durationMs: nowMs() - tQuery })

          connected = (rows ?? [])
            .filter((x: { hasKey?: boolean }) => x?.hasKey)
            .map((x: { provider: string }) => String(x.provider))
        } catch (err) {
          // Silently ignore credential fetch errors
          logJson("warn", { kind: "provider.creds.failed", error: String(err) })
        }

        logJson("info", { kind: "provider.total", durationMs: nowMs() - t0 })
        c.header("Cache-Control", "no-cache")
        return c.json({ all, default: defaults, connected })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        logJson("warn", { kind: "provider.failed", error: message, durationMs: nowMs() - t0 })
        console.warn("[Gateway] /provider fallback:", message)
        return c.json({ all: [], default: {}, connected: [] })
      }
    })
    .get("/auth", (c) => {
      return c.json({})
    }),
)
