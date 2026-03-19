import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { PlanStore } from "../../parallel/plan"

export const ParallelCommand = cmd({
  command: "parallel",
  describe: "manage parallel execution plans",
  builder: (yargs: Argv) =>
    yargs.command(ParallelListCommand).command(ParallelShowCommand).command(ParallelCancelCommand).demandCommand(),
  async handler() {},
})

export const ParallelListCommand = cmd({
  command: "list",
  describe: "list parallel plans",
  builder: (yargs: Argv) => {
    return yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const plans = await PlanStore.list()
      if (args.format === "json") {
        console.log(JSON.stringify(plans, null, 2))
      } else {
        if (plans.length === 0) {
          UI.println("No parallel plans found.")
          return
        }
        const maxIdWidth = Math.max(20, ...plans.map((p) => p.id.length))
        const header = `Plan ID${" ".repeat(maxIdWidth - 7)}  Status    Task`
        UI.println(header)
        UI.println("─".repeat(header.length))
        for (const plan of plans) {
          const truncatedTask = plan.task.length > 40 ? plan.task.slice(0, 37) + "..." : plan.task
          const line = `${plan.id.padEnd(maxIdWidth)}  ${plan.status.padEnd(10)}  ${truncatedTask}`
          UI.println(line)
        }
      }
    })
  },
})

export const ParallelShowCommand = cmd({
  command: "show <planID>",
  describe: "show details of a parallel plan",
  builder: (yargs: Argv) => {
    return yargs.positional("planID", {
      describe: "plan ID",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      try {
        const plan = await PlanStore.get(args.planID as any)
        console.log(JSON.stringify(plan, null, 2))
      } catch {
        UI.error(`Plan not found: ${args.planID}`)
        process.exit(1)
      }
    })
  },
})

export const ParallelCancelCommand = cmd({
  command: "cancel <planID>",
  describe: "cancel a parallel plan",
  builder: (yargs: Argv) => {
    return yargs.positional("planID", {
      describe: "plan ID",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const { Orchestrator } = await import("../../parallel/orchestrator")
      try {
        await Orchestrator.cancel(args.planID as any)
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Plan ${args.planID} cancelled` + UI.Style.TEXT_NORMAL)
      } catch (err) {
        UI.error(err instanceof Error ? err.message : "Failed to cancel plan")
        process.exit(1)
      }
    })
  },
})
