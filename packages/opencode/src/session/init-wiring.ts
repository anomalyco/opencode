import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import path from "path"
import { InstanceState } from "@/effect/instance-state"

const CONFIG_FILES = ["opencode.jsonc", "opencode.json", ".opencode/opencode.jsonc"]

/**
 * After the `/init` command generates AGENTS.md, ensure:
 * 1. A project-level config references it via `instructions: ["AGENTS.md"]`
 * 2. The `.opencode/agents/` scaffold directory exists
 *
 * This runs deterministically — no LLM calls, no user questions.
 */
export const wire = Effect.fn("InitWire.wire")(function* () {
  const ctx = yield* InstanceState.context
  const fs = yield* FSUtil.Service
  const { worktree } = ctx

  yield* ensureConfigReferencesAgentsMd(worktree, fs)
  yield* scaffoldAgentsDir(worktree, fs)
})

function* ensureConfigReferencesAgentsMd(worktree: string, fs: FSUtil.Service) {
  const filePath = yield* findOrCreateConfigFile(worktree, fs)

  const raw = (yield* fs.readFileStringSafe(filePath)).pipe(Effect.map((t) => t ?? "{}"))
  const text = yield* raw

  // Quick check: does the text already mention AGENTS.md?
  // A full JSON parse isn't needed for a substring check.
  if (/AGENTS\.md/i.test(text)) return

  // We need to add it. Use a simple structural edit:
  // If the file is empty or just "{}", write a clean template.
  const trimmed = text.trim()
  if (trimmed === "{}" || trimmed === "" || trimmed === "{\n}") {
    yield* fs.writeFileString(
      filePath,
      JSON.stringify({ instructions: ["AGENTS.md"] }, null, 2) + "\n",
    )
    return
  }

  // TODO: Use the project's jsonc patch utility for a surgical edit to preserve
  // comments and formatting. For now, use JSON.parse/stringify which works for
  // plain .json files and is safe for the common case.
  try {
    const parsed = JSON.parse(text)
    if (!parsed) return

    const instructions: string[] = parsed.instructions ?? []
    if (instructions.some((i: string) => i === "AGENTS.md")) return

    instructions.push("AGENTS.md")
    parsed.instructions = instructions

    yield* fs.writeFileString(filePath, JSON.stringify(parsed, null, 2) + "\n")
  } catch {
    // File isn't valid JSON — don't clobber it; just skip the config wiring.
    // The AGENTS.md file is already on disk and will be picked up by source
    // control anyway.
    return
  }
}

function* findOrCreateConfigFile(worktree: string, fs: FSUtil.Service) {
  for (const name of CONFIG_FILES) {
    const candidate = path.join(worktree, name)
    const exists = yield* fs.existsSafe(candidate)
    if (exists) return candidate
  }

  // No config file found — create opencode.json at the worktree root.
  const target = path.join(worktree, "opencode.json")
  yield* fs.writeFileString(target, JSON.stringify({ instructions: ["AGENTS.md"] }, null, 2) + "\n")
  return target
}

function* scaffoldAgentsDir(worktree: string, fs: FSUtil.Service) {
  const agentsDir = path.join(worktree, ".opencode", "agents")
  yield* fs.ensureDir(agentsDir)
}
