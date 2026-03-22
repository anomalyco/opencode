import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Team } from "../../team"
import { TeamTask } from "../../team/task"
import { TeamID, TeamTaskID } from "../../team/schema"
import { SessionID } from "@/session/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const TeamRoutes = lazy(() =>
  new Hono()
    .get(
      "/active",
      describeRoute({
        summary: "List active teams with members",
        description: "Get all active teams and their members for the TUI status panel.",
        operationId: "team.active",
        responses: {
          200: {
            description: "Active teams with members",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      team: Team.Info,
                      members: Team.Member.array(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const teams = Team.active()
        const result = teams.map((team) => ({
          team,
          members: Team.members(team.id),
        }))
        return c.json(result)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List teams",
        description: "Get teams for a session.",
        operationId: "team.list",
        responses: {
          200: {
            description: "List of teams",
            content: {
              "application/json": {
                schema: resolver(Team.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          session_id: z.string().meta({ description: "Session ID of the team lead" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const teams = Team.bySession(SessionID.make(query.session_id))
        return c.json(teams)
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get team",
        operationId: "team.get",
        responses: {
          200: {
            description: "Team details",
            content: {
              "application/json": {
                schema: resolver(Team.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const id = TeamID.make(c.req.param("id"))
        const team = Team.get(id)
        if (!team) return c.json({ error: "Team not found" }, 404)
        return c.json(team)
      },
    )
    .get(
      "/:id/members",
      describeRoute({
        summary: "List team members",
        operationId: "team.members",
        responses: {
          200: {
            description: "Team members",
            content: {
              "application/json": {
                schema: resolver(Team.Member.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const id = TeamID.make(c.req.param("id"))
        return c.json(Team.members(id))
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create team",
        operationId: "team.create",
        responses: {
          200: {
            description: "Created team",
            content: {
              "application/json": {
                schema: resolver(Team.Info),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          session_id: z.string(),
          agent: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const team = Team.create({
          name: body.name,
          sessionID: SessionID.make(body.session_id),
          agent: body.agent,
        })
        return c.json(team)
      },
    )
    .post(
      "/:id/disband",
      describeRoute({
        summary: "Disband team",
        operationId: "team.disband",
        responses: {
          200: {
            description: "Team disbanded",
          },
        },
      }),
      async (c) => {
        const id = TeamID.make(c.req.param("id"))
        Team.disband(id)
        return c.json({ ok: true })
      },
    )
    .get(
      "/:id/tasks",
      describeRoute({
        summary: "List team tasks",
        operationId: "team.task.list",
        responses: {
          200: {
            description: "Team tasks",
            content: {
              "application/json": {
                schema: resolver(TeamTask.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const id = TeamID.make(c.req.param("id"))
        return c.json(TeamTask.list(id))
      },
    )
    .post(
      "/:id/tasks",
      describeRoute({
        summary: "Create team task",
        operationId: "team.task.create",
        responses: {
          200: {
            description: "Created task",
            content: {
              "application/json": {
                schema: resolver(TeamTask.Info),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          subject: z.string(),
          description: z.string().optional(),
          owner: z.string().optional(),
        }),
      ),
      async (c) => {
        const id = TeamID.make(c.req.param("id"))
        const body = c.req.valid("json")
        const task = TeamTask.create({
          teamID: id,
          ...body,
        })
        return c.json(task)
      },
    ),
)
