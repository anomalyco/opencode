import { Hono, type Context } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { MultiRootWorkspace } from "@/workspace"
import { MultiRootWorkspaceID } from "@/workspace/schema"
import { jsonRequest } from "./trace"
import { errors } from "../../error"

function isWorkspaceNotFoundError(err: unknown): err is MultiRootWorkspace.WorkspaceNotFoundError {
  return err instanceof MultiRootWorkspace.WorkspaceNotFoundError
}

function isWorkspaceDuplicateNameError(err: unknown): err is MultiRootWorkspace.WorkspaceDuplicateNameError {
  return err instanceof MultiRootWorkspace.WorkspaceDuplicateNameError
}

async function handleWorkspaceErrors<A>(c: Context, promise: Promise<A>): Promise<A | Response> {
  try {
    return await promise
  } catch (err) {
    if (isWorkspaceNotFoundError(err)) {
      return c.json({ error: "Not found" }, 404)
    }
    if (isWorkspaceDuplicateNameError(err)) {
      return c.json({ error: "Duplicate name" }, 400)
    }
    throw err
  }
}

export const WorkspaceRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all workspaces",
        description: "Get a list of all multi-root workspaces.",
        operationId: "workspace.list",
        responses: {
          200: {
            description: "List of workspaces",
            content: {
              "application/json": {
                schema: resolver(MultiRootWorkspace.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("WorkspaceRoutes.list", c, function* () {
          const svc = yield* MultiRootWorkspace.Service
          return yield* svc.list()
        }),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create workspace",
        description: "Create a new multi-root workspace with folders.",
        operationId: "workspace.create",
        responses: {
          201: {
            description: "Created workspace",
            content: {
              "application/json": {
                schema: resolver(MultiRootWorkspace.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          folders: z.array(
            z.object({
              path: z.string(),
              name: z.string().optional(),
            }),
          ),
        }),
      ),
      async (c) =>
        handleWorkspaceErrors(
          c,
          jsonRequest("WorkspaceRoutes.create", c, function* () {
            const body = c.req.valid("json")
            const svc = yield* MultiRootWorkspace.Service
            const workspace = yield* svc.create(body)
            c.status(201)
            return workspace
          }),
        ),
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get workspace",
        description: "Get a workspace by ID.",
        operationId: "workspace.get",
        responses: {
          200: {
            description: "Workspace",
            content: {
              "application/json": {
                schema: resolver(MultiRootWorkspace.Info.zod),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: MultiRootWorkspaceID.zod })),
      async (c) =>
        jsonRequest("WorkspaceRoutes.get", c, function* () {
          const id = c.req.valid("param").id
          const svc = yield* MultiRootWorkspace.Service
          const workspace = yield* svc.open(id)
          if (!workspace) {
            return c.json({ error: "Not found" }, 404)
          }
          return workspace
        }),
    )
    .put(
      "/:id",
      describeRoute({
        summary: "Update workspace",
        description: "Update a workspace by adding or removing folders, or renaming.",
        operationId: "workspace.update",
        responses: {
          200: {
            description: "Updated workspace",
            content: {
              "application/json": {
                schema: resolver(MultiRootWorkspace.Info.zod),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: MultiRootWorkspaceID.zod })),
      validator(
        "json",
        z.discriminatedUnion("action", [
          z.object({
            action: z.literal("addFolder"),
            folder: z.object({
              path: z.string(),
              name: z.string().optional(),
            }),
          }),
          z.object({
            action: z.literal("removeFolder"),
            path: z.string(),
          }),
          z.object({
            action: z.literal("rename"),
            name: z.string().min(1),
          }),
        ]),
      ),
      async (c) =>
        handleWorkspaceErrors(
          c,
          jsonRequest("WorkspaceRoutes.update", c, function* () {
            const id = c.req.valid("param").id
            const body = c.req.valid("json")
            const svc = yield* MultiRootWorkspace.Service

            if (body.action === "addFolder") {
              return yield* svc.addFolder(id, body.folder)
            }

            if (body.action === "rename") {
              return yield* svc.rename(id, body.name)
            }

            return yield* svc.removeFolder(id, body.path)
          }),
        ),
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete workspace",
        description: "Delete a workspace by ID.",
        operationId: "workspace.delete",
        responses: {
          204: {
            description: "Workspace deleted",
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: MultiRootWorkspaceID.zod })),
      async (c) =>
        handleWorkspaceErrors(
          c,
          jsonRequest("WorkspaceRoutes.delete", c, function* () {
            const id = c.req.valid("param").id
            const svc = yield* MultiRootWorkspace.Service
            yield* svc.delete(id)
            c.status(204)
            return null
          }),
        ),
    ),
)
