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

export async function InstanceBootstrap() {
  const log = Log.create({ service: "instance.bootstrap" })
  const all = Date.now()
  const run = async (name: string, fn: () => Promise<unknown> | unknown) => {
    const at = Date.now()
    await fn()
    log.info("instance.bootstrap", {
      directory: Instance.directory,
      projectID: Instance.project.id,
      step: name,
      duration: Date.now() - at,
    })
  }

  log.info("instance.bootstrap", {
    directory: Instance.directory,
    projectID: Instance.project.id,
    step: "start",
  })
  const pluginAt = Date.now()
  void Plugin.init()
  log.info("instance.bootstrap", {
    directory: Instance.directory,
    projectID: Instance.project.id,
    step: "plugin_background",
    duration: Date.now() - pluginAt,
  })
  ShareNext.init()
  log.info("instance.bootstrap", {
    directory: Instance.directory,
    projectID: Instance.project.id,
    step: "share",
    duration: 0,
  })
  await run("format", () => Format.init())
  await run("lsp", () => LSP.init())
  await run("file", () => File.init())
  await run("watcher", () => FileWatcher.init())
  await run("vcs", () => Vcs.init())
  await run("snapshot", () => Snapshot.init())
  log.info("instance.bootstrap", {
    directory: Instance.directory,
    projectID: Instance.project.id,
    step: "total",
    duration: Date.now() - all,
  })

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })
}
