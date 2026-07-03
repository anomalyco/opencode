/**
 * memory-loader: deterministically injects durable project state into the
 * system prompt every turn, so the agent never "starts from zero" and does not
 * depend on the model choosing to call the memory/history tools.
 *
 * It loads `.opencode/state.md` (the durable scratchpad the agent is told to
 * keep) and `.opencode/memory.md` if present, and appends them as context.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

const MARK = "Project memory (auto-loaded):"

function readIf(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, "utf8").trim() : ""
  } catch {
    return ""
  }
}

export default (async ({ directory }) => {
  return {
    "experimental.chat.system.transform": async (_input: { sessionID?: string; model: any }, output: { system: string[] }) => {
      if (output.system.some((s) => s.includes(MARK))) return
      const parts: string[] = []
      const state = readIf(join(directory, ".opencode", "state.md"))
      if (state) parts.push("## Durable session state (.opencode/state.md)\n" + state)
      const mem = readIf(join(directory, ".opencode", "memory.md"))
      if (mem) parts.push("## Project memory (.opencode/memory.md)\n" + mem)
      if (parts.length === 0) return
      output.system.push(
        MARK +
          "\nThe following is durable context from previous work on this project. Use it; do not repeat past mistakes recorded here.\n\n" +
          parts.join("\n\n"),
      )
    },
  }
}) satisfies Plugin