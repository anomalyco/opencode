import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { TeamTask } from "@/team/task"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const TeamTaskInfo = z.object({
  id: z.string(),
  team_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(["pending", "in_progress", "completed"]),
  assigned_to: z.string().nullable(),
  depends_on: z.array(z.string()).nullable(),
  time_created: z.number(),
  time_updated: z.number(),
})

export const TeamRoutes = lazy(() =>
  new Hono().get(
    "/:teamID/tasks",
    describeRoute({
      summary: "List team tasks",
      description: "Get a list of all tasks for a specific team.",
      operationId: "team.tasks",
      responses: {
        200: {
          description: "List of team tasks",
          content: {
            "application/json": {
              schema: resolver(TeamTaskInfo.array()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "param",
      z.object({
        teamID: z.string(),
      }),
    ),
    async (c) => {
      const { teamID } = c.req.valid("param")
      const tasks = TeamTask.list(teamID)
      return c.json(tasks)
    },
  ),
)
