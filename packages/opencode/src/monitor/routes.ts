/**
 * Hono routes for the monitor module.
 *
 * Mounted under `/monitor/*` inside the opencode instance router. Every
 * endpoint is local-only (the server is bound to 127.0.0.1 in the default
 * deployment; the router middleware enforces a per-directory workspace
 * scope).
 *
 *   GET  /monitor/health
 *   GET  /monitor/kanban?view=sessions|agents
 *   GET  /monitor/workflows?status=active|completed|all
 *   GET  /monitor/cost?range=24h|7d|30d
 *   GET  /monitor/sessions?status=&q=&limit=&offset=
 *   GET  /monitor/alerts/rules
 *   POST /monitor/alerts/rules
 *   GET  /monitor/alerts/events
 *   POST /monitor/alerts/events/:id/ack
 *   GET  /monitor/channels
 *   POST /monitor/channels
 *   POST /monitor/channels/:id/test
 */

import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { z } from "zod"
import { Instance } from "@/project/instance"
import { jsonRequest } from "@/server/routes/instance/trace"
import * as Kanban from "./kanban"
import * as Health from "./health"
import * as Workflows from "./workflows"
import * as Alerts from "./alerts"

export const MonitorRoutes = new Hono()
  .get(
    "/health",
    describeRoute({
      summary: "Composite health score",
      operationId: "monitor.health",
      responses: { 200: { description: "Health snapshot", content: { "application/json": { schema: resolver(Health.Health) } } } },
    }),
    (c) => jsonRequest("MonitorRoutes.health", c, function* () { return yield* Health.buildHealth() }),
  )
  .get(
    "/kanban",
    describeRoute({
      summary: "Kanban board (sessions or agents)",
      operationId: "monitor.kanban",
      responses: { 200: { description: "Kanban board", content: { "application/json": { schema: resolver(Kanban.KanbanBoard) } } } },
    }),
    validator("query", z.object({ view: z.enum(["sessions", "agents"]).default("sessions") })),
    (c) =>
      jsonRequest("MonitorRoutes.kanban", c, function* () {
        const { view } = c.req.valid("query")
        return yield* Kanban.buildKanban({ projectId: Instance.project.id, view })
      }),
  )
  .get(
    "/workflows",
    describeRoute({
      summary: "Workflows datasets",
      operationId: "monitor.workflows",
      responses: { 200: { description: "Workflows report", content: { "application/json": { schema: resolver(Workflows.WorkflowsReport) } } } },
    }),
    validator("query", z.object({ status: z.enum(["active", "completed", "all"]).default("all") })),
    (c) =>
      jsonRequest("MonitorRoutes.workflows", c, function* () {
        const { status } = c.req.valid("query")
        return yield* Workflows.buildWorkflows({ projectId: Instance.project.id, status })
      }),
  )
  .get("/cost", (c) => c.json({ total: 0, by_day: [], by_model: [], generated_at: Date.now() }))
  .get("/sessions", (c) => c.json({ total: 0, items: [] }))
  .get("/alerts/rules", (c) => c.json([] satisfies Alerts.AlertRule[]))
  .post(
    "/alerts/rules",
    validator("json", Alerts.AlertRule.omit({ id: true, time_created: true, time_updated: true })),
    (c) => c.json({ ok: true }),
  )
  .get("/alerts/events", (c) => c.json([] satisfies Alerts.AlertEvent[]))
  .post("/alerts/events/:id/ack", (c) => c.json({ ok: true }))
  .get("/channels", (c) => c.json([]))
  .post("/channels", (c) => c.json({ ok: true }))
  .post("/channels/:id/test", (c) => c.json({ ok: true }))