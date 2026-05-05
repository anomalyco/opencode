import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { listAdapters } from "@/control-plane/adapters"
import { Workspace } from "@/control-plane/workspace"
import { AppRuntime } from "@/effect/app-runtime"
import { WorkspaceAdapterEntry } from "@/control-plane/types"
import { zodObject } from "@/util/effect-zod"
import { Instance } from "@/project/instance"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"

export const WorkspaceRoutes = lazy(() =>
  new Hono()
    .get(
      "/adapter",
      describeRoute({
        summary: "List workspace adapters",
        description: "List all available workspace adapters for the current project.",
        operationId: "experimental.workspace.adapter.list",
        responses: {
          200: {
            description: "Workspace adapters",
            content: {
              "application/json": {
                schema: resolver(z.array(zodObject(WorkspaceAdapterEntry))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await listAdapters(Instance.project.id))
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
                schema: resolver(Workspace.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        Workspace.CreateInput.zodObject.omit({
          projectID: true,
        }),
      ),
      async (c) => {
        const body = c.req.valid("json") as Omit<Workspace.CreateInput, "projectID">
        const workspace = await AppRuntime.runPromise(
          Workspace.Service.use((svc) =>
            svc.create({
              projectID: Instance.project.id,
              ...body,
            }),
          ),
        )
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
                schema: resolver(z.array(Workspace.Info.zod)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await AppRuntime.runPromise(Workspace.Service.use((svc) => svc.list(Instance.project))))
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
                schema: resolver(z.array(zodObject(Workspace.ConnectionStatus))),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await AppRuntime.runPromise(
          Workspace.Service.use((svc) => Effect.all([svc.list(Instance.project), svc.status()])),
        )
        const ids = new Set(result[0].map((item) => item.id))
        return c.json(result[1].filter((item) => ids.has(item.workspaceID)))
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
                schema: resolver(Workspace.Info.zod.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          id: zodObject(Workspace.Info).shape.id,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        return c.json(await AppRuntime.runPromise(Workspace.Service.use((svc) => svc.remove(id))))
      },
    )
    .post(
      "/warp",
      describeRoute({
        summary: "Warp session into workspace",
        description: "Move a session's sync history into the target workspace, or detach it to the local project.",
        operationId: "experimental.workspace.warp",
        responses: {
          204: {
            description: "Session warped",
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          id: zodObject(Workspace.Info).shape.id.nullable(),
          sessionID: Workspace.SessionWarpInput.zodObject.shape.sessionID,
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await AppRuntime.runPromise(
          Workspace.Service.use((workspace) =>
            workspace.sessionWarp({
              workspaceID: body.id,
              sessionID: body.sessionID,
            }),
          ),
        )
        return c.body(null, 204)
      },
    ),
)
