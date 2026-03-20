import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { PlanStore } from "../../parallel/plan"
import { PlanID as PlanIDSchema } from "../../parallel/schema"

export const ParallelPublishCommand = cmd({
  command: "publish <planID>",
  describe: "Publish changes from a completed parallel plan",
  builder: (yargs: Argv) => {
    return yargs
      .positional("planID", {
        describe: "plan ID",
        type: "string",
        demandOption: true,
      })
      .option("mode", {
        describe: "Override publish mode",
        type: "string",
        choices: ["new-branch", "unstaged", "direct"],
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const { Orchestrator } = await import("../../parallel/orchestrator")

      try {
        const planID = PlanIDSchema.make(args.planID as string)
        const plan = await PlanStore.get(planID)

        // Only allow publishing from certain states
        const allowedStatuses = ["done", "partial_success", "merging"]
        if (!allowedStatuses.includes(plan.status)) {
          UI.error(`Cannot publish plan with status '${plan.status}'. Must be: ${allowedStatuses.join(", ")}`)
          process.exit(1)
        }

        const mode =
          (args.mode as "new-branch" | "unstaged" | "direct" | undefined) ?? (plan as any).publishMode ?? "new-branch"

        UI.println(`Publishing plan ${planID} with mode: ${mode}`)

        // Trigger publish through orchestrator
        await Orchestrator.publish(planID, { mode })

        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Plan ${planID} published successfully` + UI.Style.TEXT_NORMAL)

        // Show integration branch if available
        const updated = await PlanStore.get(planID)
        const branch = (updated as any).integrationBranch
        if (branch && mode === "new-branch") {
          UI.println(`Integration branch: ${branch}`)
        }
      } catch (err) {
        UI.error(err instanceof Error ? err.message : "Failed to publish plan")
        process.exit(1)
      }
    })
  },
})
