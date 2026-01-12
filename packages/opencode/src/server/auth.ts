import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "./error"
import { Auth } from "../auth"

export const AuthRoute = new Hono().put(
  "/:providerID",
  describeRoute({
    summary: "Set auth credentials",
    description: "Set authentication credentials",
    operationId: "auth.set",
    responses: {
      200: {
        description: "Successfully set authentication credentials",
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
      providerID: z.string(),
    }),
  ),
  validator("json", Auth.Info),
  async (c) => {
    const providerID = c.req.valid("param").providerID
    const info = c.req.valid("json")
    await Auth.set(providerID, info)
    return c.json(true)
  },
)
