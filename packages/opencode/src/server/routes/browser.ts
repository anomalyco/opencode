import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Bus } from "../../bus"
import { Browser } from "../../browser"
import { lazy } from "../../util/lazy"

export const BrowserRoutes = lazy(() =>
  new Hono().post(
    "/open",
    describeRoute({
      summary: "Browser open callback",
      description: "Callback endpoint for terminal processes to request opening a URL in a browser.",
      operationId: "browser.open",
      responses: {
        200: {
          description: "Browser open request received",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        url: z.string(),
        sessionID: z.string(),
        messageID: z.string(),
      }),
    ),
    async (c) => {
      const { url, sessionID, messageID } = c.req.valid("json")
      await Bus.publish(Browser.OpenRequested, { url, sessionID, messageID })
      return c.json(true)
    },
  ),
)
