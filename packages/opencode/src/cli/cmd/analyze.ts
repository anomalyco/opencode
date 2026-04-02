import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { analyze } from "@/security/analyze"
import { UI } from "../ui"
import { DEFAULT_CONTROLS_PATH, DEFAULT_OUT_DIR } from "@/security/schema"

export const AnalyzeCommand = cmd({
  command: "analyze",
  describe: "generate a structured security audit report",
  builder: (yargs: Argv) => {
    return yargs
      .option("file", {
        type: "string",
        alias: ["f"],
        demandOption: true,
        describe: "path to file for audit analysis",
      })
      .option("mode", {
        type: "string",
        choices: ["direct", "baseline", "rag"],
        default: "baseline",
        describe: "analysis mode",
      })
      .option("controls", {
        type: "string",
        default: DEFAULT_CONTROLS_PATH,
        describe: "controls corpus JSON path (used by rag)",
      })
      .option("topk", {
        type: "number",
        default: 3,
        describe: "number of controls to retrieve in rag mode",
      })
      .option("out", {
        type: "string",
        default: DEFAULT_OUT_DIR,
        describe: "output directory for run artifacts",
      })
      .option("prompt", {
        type: "string",
        describe: "optional extra prompt guidance",
      })
      .option("model", {
        type: "string",
        describe: "model override in provider/model format",
      })
      .option("agent", {
        type: "string",
        describe: "agent override for baseline or rag",
      })
      .option("session", {
        type: "string",
        describe: "existing session id for baseline or rag",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await analyze({
        file: String(args.file),
        mode: args.mode as "direct" | "baseline" | "rag",
        controls: args.controls ? String(args.controls) : undefined,
        topk: Number(args.topk),
        out: args.out ? String(args.out) : undefined,
        prompt: args.prompt ? String(args.prompt) : undefined,
        model: args.model ? String(args.model) : undefined,
        agent: args.agent ? String(args.agent) : undefined,
        sessionID: args.session ? String(args.session) : undefined,
      })

      UI.println(`mode: ${result.mode}`)
      UI.println(`run dir: ${result.run_dir}`)
      UI.empty()
      process.stdout.write(result.report.trim() + "\n")
      UI.empty()
      UI.println(`verification score: ${result.verification.score.toFixed(2)} (${result.verification.passed ? "pass" : "fail"})`)
    })
  },
})
