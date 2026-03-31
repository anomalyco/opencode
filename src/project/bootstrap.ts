import { Plugin } from "../plugin"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { ProjectID } from "./schema"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"

/**
 * Bootstrap — stripped for browser agent.
 * No LSP, no Format, no FileWatcher, no VCS init.
 * Saves 2-5GB of RAM from not spawning language servers.
 */
export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping (browser agent mode)", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  Snapshot.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(ProjectID.global)
    }
  })
}
