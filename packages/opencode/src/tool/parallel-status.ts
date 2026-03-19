import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { sumBy } from "remeda"

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cost)
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export const ParallelStatusTool = Tool.define("parallel_status", {
  description: "Check the status of a parallel execution plan and its workers.",
  parameters: z.object({
    plan_id: z.string().optional().describe("Plan ID to check. If omitted, shows the latest plan for this project."),
  }),
  async execute(params, ctx) {
    let plan
    const projectID = Instance.project.id

    if (params.plan_id) {
      plan = await PlanStore.get(params.plan_id as any)
    } else {
      const plans = await PlanStore.list()
      plan = plans.filter((p) => p.projectID === projectID).sort((a, b) => b.time.created - a.time.created)[0]
    }

    if (!plan) {
      return {
        title: "No plan found",
        output: "No parallel plans found for this project.",
        metadata: {} as Record<string, never>,
      }
    }

    // Verify plan belongs to current project when fetched by explicit ID
    if (params.plan_id && plan.projectID !== projectID) {
      return {
        title: "Plan not found",
        output: "Plan does not belong to this project.",
        metadata: {} as Record<string, never>,
      }
    }

    // Fetch cost/token data for each worker session
    const workerStats = await Promise.all(
      plan.workers.map(async (w) => {
        if (!w.sessionID) {
          return { worker: w, cost: 0, inputTokens: 0, outputTokens: 0 }
        }
        try {
          const msgs = await Session.messages({ sessionID: SessionID.make(w.sessionID) })
          let cost = 0
          let inputTokens = 0
          let outputTokens = 0
          for (const m of msgs) {
            if (m.info.role === "assistant") {
              cost += m.info.cost ?? 0
              inputTokens += m.info.tokens?.input ?? 0
              outputTokens += m.info.tokens?.output ?? 0
            }
          }
          return { worker: w, cost, inputTokens, outputTokens }
        } catch {
          return { worker: w, cost: 0, inputTokens: 0, outputTokens: 0 }
        }
      }),
    )

    const workerLines = workerStats.map(({ worker, cost, inputTokens, outputTokens }) => {
      const subtask = plan.subtasks.find((st) => st.id === worker.subtaskID)
      const title = subtask?.title ?? worker.subtaskID
      const stat = worker.diffStat
        ? ` (+${worker.diffStat.additions}/-${worker.diffStat.deletions}, ${worker.diffStat.files} files)`
        : ""
      const err = worker.error ? ` Error: ${worker.error}` : ""
      const costInfo = cost > 0 ? ` ${formatCost(cost)}` : ""
      const tokenInfo =
        inputTokens > 0 || outputTokens > 0
          ? ` [${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out]`
          : ""
      return `  - [${worker.status}] ${title}${stat}${costInfo}${tokenInfo}${err}`
    })

    const done = plan.workers.filter((w) => ["done", "merged"].includes(w.status)).length
    const failed = plan.workers.filter((w) => ["failed", "conflict"].includes(w.status)).length
    const running = plan.workers.filter((w) => w.status === "running").length

    // Aggregate totals
    const totalCost = sumBy(workerStats, (s) => s.cost)
    const totalInputTokens = sumBy(workerStats, (s) => s.inputTokens)
    const totalOutputTokens = sumBy(workerStats, (s) => s.outputTokens)

    const output = [
      `Plan: ${plan.id}`,
      `Status: ${plan.status}`,
      `Task: ${plan.task}`,
      `Progress: ${done} done, ${running} running, ${failed} failed (${plan.workers.length} total)`,
      `Cost: ${formatCost(totalCost)} (${formatTokens(totalInputTokens)} in / ${formatTokens(totalOutputTokens)} out)`,
      ``,
      `Workers:`,
      ...workerLines,
    ].join("\n")

    return {
      title: `Plan ${plan.status} — ${done}/${plan.workers.length} complete`,
      output,
      metadata: {} as Record<string, never>,
    }
  },
})
