import type { ProgressSummary, Task } from "./schema"

export function summarizeProgress(tasks: Task[]): ProgressSummary {
  const included = tasks.filter((task) => task.state !== "skipped")
  const verified = included.filter((task) => task.state === "verified").length
  return {
    verified,
    total: included.length,
    skipped: tasks.length - included.length,
    failed: included.filter((task) => task.state === "failed").length,
    blocked: included.filter((task) => task.state === "blocked").length,
    awaitingReview: included.filter((task) => task.state === "awaiting_review").length,
    percent: included.length ? Math.floor((verified * 100) / included.length) : null,
    source: "controller_report",
  }
}
