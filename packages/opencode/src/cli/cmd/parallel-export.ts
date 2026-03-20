import type { Argv } from "yargs"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { exportDiagnosticsBundle } from "../../parallel/diagnostics"
import { PlanID } from "../../parallel/schema"

export const ParallelExportCommand = cmd({
  command: "export <planID>",
  describe: "Export a diagnostics bundle for a parallel plan",
  builder: (yargs: Argv) =>
    yargs
      .positional("planID", {
        describe: "Plan ID to export diagnostics for",
        type: "string",
        demandOption: true,
      })
      .option("output", {
        alias: "o",
        describe: "Output file path (defaults to temp file)",
        type: "string",
      })
      .option("json", {
        describe: "Output bundle as JSON to stdout",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      try {
        const planID = PlanID.make(args.planID as string)
        const bundle = await exportDiagnosticsBundle(planID)
        const json = JSON.stringify(bundle, null, 2)
        if (args.json) {
          console.log(json)
          return
        }
        const outputPath =
          (args.output as string | undefined) || path.join(os.tmpdir(), `opencode-parallel-${planID}-diagnostics.json`)
        await fs.mkdir(path.dirname(outputPath), { recursive: true })
        await fs.writeFile(outputPath, json, "utf-8")
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Diagnostics bundle exported to:` + UI.Style.TEXT_NORMAL)
        UI.println(outputPath)
        UI.println(``)
        UI.println(`Bundle contents:`)
        UI.println(`  - Plan: ${bundle.plan.id} (${bundle.plan.status})`)
        UI.println(`  - Task: ${bundle.plan.task.slice(0, 60)}${bundle.plan.task.length > 60 ? "..." : ""}`)
        UI.println(`  - Workers: ${bundle.workers.list.length} total`)
        const workerStatuses = Object.entries(bundle.workers.summary)
          .filter(([_, count]) => count > 0)
          .map(([status, count]) => `${count} ${status}`)
          .join(", ")
        if (workerStatuses) {
          UI.println(`    (${workerStatuses})`)
        }
        UI.println(`  - Logs: ${bundle.logs.length} entries`)
        if (bundle.error) {
          UI.println(`  - Error: ${bundle.error.code} (${bundle.error.stage})`)
        }
      } catch (err) {
        UI.error(err instanceof Error ? err.message : "Failed to export diagnostics")
        process.exit(1)
      }
    })
  },
})
