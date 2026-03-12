import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Workspace } from "../../control-plane/workspace"
import { Instance } from "../../project/instance"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { listTypes, detectAdaptor } from "../../control-plane/adaptors"

const TypesResponse = z
  .object({
    types: z.array(z.string()),
    detected: z.string().optional(),
  })
  .meta({ ref: "WorkspaceTypes" })

export const WorkspaceRoutes = lazy(() =>
  new Hono()
    .get(
      "/types",
      describeRoute({
        summary: "List workspace types",
        description: "List available workspace adaptor types and detect the best match for the current project.",
        operationId: "experimental.workspace.types",
        responses: {
          200: {
            description: "Available workspace types",
            content: {
              "application/json": {
                schema: resolver(TypesResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        const types = listTypes()
        const result = await detectAdaptor(Instance.worktree).catch(() => undefined)
        return c.json({ types, detected: result?.type })
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
          projectDirectory: true,
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const workspace = await Workspace.create({
          projectID: Instance.project.id,
          projectDirectory: Instance.worktree,
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
