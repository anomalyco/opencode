import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { PatchrightLauncher } from "../../browser/patchright"
import { lazy } from "../../util/lazy"

/**
 * Browser routes — expose CDP connection info for the desktop app.
 * The desktop app connects directly to Chrome's CDP port (launched by Patchright)
 * to stream the viewport via Page.screencastFrame.
 */
export const BrowserRoutes = lazy(() =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get browser status",
        description: "Get the current browser status including CDP port for direct connection.",
        operationId: "browser.status",
        responses: {
          200: {
            description: "Browser status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    running: z.boolean(),
                    cdpPort: z.number().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const running = PatchrightLauncher.isRunning()
        const cdpPort = PatchrightLauncher.getCdpPort()
        return c.json({ running, cdpPort })
      },
    ),
)
