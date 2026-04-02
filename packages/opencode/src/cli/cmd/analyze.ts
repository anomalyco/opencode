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
      .option("path", {
        type: "string",
        alias: ["f", "file"],
        demandOption: true,
        describe: "path to file or directory for audit analysis",
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
      .option("vector", {
        type: "string",
        choices: ["pinecone", "qdrant"],
        describe: "vector backend override for rag mode",
      })
      .option("collection", {
        type: "string",
        describe: "vector collection/index namespace name",
      })
      .option("namespace", {
        type: "string",
        describe: "optional vector namespace",
      })
      .option("maxchars", {
        type: "number",
        describe: "max chars loaded from file/codebase",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await analyze({
        path: String(args.path),
        mode: args.mode as "direct" | "baseline" | "rag",
        controls: args.controls ? String(args.controls) : undefined,
        topk: Number(args.topk),
        out: args.out ? String(args.out) : undefined,
        prompt: args.prompt ? String(args.prompt) : undefined,
        model: args.model ? String(args.model) : undefined,
        agent: args.agent ? String(args.agent) : undefined,
        sessionID: args.session ? String(args.session) : undefined,
        vector: args.vector as "pinecone" | "qdrant" | undefined,
        collection: args.collection ? String(args.collection) : undefined,
        namespace: args.namespace ? String(args.namespace) : undefined,
        maxchars: typeof args.maxchars === "number" ? Number(args.maxchars) : undefined,
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
