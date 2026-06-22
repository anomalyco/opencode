import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"

const ROSTER = [
  "apex-revenant",
  "apex-catalyst",
  "apex-forge",
  "apex-warden",
  "apex-mastermind",
  "apex-cipher",
  "apex-vector",
  "apex-archive",
  "apex-prism",
  "apex-ledger",
  "apex-neon",
  "apex-render",
  "apex-arbiter",
  "apex-specter",
]

function readYagniMode(directory: string): string {
  try {
    const file = path.join(directory, ".apex", "state", "yagni.json")
    const data = JSON.parse(fs.readFileSync(file, "utf-8"))
    if (data.mode === "lite" || data.mode === "ultra") return data.mode
    return "full"
  } catch {
    return "full"
  }
}

export const ApexPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const yagniMode = readYagniMode(input.directory)
  const apexState = [
    `<apex_state>`,
    `yagni_mode: ${yagniMode}`,
    `active_agent: unknown`,
    `legend_roster: ${ROSTER.join(", ")}`,
    `project_layer: APEX`,
    `</apex_state>`,
  ].join("\n")

  return {
    "chat.message": async (_input, output) => {
      const text = (output.message as any).content ?? ""
      const lowered = text.toLowerCase()
      if (
        lowered.includes("ultrawork") ||
        lowered.includes("ulw") ||
        lowered.includes("hyperplan") ||
        lowered.includes("ralph-loop") ||
        lowered.includes("swarm")
      ) {
        ;(output.parts as any[]).push({
          type: "text",
          text: `[APEX intent gate triggered: ${lowered.match(/ultrawork|ulw|hyperplan|ralph-loop|swarm/)?.[0]}]`,
        })
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(apexState)
    },
  }
}
