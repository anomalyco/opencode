import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { PlanStore } from "../../parallel/plan"
import { Instance } from "../../project/instance"
import { ParallelDoctorCommand } from "./parallel-doctor"
import { ParallelExportCommand } from "./parallel-export"

export const ParallelCommand = cmd({
  command: "parallel [task]",
  describe: "Run parallel agents on a task, or manage parallel plans",
  builder: (yargs: Argv) =>
    yargs
      .positional("task", {
        describe: "Task description to decompose and execute in parallel",
        type: "string",
      })
      .option("orchestrator-model", {
        alias: "o",
        describe: "Model for the orchestrator (decomposition + merge)",
        type: "string",
      })
      .option("worker-model", {
        alias: "w",
        describe: "Default model for worker agents",
        type: "string",
      })
      .option("workers", {
        alias: "n",
        describe: "Max number of parallel workers (default: unlimited)",
        type: "number",
      })
      .option("auto-approve", {
        alias: "y",
        describe: "Skip plan approval and execute immediately",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "Output as JSON",
        type: "boolean",
        default: false,
      })
      .command(ParallelListCommand)
      .command(ParallelShowCommand)
      .command(ParallelCancelCommand)
      .command(ParallelDoctorCommand)
      .command(ParallelExportCommand),
  handler: async (args) => {
    if (!args.task) {
      // No task provided — show help
      return
    }

    await bootstrap(process.cwd(), async () => {
      const { Orchestrator } = await import("../../parallel/orchestrator")
      const { Config } = await import("../../config/config")
      const { Provider } = await import("../../provider/provider")
      const { Session } = await import("../../session")

      // Parse model overrides from CLI flags
      const orchestratorModel = args["orchestrator-model"]
        ? Provider.parseModel(args["orchestrator-model"] as string)
        : undefined

      const workerModel = args["worker-model"] ? Provider.parseModel(args["worker-model"] as string) : undefined

      // Apply --workers to config if specified
      if (args.workers) {
        await Config.update({
          parallel: {
            ...(await Config.get()).parallel,
            max_workers: args.workers,
          },
        })
      }

      // Create a session for the orchestrator
      const session = await Session.createNext({
        directory: process.cwd(),
        title: `[parallel] ${(args.task as string).slice(0, 50)}`,
      })

      UI.println(`Creating parallel plan for: ${args.task}`)

      const plan = await Orchestrator.create({
        projectID: Instance.project.id,
        sessionID: session.id,
        task: args.task as string,
        orchestratorModel: orchestratorModel
          ? { providerID: orchestratorModel.providerID, modelID: orchestratorModel.modelID }
          : undefined,
        workerModel: workerModel ? { providerID: workerModel.providerID, modelID: workerModel.modelID } : undefined,
      })

      if (args.json) {
        console.log(JSON.stringify(plan, null, 2))
      } else {
        UI.println("")
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Plan created: ${plan.id}` + UI.Style.TEXT_NORMAL)
        UI.println(`Status: ${plan.status}`)
        UI.println(`Orchestrator: ${plan.orchestratorModel.providerID}/${plan.orchestratorModel.modelID}`)
        UI.println(`Worker default: ${plan.workerModel.providerID}/${plan.workerModel.modelID}`)
        if (args.workers) UI.println(`Max workers: ${args.workers}`)
        UI.println("")
        UI.println(`Subtasks (${plan.subtasks.length}):`)
        for (const [i, st] of plan.subtasks.entries()) {
          const model = st.model ? `[${st.model.modelID}]` : ""
          UI.println(`  ${i + 1}. ${st.title} ${model}`)
          UI.println(`     Files: ${st.fileScope.join(", ")}`)
        }
      }

      if (args["auto-approve"]) {
        UI.println("")
        UI.println("Auto-approving plan...")
        await Orchestrator.approve(plan.id)
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Plan approved and execution started." + UI.Style.TEXT_NORMAL)
        UI.println(`Track progress: opencode parallel show ${plan.id}`)
      } else if (!args.json) {
        UI.println("")
        UI.println("To approve: opencode parallel approve " + plan.id)
        UI.println("To cancel:  opencode parallel cancel " + plan.id)
        UI.println("Or approve from the TUI.")
      }
    })
  },
})

export const ParallelListCommand = cmd({
  command: "list",
  describe: "List parallel plans",
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
        UI.println("-".repeat(header.length))
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
  describe: "Show details of a parallel plan",
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
  describe: "Cancel a parallel plan",
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
