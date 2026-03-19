import { Plugin } from "../plugin"
import { LSP } from "../lsp"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  await LSP.init()
  File.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })
}

/**
 * Lightweight bootstrap for parallel workers.
 * Skips LSP and plugin initialization which can hang in worktree contexts.
 */
export async function ParallelBootstrap() {
  Log.Default.info("bootstrapping parallel worker", { directory: Instance.directory })
  // Skip Plugin.init() and LSP.init() - workers don't need them
  File.init()
  // No event subscriptions needed for workers
}
