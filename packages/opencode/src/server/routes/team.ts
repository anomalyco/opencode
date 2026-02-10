import { Hono } from "hono"
import z from "zod"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Team, TeamTasks, TeamInfoSchema, TeamTaskSchema, WRITE_TOOLS } from "@/team"
import { Session } from "@/session"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

const Delegate = z.object({ enabled: z.boolean() })

export const TeamRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List teams",
        description: "List all teams in this project.",
        operationId: "team.list",
        responses: {
          200: {
            description: "List of teams",
            content: { "application/json": { schema: resolver(TeamInfoSchema.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await Team.list())
      },
    )
    .get(
      "/:name",
      describeRoute({
        summary: "Get team",
        description: "Retrieve a team by name.",
        operationId: "team.get",
        responses: {
          200: {
            description: "Team info",
            content: { "application/json": { schema: resolver(TeamInfoSchema) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const team = await Team.get(c.req.valid("param").name)
        if (!team) return c.json({ error: "Team not found" }, 404)
        return c.json(team)
      },
    )
    .get(
      "/:name/tasks",
      describeRoute({
        summary: "List team tasks",
        description: "List all tasks for a team.",
        operationId: "team.tasks.list",
        responses: {
          200: {
            description: "List of tasks",
            content: { "application/json": { schema: resolver(TeamTaskSchema.array()) } },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        return c.json(await TeamTasks.list(c.req.valid("param").name))
      },
    )
    .get(
      "/by-session/:sessionID",
      describeRoute({
        summary: "Find team by session",
        description: "Find the team a session belongs to.",
        operationId: "team.bySession",
        responses: {
          200: { description: "Team info with role and tasks" },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const result = await Team.findBySession(c.req.valid("param").sessionID)
        if (!result) return c.json(null)
        return c.json({
          team: result.team,
          tasks: await TeamTasks.list(result.team.name),
          role: result.role,
          memberName: result.memberName,
        })
      },
    )
    .post(
      "/:name/delegate",
      describeRoute({
        summary: "Toggle delegate mode",
        description: "Enable or disable delegate mode for a team.",
        operationId: "team.delegate",
        responses: {
          200: { description: "Delegate mode updated" },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      validator("json", Delegate),
      async (c) => {
        const { name } = c.req.valid("param")
        const { enabled } = c.req.valid("json")
        const team = await Team.get(name)
        if (!team) return c.json({ error: "Team not found" }, 404)

        await Session.update(team.leadSessionID, (draft) => {
          if (enabled) {
            const existing = draft.permission ?? []
            draft.permission = [
              ...existing,
              // Filter prevents duplicate deny rules from repeated enable toggles
              ...WRITE_TOOLS.filter((tool) => !existing.some((r) => r.permission === tool && r.action === "deny")).map(
                (tool) => ({ permission: tool, pattern: "*", action: "deny" as const }),
              ),
            ]
          } else {
            draft.permission = (draft.permission ?? []).filter(
              (rule) => !((WRITE_TOOLS as readonly string[]).includes(rule.permission) && rule.action === "deny"),
            )
          }
        })

        await Team.setDelegate(name, enabled)
        return c.json({ ok: true, delegate: enabled })
      },
    )
    .post(
      "/:name/cancel",
      describeRoute({
        summary: "Cancel teammates",
        description:
          "Cancel active teammates' prompt loops. " + "Pass { member: name } to cancel one, or omit to cancel all.",
        operationId: "team.cancel",
        responses: {
          200: { description: "Number of cancelled members" },
          ...errors(404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      validator("json", z.object({ member: z.string().optional() })),
      async (c) => {
        const { name } = c.req.valid("param")
        const { member } = c.req.valid("json")
        const team = await Team.get(name)
        if (!team) return c.json({ error: "Team not found" }, 404)

        if (member) {
          const ok = await Team.cancelMember(name, member)
          return c.json({ ok, cancelled: ok ? 1 : 0 })
        }
        const cancelled = await Team.cancelAllMembers(name)
        return c.json({ ok: true, cancelled })
      },
    ),
)
