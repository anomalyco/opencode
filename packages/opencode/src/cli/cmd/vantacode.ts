import { EOL } from "os"
import { cmd } from "./cmd"
import { runDoctor, type CheckResult } from "@/vantacode/doctor"
import { detectHardware, computeTunedSettings } from "@/vantacode/hardware"
import { mergeConfig, PROVIDER_PRESETS, type VantaConfig, type PermissionMode } from "@/vantacode/config"
import { maskSecret } from "@/vantacode/failover"
import { OllamaClient } from "@/vantacode/ollama"
import { runNativeChat } from "@/vantacode/cli-chat"

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
}

function statusIcon(status: CheckResult["status"]): string {
  if (status === "pass") return `${C.green}✔${C.reset}`
  if (status === "warn") return `${C.yellow}⚠${C.reset}`
  if (status === "fail") return `${C.red}✗${C.reset}`
  return `${C.dim}∙${C.reset}`
}

function loadConfig(): VantaConfig {
  return mergeConfig({ env: process.env })
}

function printDoctorReport(checks: CheckResult[]) {
  for (const check of checks) {
    process.stdout.write(`${statusIcon(check.status)} ${C.bold}${check.title}${C.reset}: ${check.detail}${EOL}`)
    if (check.fix) process.stdout.write(`   ${C.dim}→ ${check.fix}${C.reset}${EOL}`)
  }
}

export const VantacodeCommand = cmd({
  command: "vantacode <command>",
  describe: "VantaCode: local-model provider tools, doctor, and native chat",
  builder: (yargs) =>
    yargs
      .command(
        "doctor",
        "check Ollama + hardware readiness for reliable tool-calling",
        (y) =>
          y
            .option("host", { describe: "Ollama host URL", type: "string" })
            .option("model", { describe: "model to test", type: "string" })
            .option("skip-live", { describe: "skip the live tool-call test", type: "boolean" })
            .option("debug", { describe: "print raw Ollama tool-call responses", type: "boolean" }),
        async (args) => {
          process.stdout.write(`${C.bold}VantaCode doctor${C.reset}${EOL}${EOL}`)
          const report = await runDoctor({
            host: args.host as string | undefined,
            model: args.model as string | undefined,
            skipLiveTest: args.skipLive as boolean | undefined,
            debug: args.debug as boolean | undefined,
          })
          printDoctorReport(report.checks)
          process.stdout.write(EOL)
          if (report.tuned) {
            process.stdout.write(`${C.bold}Recommended Ollama tuning:${C.reset}${EOL}`)
            for (const note of report.tuned.notes) process.stdout.write(`   ${C.dim}• ${note}${C.reset}${EOL}`)
          }
          process.stdout.write(EOL)
          process.stdout.write(
            report.ok
              ? `${C.green}All critical checks passed.${C.reset}${EOL}`
              : `${C.red}Some checks failed — see fixes above.${C.reset}${EOL}`,
          )
          process.exit(report.ok ? 0 : 1)
        },
      )
      .command(
        "optimize",
        "detect GPU/VRAM and print recommended Ollama settings (before/after)",
        (y) =>
          y
            .option("context", { describe: "desired context window", type: "number" })
            .option("model-size-mb", { describe: "model size in MB for offload estimate", type: "number" }),
        async (args) => {
          process.stdout.write(`${C.bold}VantaCode optimize${C.reset}${EOL}${EOL}`)
          const hardware = await detectHardware()
          process.stdout.write(`${C.bold}Detected hardware:${C.reset}${EOL}`)
          process.stdout.write(`   CPU threads: ${hardware.cpuThreads}${EOL}`)
          process.stdout.write(`   RAM: ${Math.round(hardware.totalRamMB / 1024)} GB${EOL}`)
          if (hardware.gpus.length === 0) {
            process.stdout.write(`   GPU: ${C.yellow}none detected (CPU-only)${C.reset}${EOL}`)
          } else {
            for (const gpu of hardware.gpus) {
              process.stdout.write(
                `   GPU: ${gpu.vendor} ${gpu.name} — ${Math.round(gpu.vramTotalMB / 1024)} GB VRAM${gpu.gfx ? ` (${gpu.gfx})` : ""}${EOL}`,
              )
            }
          }
          process.stdout.write(EOL)

          const tuned = computeTunedSettings({
            hardware,
            desiredContext: args.context as number | undefined,
            modelSizeMB: args.modelSizeMb as number | undefined,
          })
          process.stdout.write(`${C.bold}Before (Ollama defaults):${C.reset}${EOL}`)
          process.stdout.write(`   ${C.dim}num_gpu=auto, num_thread=auto, num_ctx=2048, no flash attention${C.reset}${EOL}${EOL}`)
          process.stdout.write(`${C.bold}After (VantaCode tuned):${C.reset}${EOL}`)
          process.stdout.write(
            `   num_gpu=${tuned.options.num_gpu}, num_thread=${tuned.options.num_thread}, num_ctx=${tuned.options.num_ctx}${EOL}`,
          )
          for (const [k, v] of Object.entries(tuned.env)) process.stdout.write(`   ${k}=${v}${EOL}`)
          process.stdout.write(EOL)
          process.stdout.write(`${C.bold}Why:${C.reset}${EOL}`)
          for (const note of tuned.notes) process.stdout.write(`   ${C.dim}• ${note}${C.reset}${EOL}`)
          process.stdout.write(EOL)
          process.stdout.write(`${C.bold}Apply by exporting these before starting Ollama:${C.reset}${EOL}`)
          for (const [k, v] of Object.entries(tuned.env)) process.stdout.write(`   export ${k}=${v}${EOL}`)
          process.exit(0)
        },
      )
      .command(
        "providers",
        "list configured providers and which keys are resolved (masked)",
        (y) => y,
        async () => {
          const config = loadConfig()
          process.stdout.write(`${C.bold}VantaCode providers${C.reset} (default: ${config.defaultProvider})${EOL}${EOL}`)
          for (const provider of config.providers) {
            const keyInfo = provider.requiresKey
              ? provider.apiKeys && provider.apiKeys.length > 0
                ? `${C.green}${provider.apiKeys.length} key(s)${C.reset} [${provider.apiKeys.map((k) => maskSecret(k)).join(", ")}]`
                : `${C.yellow}no key (set ${provider.apiKeyEnv})${C.reset}`
              : `${C.dim}no key required${C.reset}`
            process.stdout.write(`${C.bold}${provider.id}${C.reset} (${provider.kind})${EOL}`)
            process.stdout.write(`   base URL: ${provider.baseURL}${EOL}`)
            if (provider.defaultModel) process.stdout.write(`   default model: ${provider.defaultModel}${EOL}`)
            process.stdout.write(`   keys: ${keyInfo}${EOL}${EOL}`)
          }
          process.exit(0)
        },
      )
      .command(
        "models",
        "list installed Ollama models and their tool capability",
        (y) => y.option("host", { describe: "Ollama host URL", type: "string" }),
        async (args) => {
          const client = new OllamaClient({ host: args.host as string | undefined })
          if (!(await client.ping())) {
            process.stderr.write(`${C.red}No Ollama server reachable at ${client.host}${C.reset}${EOL}`)
            process.exit(1)
          }
          const models = await client.listModels()
          if (models.length === 0) {
            process.stdout.write(`No models installed. Try: ${C.cyan}ollama pull qwen2.5-coder:7b${C.reset}${EOL}`)
            process.exit(0)
          }
          for (const model of models) {
            const tools = model.capabilities.tools ? `${C.green}tools${C.reset}` : `${C.dim}no-tools${C.reset}`
            const size = model.parameterSize ? ` ${model.parameterSize}` : ""
            process.stdout.write(`${model.name}${size} [${tools}]${EOL}`)
          }
          process.exit(0)
        },
      )
      .command(
        "chat [message]",
        "start a native Ollama chat session with tool-calling + guards",
        (y) =>
          y
            .positional("message", { describe: "initial message (omit for interactive)", type: "string" })
            .option("provider", { describe: "provider id (default: ollama)", type: "string" })
            .option("model", { describe: "model to use", type: "string" })
            .option("host", { describe: "Ollama host URL", type: "string" })
            .option("permission", {
              describe: "permission mode",
              type: "string",
              choices: ["plan", "auto-edit", "yolo"],
            })
            .option("no-stream", { describe: "disable streaming output", type: "boolean" })
            .option("debug", { describe: "print raw Ollama tool-call responses", type: "boolean" }),
        async (args) => {
          const config = loadConfig()
          await runNativeChat({
            config,
            initialMessage: args.message as string | undefined,
            provider: args.provider as string | undefined,
            model: args.model as string | undefined,
            host: args.host as string | undefined,
            permission: args.permission as PermissionMode | undefined,
            stream: args.stream !== false,
            debug: (args.debug as boolean | undefined) ?? config.debug,
          })
        },
      )
      .demandCommand(1, "Specify a vantacode subcommand: doctor | optimize | providers | models | chat")
      .strict(),
  handler: () => {},
})
