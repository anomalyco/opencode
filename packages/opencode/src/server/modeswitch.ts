import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { ModeSwitch } from "../mode-switch"
import z from "zod"
import { errors } from "./error"

export const ModeSwitchRoute = new Hono()
  .get(
    "/",
    describeRoute({
      summary: "List pending mode switch requests",
      description: "Get all pending mode switch requests across all sessions.",
      operationId: "modeswitch.list",
      responses: {
        200: {
          description: "List of pending mode switch requests",
          content: {
            "application/json": {
              schema: resolver(ModeSwitch.Request.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const requests = await ModeSwitch.list()
      return c.json(requests)
    },
  )
  .post(
    "/:requestID/reply",
    describeRoute({
      summary: "Reply to mode switch request",
      description: "Approve or reject a mode switch request from the AI assistant.",
      operationId: "modeswitch.reply",
      responses: {
        200: {
          description: "Mode switch request handled successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        requestID: z.string(),
      }),
    ),
    validator(
      "json",
      z.object({
        reply: ModeSwitch.Reply,
      }),
    ),
    async (c) => {
      const params = c.req.valid("param")
      const json = c.req.valid("json")
      await ModeSwitch.reply({
        requestID: params.requestID,
        reply: json.reply,
      })
      return c.json(true)
    },
  )
