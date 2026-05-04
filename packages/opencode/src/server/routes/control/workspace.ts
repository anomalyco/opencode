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
import * as Log from "@opencode-ai/core/util/log"
import { errorData } from "@/util/error"

const log = Log.create({ service: "server.workspace" })

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
      "/:id/session-restore",
      describeRoute({
        summary: "Restore session into workspace",
        description: "Replay a session's sync events into the target workspace in batches.",
        operationId: "experimental.workspace.sessionRestore",
        responses: {
          200: {
            description: "Session replay started",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    total: z.number().int().min(0),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ id: zodObject(Workspace.Info).shape.id })),
      validator("json", Workspace.SessionRestoreInput.zodObject.omit({ workspaceID: true })),
      async (c) => {
        const { id } = c.req.valid("param")
        const body = c.req.valid("json") as Omit<Workspace.SessionRestoreInput, "workspaceID">
        log.info("session restore route requested", {
          workspaceID: id,
          sessionID: body.sessionID,
          directory: Instance.directory,
        })
        try {
          const result = await AppRuntime.runPromise(
            Workspace.Service.use((svc) =>
              svc.sessionRestore({
                workspaceID: id,
                ...body,
              }),
            ),
          )
          log.info("session restore route complete", {
            workspaceID: id,
            sessionID: body.sessionID,
            total: result.total,
          })
          return c.json(result)
        } catch (err) {
          log.error("session restore route failed", {
            workspaceID: id,
            sessionID: body.sessionID,
            error: errorData(err),
          })
          throw err
        }
      },
    ),
)
