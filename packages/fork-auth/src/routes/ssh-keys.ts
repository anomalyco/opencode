import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { SshKey } from "../../../opencode/src/ssh/keys"
import { getAuthContext } from "../middleware/auth"
import { Storage } from "../../../opencode/src/storage/storage"
import { lazy } from "../../../opencode/src/util/lazy"

const SshKeyError = z
  .object({
    message: z.string(),
    help_steps: z.string().array().optional(),
  })
  .meta({
    ref: "SshKeyError",
  })

const SshKeyErrorResponse = z
  .object({
    error: SshKeyError,
  })
  .meta({
    ref: "SshKeyErrorResponse",
  })

function errorInfo(error: unknown): z.infer<typeof SshKeyError> {
  if (error instanceof Error) {
    return { message: error.message }
  }
  return { message: "Request failed." }
}

export const SshKeyRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List SSH keys",
        description: "List SSH keys for the authenticated user.",
        operationId: "sshKeys.list",
        responses: {
          200: {
            description: "List of SSH keys",
            content: {
              "application/json": {
                schema: resolver(SshKey.Info.array()),
              },
            },
          },
          401: {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: resolver(SshKeyErrorResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        const auth = getAuthContext(c)
        if (!auth) {
          return c.json({ error: { message: "Authentication required" } }, 401)
        }
        const keys = await SshKey.list(auth.username)
        return c.json(keys)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create SSH key",
        description: "Add and install an SSH key for the authenticated user.",
        operationId: "sshKeys.create",
        responses: {
          200: {
            description: "SSH key created",
            content: {
              "application/json": {
                schema: resolver(SshKey.Info),
              },
            },
          },
          400: {
            description: "Failed to create SSH key",
            content: {
              "application/json": {
                schema: resolver(SshKeyErrorResponse),
              },
            },
          },
          401: {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: resolver(SshKeyErrorResponse),
              },
            },
          },
        },
      }),
      validator("json", SshKey.Input),
      async (c) => {
        const auth = getAuthContext(c)
        if (!auth) {
          return c.json({ error: { message: "Authentication required" } }, 401)
        }

        try {
          const created = await SshKey.create(c.req.valid("json"), {
            username: auth.username,
          })
          return c.json(created)
        } catch (error) {
          return c.json({ error: errorInfo(error) }, 400)
        }
      },
    )
    .delete(
      "/:keyID",
      describeRoute({
        summary: "Delete SSH key",
        description: "Remove an SSH key and uninstall it from disk.",
        operationId: "sshKeys.delete",
        responses: {
          200: {
            description: "SSH key deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          400: {
            description: "Failed to delete SSH key",
            content: {
              "application/json": {
                schema: resolver(SshKeyErrorResponse),
              },
            },
          },
          401: {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: resolver(SshKeyErrorResponse),
              },
            },
          },
          404: {
            description: "SSH key not found",
            content: {
              "application/json": {
                schema: resolver(SshKeyErrorResponse),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          keyID: z.string(),
        }),
      ),
      async (c) => {
        const auth = getAuthContext(c)
        if (!auth) {
          return c.json({ error: { message: "Authentication required" } }, 401)
        }
        try {
          await SshKey.remove(c.req.valid("param").keyID, {
            username: auth.username,
          })
          return c.json(true)
        } catch (error) {
          if (error instanceof Storage.NotFoundError) {
            return c.json({ error: errorInfo(error) }, 404)
          }
          return c.json({ error: errorInfo(error) }, 400)
        }
      },
    ),
)
