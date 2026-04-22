import { Hono } from "hono"
import { BugReportRoutes } from "./bug-report"
import { MainPlanRoutes } from "./main-plan"

export function mountInstanceTeamRoutes(app: Hono) {
  return app.route("/main-plan", MainPlanRoutes()).route("/bug-report", BugReportRoutes())
}
