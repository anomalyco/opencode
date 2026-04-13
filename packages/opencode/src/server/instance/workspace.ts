import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { listAdaptors } from "../../control-plane/adaptors"
import { Workspace } from "../../control-plane/workspace"
import { Instance } from "../../project/instance"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const WorkspaceAdaptor = z.object({
  type: z.string(),
  name: z.string(),
  description: z.string(),
})

export const WorkspaceRoutes = lazy(() =>
  new Hono()
    .get(
      "/adaptor",
      describeRoute({
        summary: "List workspace adaptors",
        description: "List all available workspace adaptors for the current project.",
        operationId: "experimental.workspace.adaptor.list",
        responses: {
          200: {
            description: "Workspace adaptors",
            content: {
              "application/json": {
                schema: resolver(z.array(WorkspaceAdaptor)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await listAdaptors(Instance.project.id))
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create workspace",
        description: "Create a workspace for the current project.",
        operationId: "experimental.workspace.create",
        responses: {
          200: {
            description: "Workspace created",
            content: {
              "application/json": {
                schema: resolver(Workspace.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        Workspace.create.schema.omit({
          projectID: true,
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const workspace = await Workspace.create({
          projectID: Instance.project.id,
          ...body,
        })
        return c.json(workspace)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List workspaces",
        description: "List all workspaces.",
        operationId: "experimental.workspace.list",
        responses: {
          200: {
            description: "Workspaces",
            content: {
              "application/json": {
                schema: resolver(z.array(Workspace.Info)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Workspace.list(Instance.project))
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Workspace status",
        description: "Get connection status for workspaces in the current project.",
        operationId: "experimental.workspace.status",
        responses: {
          200: {
            description: "Workspace status",
            content: {
              "application/json": {
                schema: resolver(z.array(Workspace.ConnectionStatus)),
              },
            },
          },
        },
      }),
      async (c) => {
        const ids = new Set(Workspace.list(Instance.project).map((item) => item.id))
        return c.json(Workspace.status().filter((item) => ids.has(item.workspaceID)))
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Remove workspace",
        description: "Remove an existing workspace.",
        operationId: "experimental.workspace.remove",
        responses: {
          200: {
            description: "Workspace removed",
            content: {
              "application/json": {
                schema: resolver(Workspace.Info.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          id: Workspace.Info.shape.id,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        return c.json(await Workspace.remove(id))
      },
    ),
)
