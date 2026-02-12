import path from "path"
import { Bus } from "@/bus"
import { FileWatcher } from "@/file/watcher"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { Instance } from "./instance"

export namespace HotReload {
  const log = Log.create({ service: "project.hotreload" })

  const watched = new Set([
    "agent",
    "agents",
    "command",
    "commands",
    "mode",
    "modes",
    "plugin",
    "plugins",
    "skill",
    "skills",
    "tool",
    "tools",
  ])

  function normalize(file: string) {
    return file.split(path.sep).join("/")
  }

  function temp(file: string) {
    const base = file.split("/").at(-1) ?? file
    if (!base) return true
    if (base === ".DS_Store" || base === "Thumbs.db") return true
    if (base.startsWith(".#")) return true
    if (base.endsWith("~")) return true
    if (base.endsWith(".tmp")) return true
    if (base.endsWith(".swp")) return true
    if (base.endsWith(".swo")) return true
    if (base.endsWith(".swx")) return true
    if (base.endsWith(".bak")) return true
    if (base.endsWith(".orig")) return true
    if (base.endsWith(".rej")) return true
    if (base.endsWith(".crdownload")) return true
    return false
  }

  function rel(root: string, file: string) {
    const roots = new Set([normalize(root).replace(/\/+$/, "")])
    const files = new Set([normalize(file)])

    if (process.platform === "darwin") {
      for (const item of [...roots]) {
        if (item.startsWith("/private/")) roots.add(item.slice("/private".length))
        if (item.startsWith("/var/")) roots.add(`/private${item}`)
      }
      for (const item of [...files]) {
        if (item.startsWith("/private/")) files.add(item.slice("/private".length))
        if (item.startsWith("/var/")) files.add(`/private${item}`)
      }
    }

    for (const rootItem of roots) {
      for (const fileItem of files) {
        if (fileItem.includes("/.git/")) continue
        if (fileItem === rootItem) continue
        if (!fileItem.startsWith(`${rootItem}/`)) continue
        return fileItem.slice(rootItem.length + 1)
      }
    }
  }

  export function classify(root: string, file: string) {
    const relFile = rel(root, file)
    if (!relFile) return
    if (temp(relFile)) return
    if (relFile === "opencode.json") return relFile
    if (relFile === "opencode.jsonc") return relFile
    if (relFile === "AGENTS.md") return relFile
    if (relFile === ".opencode/opencode.json") return relFile
    if (relFile === ".opencode/opencode.jsonc") return relFile
    if (!relFile.startsWith(".opencode/")) return
    if (relFile.startsWith(".opencode/openwork/")) return

    const parts = relFile.split("/")
    if (parts.length < 3) return
    if (!watched.has(parts[1])) return

    const base = parts.at(-1) ?? ""
    if (!base.includes(".")) return
    return relFile
  }

  const state = Instance.state(
    () => {
      if (!Flag.OPENCODE_HOT_RELOAD) return {}

      const debounce = Flag.OPENCODE_HOT_RELOAD_DEBOUNCE_MS ?? 700
      const cooldown = Flag.OPENCODE_HOT_RELOAD_COOLDOWN_MS ?? 1500
      let timer: ReturnType<typeof setTimeout> | undefined
      let busy = false
      let last = 0
      let latest:
        | {
            file: string
            event: "add" | "change" | "unlink"
          }
        | undefined

      const flush = () => {
        timer = undefined
        if (busy) return

        const now = Date.now()
        const wait = cooldown - (now - last)
        if (wait > 0) {
          timer = setTimeout(flush, wait)
          return
        }

        const hit = latest
        if (!hit) return

        busy = true
        last = now
        log.info("hot reload triggered", { file: hit.file, event: hit.event })
        void Instance.dispose()
          .catch((error) => {
            log.error("hot reload failed", { error, file: hit.file, event: hit.event })
          })
          .finally(() => {
            busy = false
          })
      }

      const schedule = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(flush, debounce)
      }

      const unsub = Bus.subscribe(FileWatcher.Event.Updated, (event) => {
        const rel = classify(Instance.directory, event.properties.file)
        if (!rel) return
        latest = {
          file: rel,
          event: event.properties.event,
        }
        schedule()
      })

      log.info("hot reload enabled", { debounce, cooldown })
      return {
        unsub,
        clear() {
          if (!timer) return
          clearTimeout(timer)
          timer = undefined
        },
      }
    },
    async (entry) => {
      entry.unsub?.()
      entry.clear?.()
    },
  )

  export function init() {
    state()
  }
}
