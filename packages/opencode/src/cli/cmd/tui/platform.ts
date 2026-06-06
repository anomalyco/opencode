import type { CliRenderer } from "@opentui/core"
import type { TuiPlatform } from "@opencode-ai/tui/platform"
import { Filesystem } from "@/util/filesystem"
import { Clipboard } from "./util/clipboard"
import { Editor } from "./util/editor"
import { Flock } from "@opencode-ai/core/util/flock"
import { Glob } from "@opencode-ai/core/util/glob"
import { Global } from "@opencode-ai/core/global"
import { readJson, writeJsonAtomic } from "@opencode-ai/tui/util/persistence"
import path from "path"

export function createLegacyTuiPlatform(renderer: CliRenderer): TuiPlatform {
  const statePath = path.join(Global.Path.state, "kv.json")
  const stateLock = `tui-kv:${statePath}`
  return {
    files: {
      readText: Filesystem.readText,
      readBytes: Filesystem.readBytes,
      mime: Filesystem.mimeType,
    },
    state: {
      read: () => Flock.withLock(stateLock, () => readJson<Record<string, unknown>>(statePath)),
      write: (value) => Flock.withLock(stateLock, () => writeJsonAtomic(statePath, value)),
    },
    themes: {
      async discover() {
        const directories = [
          Global.Path.config,
          ...(await Array.fromAsync(Filesystem.up({ targets: [".opencode"], start: process.cwd() }))),
        ]
        const result: Record<string, unknown> = {}
        for (const dir of directories) {
          for (const item of await Glob.scan("themes/*.json", {
            cwd: dir,
            absolute: true,
            dot: true,
            symlink: true,
          })) {
            result[path.basename(item, ".json")] = await Filesystem.readJson(item)
          }
        }
        return result
      },
      subscribeRefresh(refresh) {
        process.on("SIGUSR2", refresh)
        return () => process.off("SIGUSR2", refresh)
      },
    },
    clipboard: {
      read: Clipboard.read,
      write: Clipboard.copy,
    },
    editor: {
      open: (input) => Editor.open({ ...input, renderer }),
    },
    export: {
      write: Filesystem.write,
    },
  }
}
