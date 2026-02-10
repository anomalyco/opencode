import { Plugin } from "../plugin"
import { Share } from "../share/share"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { Flag } from "@/flag/flag"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  Share.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })

  // Team features — order matters:
  // 1. onCleanedRestorePermissions() registers synchronously so it's ready
  //    before recover(), which could trigger cleanup if all members are shutdown.
  // 2. recover() marks stale busy executions as cancelled, transitions members to ready, and notifies leads.
  // 3. autoCleanup() subscribes AFTER recover finishes (.finally()) to avoid
  //    spurious MemberStatusChanged events during recovery triggering premature cleanup.
  // Fire-and-forget: don't block bootstrap completion.
  if (Flag.OPENCODE_EXPERIMENTAL_AGENT_TEAMS) {
    // Dynamic import — only load team module when the feature flag is enabled
    import("../team").then(({ Team }) => {
      Team.onCleanedRestorePermissions()
      Team.recover()
        .catch((err) => {
          Log.Default.warn("team recovery failed", { error: err instanceof Error ? err.message : err })
        })
        .finally(() => {
          Team.autoCleanup()
        })
    })
  }
}
