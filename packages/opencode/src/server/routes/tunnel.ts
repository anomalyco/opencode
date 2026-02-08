/**
 * Tunnel Routes
 *
 * API endpoints for managing tunnel connectivity for remote access.
 */

import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Tunnel, detectTailscale, type TunnelStatus, type TailscaleInfo } from "../../tunnel"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

const TunnelStatusSchema = z.object({
  enabled: z.boolean(),
  url: z.string().nullable(),
  provider: z.enum(["cloudflare"]).nullable(),
  tailscale: z
    .object({
      ip: z.string(),
      hostname: z.string(),
    })
    .nullable(),
})

export const TunnelRoutes = lazy(() =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get tunnel status",
        description: "Get the current status of the tunnel and Tailscale connectivity.",
        operationId: "tunnel.status",
        responses: {
          200: {
            description: "Tunnel status",
            content: {
              "application/json": {
                schema: resolver(TunnelStatusSchema),
              },
            },
          },
        },
      }),
      async (c) => {
        const status = Tunnel.getStatus()
        const tailscale = await detectTailscale()
        return c.json({ ...status, tailscale })
      }
    )
    .post(
      "/start",
      describeRoute({
        summary: "Start tunnel",
        description: "Start a Cloudflare tunnel to expose the local server.",
        operationId: "tunnel.start",
        responses: {
          200: {
            description: "Tunnel started",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    enabled: z.literal(true),
                    url: z.string(),
                  })
                ),
              },
            },
          },
          ...errors(500),
        },
      }),
      async (c) => {
        const url = await Tunnel.start()
        return c.json({ enabled: true, url })
      }
    )
    .post(
      "/stop",
      describeRoute({
        summary: "Stop tunnel",
        description: "Stop the running Cloudflare tunnel.",
        operationId: "tunnel.stop",
        responses: {
          200: {
            description: "Tunnel stopped",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    enabled: z.literal(false),
                  })
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        await Tunnel.stop()
        return c.json({ enabled: false })
      }
    )
)
