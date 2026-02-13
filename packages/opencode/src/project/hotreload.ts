import path from "path"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { FileWatcher } from "@/file/watcher"
import { Flag } from "@/flag/flag"
import { SessionStatus } from "@/session/status"
import { Skill } from "@/skill"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import z from "zod"

export namespace HotReload {
  const log = Log.create({ service: "project.hotreload" })

  export const Event = {
    Changed: BusEvent.define(
      "opencode.hotreload.changed",
      z.object({
        file: z.string(),
        event: z.enum(["add", "change", "unlink"]),
      }),
    ),
    Applied: BusEvent.define(
      "opencode.hotreload.applied",
      z.object({
        file: z.string(),
        event: z.enum(["add", "change", "unlink"]),
      }),
    ),
  }

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
      if (!Flag.OPENCODE_EXPERIMENTAL_HOT_RELOAD) return {}

      const debounce = Flag.OPENCODE_EXPERIMENTAL_HOT_RELOAD_DEBOUNCE_MS ?? 700
      const cooldown = Flag.OPENCODE_EXPERIMENTAL_HOT_RELOAD_COOLDOWN_MS ?? 1500
      const mode = Flag.OPENCODE_EXPERIMENTAL_HOT_RELOAD_MODE === "manual" ? "manual" : "auto"
      let timer: ReturnType<typeof setTimeout> | undefined
      let busy = false
      let last = 0
      let queued = false
      let latest:
        | {
            file: string
            event: "add" | "change" | "unlink"
          }
        | undefined

      const active = () =>
        Object.values(SessionStatus.list()).filter((status) => status.type === "busy" || status.type === "retry").length

      const reload = async () => {
        await Config.reset()
        await Skill.reset()
        await Agent.reset()
        await Command.reset()
      }

      const schedule = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => flush("timer"), debounce)
      }

      const flush = (reason: "timer" | "session" | "api") => {
        timer = undefined
        if (busy) return { ok: true, queued, sessions: active() }

        const hit = latest
        if (!hit) return { ok: true, queued, sessions: active() }

        const sessions = active()
        if (sessions > 0) {
          if (!queued) {
            log.info("hot reload queued", {
              file: hit.file,
              event: hit.event,
              sessions,
            })
          }
          queued = true
          return { ok: true, queued: true, sessions }
        }

        const now = Date.now()
        const wait = cooldown - (now - last)
        if (wait > 0) {
          timer = setTimeout(() => flush(reason), wait)
          return { ok: true, queued: false, sessions, wait }
        }

        busy = true
        queued = false
        latest = undefined
        last = now
        log.info("hot reload triggered", { file: hit.file, event: hit.event, reason })
        void reload()
          .then(() =>
            Bus.publish(Event.Applied, {
              file: hit.file,
              event: hit.event,
            }),
          )
          .catch((error) => {
            log.error("hot reload failed", { error, file: hit.file, event: hit.event })
          })
          .finally(() => {
            busy = false
            if (!latest) return
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => flush("timer"), debounce)
          })
        return { ok: true, queued: false, sessions }
      }

      const request = (hit: { file: string; event: "add" | "change" | "unlink" }, mode: "file" | "api") => {
        latest = hit
        if (mode === "api") return flush("api")
        schedule()
        return { ok: true, queued, sessions: active() }
      }

      const unsubFile = Bus.subscribe(FileWatcher.Event.Updated, (event) => {
        const rel = classify(Instance.directory, event.properties.file)
        if (!rel) return

        const hit = {
          file: rel,
          event: event.properties.event,
        } as const

        void Bus.publish(Event.Changed, hit)
        if (mode === "manual") return
        void request(hit, "file")
      })

      const unsubSession = Bus.subscribe(SessionStatus.Event.Status, () => {
        if (!queued) return
        if (timer) return
        timer = setTimeout(() => flush("session"), 0)
      })

      log.info("hot reload enabled", { debounce, cooldown, mode })
      return {
        unsubFile,
        unsubSession,
        request,
        clear() {
          if (!timer) return
          clearTimeout(timer)
          timer = undefined
        },
      }
    },
    async (entry) => {
      entry.unsubFile?.()
      entry.unsubSession?.()
      entry.clear?.()
    },
  )

  export function init() {
    state()
  }

  export function request(input?: { file?: string; event?: "add" | "change" | "unlink" }) {
    const entry = state()
    const req = "request" in entry ? entry.request : undefined
    if (!req) {
      return { ok: false, enabled: false }
    }
    const file = input?.file?.trim() || "api"
    const event = input?.event || "change"
    const result = req({ file, event }, "api")
    return { ...result, enabled: true }
  }
}
