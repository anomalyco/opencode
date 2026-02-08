import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { CoordTeam, CoordTask, CoordInbox, CoordProtocol, CoordSession, CoordSummary } from "@/coord"
import { errors } from "../error"

export const CoordRoutes = lazy(() =>
  new Hono()
    .get(
      "/team",
      describeRoute({
        summary: "List coordination teams",
        description: "List all coordination teams in the current project.",
        operationId: "coord.team.list",
        responses: {
          200: {
            description: "List of teams",
            content: { "application/json": { schema: resolver(CoordTeam.TeamConfig.array()) } },
          },
        },
      }),
      async (c) => {
        const teams = await CoordTeam.listTeams()
        return c.json(teams)
      },
    )
    .post(
      "/team",
      describeRoute({
        summary: "Create coordination team",
        description: "Create a new coordination team.",
        operationId: "coord.team.create",
        responses: {
          200: {
            description: "Created team",
            content: { "application/json": { schema: resolver(CoordTeam.TeamConfig) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          team_id: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const team = await CoordTeam.createTeam({
          id: body.team_id,
          name: body.name ?? body.team_id,
          description: body.description,
        })
        return c.json(team)
      },
    )
    .get(
      "/team/:teamID",
      describeRoute({
        summary: "Get coordination team",
        description: "Get a coordination team by ID.",
        operationId: "coord.team.get",
        responses: {
          200: {
            description: "Team",
            content: { "application/json": { schema: resolver(CoordTeam.TeamConfig) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ teamID: z.string() })),
      async (c) => {
        const team = await CoordTeam.getTeam(c.req.valid("param").teamID)
        if (!team) throw new Error("Team not found")
        return c.json(team)
      },
    )
    .delete(
      "/team/:teamID",
      describeRoute({
        summary: "Delete coordination team",
        description: "Delete a coordination team.",
        operationId: "coord.team.delete",
        responses: {
          200: {
            description: "Deleted",
            content: {
              "application/json": {
                schema: resolver(z.object({ deleted: z.boolean(), sessions: z.array(z.string()) })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ teamID: z.string() })),
      async (c) => {
        const teamID = c.req.valid("param").teamID
        const sessions = await CoordSession.clearTeam(teamID)
        await CoordTeam.deleteTeam(teamID)
        return c.json({ deleted: true, sessions })
      },
    )
    .delete(
      "/team/:teamID/member/:name",
      describeRoute({
        summary: "Remove team member",
        description: "Remove a member from a coordination team.",
        operationId: "coord.member.remove",
        responses: {
          200: {
            description: "Removed",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ teamID: z.string(), name: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        await CoordTeam.removeMember({ teamID: params.teamID, name: params.name })
        return c.json(true)
      },
    )
    .post(
      "/team/:teamID/message",
      describeRoute({
        summary: "Send team message",
        description: "Send a message to a team member.",
        operationId: "coord.message.send",
        responses: {
          200: {
            description: "Sent",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          recipient: z.string(),
          message: CoordProtocol.MessageInputSchema,
          from: z.string().optional(),
        }),
      ),
      validator("param", z.object({ teamID: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const message = { ...body.message, from: body.from ?? "coord" }
        await CoordInbox.sendMessage({ teamID: params.teamID, recipient: body.recipient, message })
        return c.json(true)
      },
    )
    .get(
      "/team/:teamID/inbox/:member",
      describeRoute({
        summary: "Read inbox",
        description: "Read a team member inbox.",
        operationId: "coord.inbox",
        responses: {
          200: {
            description: "Inbox",
            content: { "application/json": { schema: resolver(CoordProtocol.Message.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ teamID: z.string(), member: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const messages = await CoordInbox.inbox({ teamID: params.teamID, member: params.member })
        return c.json(messages)
      },
    )
    .post(
      "/team/:teamID/inbox/:member/read",
      describeRoute({
        summary: "Mark inbox read",
        description: "Mark messages as read.",
        operationId: "coord.inbox.read",
        responses: {
          200: {
            description: "Updated",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          index: z.number().int().optional(),
        }),
      ),
      validator("param", z.object({ teamID: z.string(), member: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        await CoordInbox.markRead({ teamID: params.teamID, member: params.member, index: body.index })
        return c.json(true)
      },
    )
    .get(
      "/team/:teamID/task",
      describeRoute({
        summary: "List tasks",
        description: "List tasks for a coordination team.",
        operationId: "coord.task.list",
        responses: {
          200: {
            description: "Task list",
            content: { "application/json": { schema: resolver(CoordTask.TaskSummary.array()) } },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ teamID: z.string() })),
      async (c) => {
        const tasks = await CoordTask.listTasks(c.req.valid("param").teamID)
        return c.json(tasks)
      },
    )
    .post(
      "/team/:teamID/task",
      describeRoute({
        summary: "Create task",
        description: "Create a task for a coordination team.",
        operationId: "coord.task.create",
        responses: {
          200: {
            description: "Task",
            content: { "application/json": { schema: resolver(CoordTask.Task) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          subject: z.string(),
          description: z.string().optional(),
          active_form: z.string().optional(),
          blocked_by: z.array(z.string()).optional(),
        }),
      ),
      validator("param", z.object({ teamID: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const task = await CoordTask.createTask({
          teamID: params.teamID,
          subject: body.subject,
          description: body.description,
          activeForm: body.active_form,
          blockedBy: body.blocked_by,
        })
        return c.json(task)
      },
    )
    .patch(
      "/team/:teamID/task/:taskID",
      describeRoute({
        summary: "Update task",
        description: "Update a coordination task.",
        operationId: "coord.task.update",
        responses: {
          200: {
            description: "Task",
            content: { "application/json": { schema: resolver(CoordTask.Task) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          subject: z.string().optional(),
          description: z.string().optional(),
          status: z.enum(["pending", "in_progress", "completed", "deleted"]).optional(),
          owner: z.string().optional(),
        }),
      ),
      validator("param", z.object({ teamID: z.string(), taskID: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const task = await CoordTask.updateTask(params.teamID, params.taskID, {
          subject: body.subject,
          description: body.description,
          status: body.status,
          owner: body.owner,
        })
        if (!task) throw new Error("Task not found")
        return c.json(task)
      },
    )
    .post(
      "/team/:teamID/task/:taskID/claim",
      describeRoute({
        summary: "Claim task",
        description: "Claim a coordination task.",
        operationId: "coord.task.claim",
        responses: {
          200: {
            description: "Task",
            content: { "application/json": { schema: resolver(CoordTask.Task) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          owner: z.string(),
        }),
      ),
      validator("param", z.object({ teamID: z.string(), taskID: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await CoordTask.claimTask(params.teamID, params.taskID, body.owner)
        if ("error" in result) throw new Error(result.error)
        return c.json(result)
      },
    )
    .post(
      "/team/:teamID/task/:taskID/complete",
      describeRoute({
        summary: "Complete task",
        description: "Complete a coordination task.",
        operationId: "coord.task.complete",
        responses: {
          200: {
            description: "Task",
            content: { "application/json": { schema: resolver(CoordTask.Task) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ teamID: z.string(), taskID: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const task = await CoordTask.completeTask(params.teamID, params.taskID)
        if (!task) throw new Error("Task not found")
        return c.json(task)
      },
    )

    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Get session team",
        description: "Get coordination team summary for a session.",
        operationId: "coord.session",
        responses: {
          200: {
            description: "Session summary",
            content: { "application/json": { schema: resolver(CoordSummary.TeamSummary.nullable()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const link = await CoordSession.getTeam(sessionID)
        if (!link) return c.json(null)
        const summary = await CoordSummary.summarize(sessionID, link.teamID)
        return c.json(summary ?? null)
      },
    ),
)
