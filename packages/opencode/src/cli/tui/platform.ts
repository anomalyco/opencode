import type { CliRenderer } from "@opentui/core"
import type { TuiPlatform } from "@opencode-ai/tui/platform"
import { Filesystem } from "@/util/filesystem"
import { Clipboard } from "./clipboard"
import { Editor } from "./editor"
import { Flock } from "@opencode-ai/core/util/flock"
import { Glob } from "@opencode-ai/core/util/glob"
import { Global } from "@opencode-ai/core/global"
import { readJson, writeJsonAtomic } from "@opencode-ai/tui/util/persistence"
import path from "path"
import os from "node:os"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolveZedSelection } from "./editor-zed"

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
      connection: discoverEditorConnection,
      selection: (directory) => resolveZedSelection(resolveZedDbPath(), directory),
    },
    export: {
      write: Filesystem.write,
    },
  }
}

export function discoverEditorConnection(directory: string) {
  const root = path.join(os.homedir(), ".claude", "ide")
  const contains = (parent: string) => {
    const resolved = path.resolve(parent)
    const relative = path.relative(resolved, path.resolve(directory))
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved.length : 0
  }
  try {
    return readdirSync(root)
      .filter((entry) => entry.endsWith(".lock"))
      .flatMap((entry) => {
        const file = path.join(root, entry)
        const port = Number.parseInt(path.basename(file, ".lock"), 10)
        if (!Number.isInteger(port) || port <= 0 || port > 65535) return []
        try {
          const value = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>
          if (value.transport !== undefined && value.transport !== "ws") return []
          const folders = Array.isArray(value.workspaceFolders)
            ? value.workspaceFolders.filter((item): item is string => typeof item === "string")
            : []
          const score = Math.max(0, ...folders.map(contains))
          if (!score) return []
          return [
            {
              url: `ws://127.0.0.1:${port}`,
              authToken: typeof value.authToken === "string" ? value.authToken : undefined,
              source: `lock:${port}`,
              score,
              mtime: statSync(file).mtimeMs,
            },
          ]
        } catch {
          return []
        }
      })
      .sort((left, right) => right.score - left.score || right.mtime - left.mtime)
      .map(({ url, authToken, source }) => ({ url, authToken, source }))[0]
  } catch {
    return undefined
  }
}

function resolveZedDbPath() {
  const candidates = [
    process.env.OPENCODE_ZED_DB,
    path.join(os.homedir(), "Library", "Application Support", "Zed", "db", "0-stable", "db.sqlite"),
    path.join(os.homedir(), ".local", "share", "zed", "db", "0-stable", "db.sqlite"),
  ].filter((item): item is string => Boolean(item))
  return (
    candidates.find((item) => {
      try {
        return statSync(item).isFile()
      } catch {
        return false
      }
    }) ?? ""
  )
}
