import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TeamMainPlan } from "@/team/main-plan"
import { MainPlanTranslate } from "@/team/main-plan-translate"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "../error"

const TranslateRequest = z.object({
  force: z.boolean().optional(),
})

async function root(sessionID: z.infer<typeof SessionID.zod>) {
  let id = sessionID
  const seen = new Set<string>()
  for (;;) {
    if (seen.has(id)) return id
    seen.add(id)
    const session = await Session.get(id)
    if (!session.parentID) return id
    id = session.parentID
  }
}

export const MainPlanRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID",
      describeRoute({
        summary: "List main plans",
        description: "List stored main plans for the current caller session scope.",
        operationId: "mainPlan.list",
        responses: {
          200: {
            description: "Main plans",
            content: {
              "application/json": {
                schema: resolver(TeamMainPlan.Plan.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z.object({
          archived: z.coerce.boolean().optional(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const query = c.req.valid("query")
        const sessionID = await root(params.sessionID)
        const plans = await TeamMainPlan.list({
          session_id: sessionID,
          archived: query.archived,
        })
        return c.json(plans)
      },
    )
    .post(
      "/:planID/archive",
      describeRoute({
        summary: "Archive main plan",
        description: "Archive a stored main plan and remove it from the active list.",
        operationId: "mainPlan.archive",
        responses: {
          200: {
            description: "Archived main plan",
            content: {
              "application/json": {
                schema: resolver(TeamMainPlan.Plan),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          planID: TeamMainPlan.PlanID,
        }),
      ),
      async (c) => {
        const planID = c.req.valid("param").planID
        const item = await TeamMainPlan.archive({ plan_id: planID })
        await Bus.publish(TeamMainPlan.Event.Updated, {
          change: "archived",
          ...item,
        })
        return c.json(item.plan)
      },
    )
    .delete(
      "/:planID",
      describeRoute({
        summary: "Delete main plan",
        description: "Delete a stored main plan permanently.",
        operationId: "mainPlan.delete",
        responses: {
          200: {
            description: "Deleted main plan",
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
          planID: TeamMainPlan.PlanID,
        }),
      ),
      async (c) => {
        const planID = c.req.valid("param").planID
        const item = await TeamMainPlan.remove(planID)
        await Bus.publish(TeamMainPlan.Event.Deleted, item)
        return c.json(true)
      },
    )
    .post(
      "/translate",
      describeRoute({
        summary: "Translate main plan UI fields",
        description: "Translate user-facing main plan fields for the current project using the configured locale.",
        operationId: "mainPlan.translate",
        responses: {
          200: {
            description: "Main plan translation result",
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
        const body = TranslateRequest.parse(await c.req.json().catch(() => ({})))
        return c.json({
          count: await MainPlanTranslate.translate({ all: true, ...(body.force ? { force: true } : {}) }),
        })
      },
    )
    .post(
      "/translate/stop",
      describeRoute({
        summary: "Stop main plan translations",
        description: "Stop active main plan translations and ignore any in-flight results.",
        operationId: "mainPlan.stopTranslation",
        responses: {
          200: {
            description: "Main plan stop result",
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
        return c.json({ count: await MainPlanTranslate.stop() })
      },
    ),
)
