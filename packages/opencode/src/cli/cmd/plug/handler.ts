import { intro, outro } from "@clack/prompts"
import { Instance } from "../../../project/instance"
import { UI } from "../../ui"
import { createPlugTask } from "./task"
import type { PluginArgs } from "./command"

export async function handler(args: PluginArgs) {
  const mod = String(args.module ?? "").trim()
  if (!mod) {
    UI.error("module is required")
    process.exitCode = 1
    return
  }

  UI.empty()
  intro(`Install plugin ${mod}`)

  const run = createPlugTask({
    mod,
    global: Boolean(args.global),
    force: Boolean(args.force),
  })
  let ok = true

  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      ok = await run({
        vcs: Instance.project.vcs,
        worktree: Instance.worktree,
        directory: Instance.directory,
      })
    },
  })

  outro("Done")
  if (!ok) process.exitCode = 1
}
