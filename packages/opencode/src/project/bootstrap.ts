import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { SessionCheckpoint } from "../session/checkpoint"
import { initMemory } from "../memory"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  initMemory()
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  File.init()
  FileWatcher.init()
  Vcs.init()
  Snapshot.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })

  Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
    const info = evt.properties.info
    if (info.role !== "user") return
    const sessionID = evt.properties.sessionID
    const sessionInfo = await Session.get(sessionID).catch(() => null)
    if (!sessionInfo) return
    await SessionCheckpoint.write({
      sessionId: sessionID,
      sessionTitle: sessionInfo.title ?? null,
      directory: sessionInfo.directory,
      lastMessage: null,
      timestamp: Date.now(),
    })
  })
}
