import { HostedAuth } from "@/hosted/auth"
import { HostedWorkspace } from "@/hosted/workspace"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "@/util/lazy"
import z from "zod"

export const WorkspaceRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List hosted workspaces",
        operationId: "workspace.list",
        responses: {
          200: {
            description: "Hosted workspaces",
            content: {
              "application/json": {
                schema: resolver(HostedWorkspace.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        HostedAuth.requireUser()
        return c.json(await HostedWorkspace.list({ enabled: true }))
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create hosted workspace",
        operationId: "workspace.create",
        responses: {
          200: {
            description: "Created hosted workspace",
            content: {
              "application/json": {
                schema: resolver(HostedWorkspace.Info),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string().optional(),
          path: z.string(),
        }),
      ),
      async (c) => {
        const user = HostedAuth.requireAdmin()
        const body = c.req.valid("json")
        return c.json(await HostedWorkspace.create({ ...body, created_by: user.id }))
      },
    )
    .patch(
      "/:workspaceID",
      describeRoute({
        summary: "Update hosted workspace",
        operationId: "workspace.update",
        responses: {
          200: {
            description: "Updated hosted workspace",
            content: {
              "application/json": {
                schema: resolver(HostedWorkspace.Info),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          workspaceID: HostedWorkspace.Info.shape.id,
        }),
      ),
      validator(
        "json",
        z.object({
          name: z.string().optional(),
          enabled: z.boolean().optional(),
        }),
      ),
      async (c) => {
        HostedAuth.requireAdmin()
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await HostedWorkspace.update({ workspaceID: param.workspaceID, ...body }))
      },
    ),
)
