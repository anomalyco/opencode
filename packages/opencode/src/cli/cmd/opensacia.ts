// packages/opencode/src/cli/cmd/opensacia.ts
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { Agent } from "../../agent/agent"

type AutomationMode = "auto" | "assisted" | "mixed"

const MODE_DESCRIPTIONS = {
  auto: "Completamente autónomo - ejecuta todo sin preguntar",
  assisted: "Asistido - confirma cada acción antes de ejecutar",
  mixed: "Mixto - pregunta solo acciones potencialmente destructivas",
}

async function selectMode(cliMode: AutomationMode | undefined): Promise<AutomationMode> {
  if (cliMode) return cliMode

  UI.empty()
  prompts.intro("OPENSACIA Security Agent")

  const mode = await prompts.select({
    message: "¿Qué grado de automatización prefieres?",
    options: [
      {
        label: "Completamente autónomo",
        value: "auto" as const,
        hint: "Ejecuta todos los comandos sin confirmación",
      },
      {
        label: "Asistido",
        value: "assisted" as const,
        hint: "Confirma cada acción antes de ejecutar",
      },
      {
        label: "Mixto",
        value: "mixed" as const,
        hint: "Pregunta solo acciones potencialmente destructivas",
      },
    ],
    initialValue: "mixed" as const,
  })

  if (prompts.isCancel(mode)) {
    throw new UI.CancelledError()
  }

  prompts.outro(`Modo ${MODE_DESCRIPTIONS[mode].split(" - ")[0]} seleccionado`)

  return mode
}

export const OpensaciaCommand = cmd({
  command: "opensacia [prompt..]",
  describe: "OPENSACIA Security Agent - asistente de ciberseguridad autónomo",
  builder: (yargs: Argv) =>
    yargs
      .positional("prompt", {
        describe: "Prompt para el agente de seguridad",
        type: "string",
        array: true,
      })
      .option("agent", {
        type: "string",
        describe: "Agente a usar (security por defecto)",
        choices: ["security", "general"],
        default: "security",
      })
      .option("mode", {
        type: "string",
        describe: "Modo de automatización",
        choices: ["auto", "assisted", "mixed"] as const,
      })
      .option("target", {
        type: "string",
        alias: "t",
        describe: "Objetivo de la auditoría (IP, URL, rango)",
      })
      .option("report", {
        type: "string",
        alias: "r",
        describe: "Archivo para guardar el reporte",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const prompt = args.prompt ? args.prompt.join(" ") : undefined
      const agent = args.agent || "security"

      // Seleccionar modo si no se especificó
      const mode = await selectMode(args.mode as AutomationMode | undefined)

      // Construir prompt completo
      let fullPrompt = prompt || ""

      if (!fullPrompt) {
        // Si no hay prompt, preguntar
        prompts.intro("OPENSACIA")
        const query = await prompts.text({
          message: "¿Qué deseas auditar hoy?",
          placeholder: "Ej: Audita 192.168.1.0/24, Escanea example.com, etc.",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })

        if (prompts.isCancel(query)) throw new UI.CancelledError()

        fullPrompt = query
        prompts.outro()
      }

      // Agregar contexto de modo al prompt
      fullPrompt += `\n\n[OPENSACIA_MODE: ${mode.toUpperCase()}]`

      if (args.target) {
        fullPrompt += `\n[TARGET: ${args.target}]`
      }

      if (args.report) {
        fullPrompt += `\n[REPORT_OUTPUT: ${args.report}]`
      }

      // Ejecutar usando el comando run existente
      const { RunCommand } = await import("./run")
      await RunCommand.handler({
        message: [fullPrompt],
        agent,
        continue: undefined,
        session: undefined,
        fork: undefined,
        share: false,
        model: undefined,
        format: "default",
        file: undefined,
        title: `OPENSACIA Audit ${new Date().toISOString().split("T")[0]}`,
        attach: undefined,
        dir: undefined,
        port: undefined,
        variant: undefined,
        thinking: false,
        command: undefined,
        ["--"]: [],
        _: [],
        $0: "opensacia",
      })
    })
  },
})
