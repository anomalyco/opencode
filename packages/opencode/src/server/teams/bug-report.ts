import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { BugReportTranslate } from "../../team/bug-report-translate"
import { TeamBugReport } from "../../team/bug-report"
import { Bus } from "../../bus"
import z from "zod"

export const BugReportRoutes = () =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List agent reports",
        description:
          "List all saved bug reports and suggestions from the global opencode environment and migrate legacy local logs when found.",
        operationId: "bugReport.list",
        responses: {
          200: {
            description: "Bug reports",
            content: {
              "application/json": {
                schema: resolver(TeamBugReport.Entry.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await TeamBugReport.list(Instance.worktree))
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete a bug report",
        description: "Remove a single bug report or suggestion by its id.",
        operationId: "bugReport.remove",
        responses: {
          200: {
            description: "Deleted entry ids",
            content: {
              "application/json": {
                schema: resolver(z.object({ ids: z.array(z.string()) })),
              },
            },
          },
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        const removed = await TeamBugReport.remove({ root: Instance.worktree, ids: [id] })
        if (removed.length) {
          await Bus.publish(TeamBugReport.Event.Removed, {
            report_ids: removed.map((e) => e.id),
            file: TeamBugReport.file,
          })
        }
        return c.json({ ids: removed.map((e) => e.id) })
      },
    )
    .post(
      "/translate",
      describeRoute({
        summary: "Translate bug report UI fields",
        description: "Translate user-facing bug report fields for the current project using the configured locale.",
        operationId: "bugReport.translate",
        responses: {
          200: {
            description: "Bug report translation result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    count: z.number().int().min(0),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          count: await BugReportTranslate.translate({ all: true, wait: true }),
        })
      },
    )
