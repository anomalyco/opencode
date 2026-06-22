import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Issue } from "../../issue/issue"
import { AutoProgress } from "../../issue/auto-progress"
import { AppRuntime } from "@/effect/app-runtime"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const IssueRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List issues",
        description: "List all issues (workspace-scoped todos) for the current project directory.",
        operationId: "issue.list",
        responses: {
          200: {
            description: "Issue list",
            content: {
              "application/json": {
                schema: resolver(Issue.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const directory = c.req.query("directory")
        if (!directory) return c.json({ error: "directory query param required" }, 400)
        const issues = await AppRuntime.runPromise(Issue.Service.use((svc) => svc.get({ directory })))
        return c.json(issues)
      },
    )
    .get(
      "/tree",
      describeRoute({
        summary: "Get issue tree",
        description: "Get the L1/L2 issue hierarchy as a tree.",
        operationId: "issue.tree",
        responses: {
          200: {
            description: "Issue tree",
            content: {
              "application/json": {
                schema: resolver(Issue.IssueNode.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const directory = c.req.query("directory")
        if (!directory) return c.json({ error: "directory query param required" }, 400)
        const tree = await AppRuntime.runPromise(Issue.Service.use((svc) => svc.getTree({ directory })))
        return c.json(tree)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create issue",
        description: "Create a new issue (todo) in the workspace.",
        operationId: "issue.create",
        responses: {
          200: {
            description: "Created issue",
            content: {
              "application/json": {
                schema: resolver(Issue.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          directory: z.string(),
          issue: Issue.Info.partial(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const created = await AppRuntime.runPromise(
          Issue.Service.use((svc) => svc.create({ directory: body.directory, issue: body.issue })),
        )
        return c.json(created)
      },
    )
    .patch(
      "/:id",
      describeRoute({
        summary: "Update issue",
        description: "Update fields on an existing issue.",
        operationId: "issue.update",
        responses: {
          200: {
            description: "Updated issue",
            content: {
              "application/json": {
                schema: resolver(Issue.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          directory: z.string(),
          patch: Issue.Info.partial(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { directory, patch } = c.req.valid("json")
        const updated = await AppRuntime.runPromise(Issue.Service.use((svc) => svc.update({ directory, id, patch })))
        return c.json(updated)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete issue",
        description: "Delete an issue from the workspace.",
        operationId: "issue.delete",
        responses: {
          200: {
            description: "Deleted",
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
          id: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          directory: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { directory } = c.req.valid("query")
        await AppRuntime.runPromise(Issue.Service.use((svc) => svc.delete({ directory, id })))
        return c.json(true)
      },
    )
    .post(
      "/:id/status",
      describeRoute({
        summary: "Patch issue status",
        description: "Change the status of an issue (backlog/todo/in_progress/in_review/done/canceled).",
        operationId: "issue.patchStatus",
        responses: {
          200: {
            description: "Updated issue",
            content: {
              "application/json": {
                schema: resolver(Issue.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          directory: z.string(),
          status: Issue.Status,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { directory, status } = c.req.valid("json")
        const updated = await AppRuntime.runPromise(
          Issue.Service.use((svc) => svc.patchStatus({ directory, id, status })),
        )
        return c.json(updated)
      },
    )
    .post(
      "/:id/assignee",
      describeRoute({
        summary: "Patch issue assignee",
        description: "Assign or unassign an issue.",
        operationId: "issue.patchAssignee",
        responses: {
          200: {
            description: "Updated issue",
            content: {
              "application/json": {
                schema: resolver(Issue.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          directory: z.string(),
          assigneeId: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { directory, assigneeId } = c.req.valid("json")
        const updated = await AppRuntime.runPromise(
          Issue.Service.use((svc) => svc.patchAssignee({ directory, id, assigneeId })),
        )
        return c.json(updated)
      },
    )
    .post(
      "/reorder",
      describeRoute({
        summary: "Reorder issues",
        description: "Reorder issues by providing a list of issue IDs in the new order.",
        operationId: "issue.reorder",
        responses: {
          200: {
            description: "Reordered",
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
        "json",
        z.object({
          directory: z.string(),
          ids: z.array(z.string()),
        }),
      ),
      async (c) => {
        const { directory, ids } = c.req.valid("json")
        await AppRuntime.runPromise(Issue.Service.use((svc) => svc.reorder({ directory, ids })))
        return c.json(true)
      },
    )
    .post(
      "/auto-progress/start",
      describeRoute({
        summary: "Start auto-progress",
        description: "Start the L1/L2 auto-progress engine for a workspace directory.",
        operationId: "issue.autoProgressStart",
        responses: {
          200: {
            description: "Started",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          directory: z.string(),
        }),
      ),
      async (c) => {
        const { directory } = c.req.valid("json")
        await AppRuntime.runPromise(AutoProgress.Service.use((svc) => svc.start(directory)))
        return c.json(true)
      },
    )
    .post(
      "/auto-progress/stop",
      describeRoute({
        summary: "Stop auto-progress",
        description: "Stop the L1/L2 auto-progress engine for a workspace directory.",
        operationId: "issue.autoProgressStop",
        responses: {
          200: {
            description: "Stopped",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          directory: z.string(),
        }),
      ),
      async (c) => {
        const { directory } = c.req.valid("json")
        await AppRuntime.runPromise(AutoProgress.Service.use((svc) => svc.stop(directory)))
        return c.json(true)
      },
    )
    .get(
      "/auto-progress/status",
      describeRoute({
        summary: "Auto-progress status",
        description: "Whether the L1/L2 auto-progress engine is currently running for a workspace directory.",
        operationId: "issue.autoProgressStatus",
        responses: {
          200: {
            description: "Status",
            content: {
              "application/json": {
                schema: resolver(z.object({ status: z.enum(["idle", "running"]) })),
              },
            },
          },
        },
      }),
      async (c) => {
        const directory = c.req.query("directory")
        if (!directory) return c.json({ error: "directory query param required" }, 400)
        const status = await AppRuntime.runPromise(AutoProgress.Service.use((svc) => svc.status(directory)))
        return c.json({ status })
      },
    ),
)
