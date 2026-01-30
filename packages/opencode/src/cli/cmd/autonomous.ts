import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Autonomous, AutonomousTypes } from "../../autonomous"
import { Provider } from "../../provider/provider"
import { Bus } from "../../bus"
import { EOL } from "os"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

export const AutonomousCommand = cmd({
  command: "autonomous <requirements>",
  describe: "Run autonomous coach-player mode with requirements",
  builder: (yargs: Argv) => {
    return yargs
      .positional("requirements", {
        describe: "Path to requirements file or inline requirements text",
        type: "string",
        demandOption: true,
      })
      .option("max-turns", {
        alias: ["t"],
        describe: "Maximum number of coach-player turns",
        type: "number",
        default: 5,
      })
      .option("player-model", {
        alias: ["p"],
        describe: "Model for player agent (format: provider/model)",
        type: "string",
      })
      .option("coach-model", {
        alias: ["c"],
        describe: "Model for coach agent (format: provider/model)",
        type: "string",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "Output format: default (formatted) or json (raw JSON events)",
      })
      .option("quiet", {
        alias: ["q"],
        type: "boolean",
        default: false,
        describe: "Only show final report",
      })
  },
  handler: async (args) => {
    const requirementsArg = args.requirements as string

    // Load requirements from file or use as inline text
    let requirements: string
    const file = Bun.file(path.resolve(process.cwd(), requirementsArg))
    if (await file.exists()) {
      requirements = await file.text()
      UI.println(UI.Style.TEXT_INFO_BOLD + "~", UI.Style.TEXT_NORMAL, `Loaded requirements from ${requirementsArg}`)
    } else {
      requirements = requirementsArg
    }

    if (!requirements.trim()) {
      UI.error("Requirements cannot be empty")
      process.exit(1)
    }

    const config: Partial<AutonomousTypes.Config> = {
      maxTurns: args["max-turns"] as number,
    }

    if (args["player-model"]) {
      config.playerModel = Provider.parseModel(args["player-model"] as string)
    }

    if (args["coach-model"]) {
      config.coachModel = Provider.parseModel(args["coach-model"] as string)
    }

    await bootstrap(process.cwd(), async () => {
      const quiet = args.quiet as boolean
      const format = args.format as string

      if (!quiet) {
        UI.println()
        UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "═══════════════════════════════════════════")
        UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "     AUTONOMOUS COACH-PLAYER MODE")
        UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "═══════════════════════════════════════════")
        UI.println()
        UI.println(UI.Style.TEXT_DIM + `Max Turns: ${config.maxTurns}`)
        if (config.playerModel) {
          UI.println(UI.Style.TEXT_DIM + `Player Model: ${config.playerModel.providerID}/${config.playerModel.modelID}`)
        }
        if (config.coachModel) {
          UI.println(UI.Style.TEXT_DIM + `Coach Model: ${config.coachModel.providerID}/${config.coachModel.modelID}`)
        }
        UI.println()
      }

      // Subscribe to events for real-time output
      if (!quiet && format === "default") {
        Bus.subscribeAll(async (event) => {
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (part.type === "tool" && part.state.status === "completed") {
              const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
              const title =
                part.state.title ||
                (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
              UI.println(color + "|", UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${tool.padEnd(7, " ")}`, "", title)
            }
          }
        })
      }

      const result = await Autonomous.run({ requirements, config })

      if (format === "json") {
        process.stdout.write(JSON.stringify(result) + EOL)
        process.exit(result.success ? 0 : 1)
      }

      UI.println()
      UI.println(Autonomous.formatReport(result))
      UI.println()

      if (result.success) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓", UI.Style.TEXT_NORMAL, "Implementation approved by coach!")
      } else {
        UI.println(
          UI.Style.TEXT_WARNING_BOLD + "!",
          UI.Style.TEXT_NORMAL,
          "Max turns reached without approval. Review the implementation manually.",
        )
      }

      process.exit(result.success ? 0 : 1)
    })
  },
})
