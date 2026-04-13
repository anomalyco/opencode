import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Flag } from "../../flag/flag"

export const EnvRoutes = () =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "Get environment",
      description: "Retrieve runtime environment values exposed to the client (JupyterHub user, serve domain).",
      operationId: "env.get",
      responses: {
        200: {
          description: "Environment",
          content: {
            "application/json": {
              schema: resolver(
                z
                  .object({
                    serveDomain: z.string().optional(),
                    jupyterhubUser: z.string().optional(),
                  })
                  .meta({
                    ref: "Env",
                  }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({
        ...(Flag.OPENCODE_SERVE_DOMAIN ? { serveDomain: Flag.OPENCODE_SERVE_DOMAIN } : {}),
        ...(Flag.JUPYTERHUB_USER ? { jupyterhubUser: Flag.JUPYTERHUB_USER } : {}),
      })
    },
  )
