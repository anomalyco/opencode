import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Dialog } from "../../dialog"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const DialogRoutes = lazy(() =>
  new Hono().post(
    "/:dialogID/reply",
    describeRoute({
      summary: "Reply to dialog",
      description: "Provide a response to a dialog request from a plugin.",
      operationId: "dialog.reply",
      responses: {
        200: {
          description: "Dialog replied successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ dialogID: z.string() })),
    validator(
      "json",
      z.object({
        value: z.any().optional(),
        dismissed: z.boolean(),
      }),
    ),
    async (c) => {
      const params = c.req.valid("param")
      const json = c.req.valid("json")
      await Dialog.reply({
        dialogID: params.dialogID,
        value: json.value,
        dismissed: json.dismissed,
      })
      return c.json(true)
    },
  ),
)
