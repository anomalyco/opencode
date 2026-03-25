import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { spinner, log, intro, outro } from "@clack/prompts"
import path from "path"
import type { BigIntStats, Stats } from "fs"
import { mkdir } from "fs/promises"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { Instance } from "../../project/instance"
import { Global } from "../../global"
import { UI } from "../ui"
import { ConfigPaths } from "../../config/paths"
import { Filesystem } from "../../util/filesystem"
import { Flock } from "../../util/flock"
import { Process } from "../../util/process"
import { errorMessage } from "../../util/error"
import { parsePluginSpecifier, resolvePluginTarget } from "../../plugin/shared"

type Mode = "noop" | "add" | "replace"
type Kind = "server" | "tui"
type Target = {
  kind: Kind
  opts?: Record<string, unknown>
}

function pluginSpec(item: unknown) {
  if (typeof item === "string") return item
  if (!Array.isArray(item)) return
  if (typeof item[0] !== "string") return
  return item[0]
}

function parseTarget(item: unknown): Target | undefined {
  if (item === "server" || item === "tui") return { kind: item }
  if (!Array.isArray(item)) return
  if (item[0] !== "server" && item[0] !== "tui") return
  if (item.length < 2) return { kind: item[0] }
  const opt = item[1]
  if (!opt || typeof opt !== "object" || Array.isArray(opt)) return { kind: item[0] }
  return {
    kind: item[0],
    opts: opt,
  }
}

function parseTargets(raw: unknown) {
  if (!Array.isArray(raw)) return []
  const map = new Map<Kind, Target>()
  for (const item of raw) {
    const hit = parseTarget(item)
    if (!hit) continue
    map.set(hit.kind, hit)
  }
  return [...map.values()]
}

function patchPluginList(list: unknown[], spec: string, next: unknown, force = false): { mode: Mode; list: unknown[] } {
  const pkg = parsePluginSpecifier(spec).pkg
  const rows = list.map((item, i) => ({
    item,
    i,
    spec: pluginSpec(item),
  }))
  const dup = rows.filter((item) => {
    if (!item.spec) return false
    if (item.spec === spec) return true
    if (item.spec.startsWith("file://")) return false
    return parsePluginSpecifier(item.spec).pkg === pkg
  })

  if (!dup.length) {
    return {
      mode: "add",
      list: [...list, next],
    }
  }

  if (!force) {
    return {
      mode: "noop",
      list,
    }
  }

  const keep = dup[0]
  if (!keep) {
    return {
      mode: "noop",
      list,
    }
  }

  if (dup.length === 1 && keep.spec === spec) {
    return {
      mode: "noop",
      list,
    }
  }

  const idx = new Set(dup.map((item) => item.i))
  return {
    mode: "replace",
    list: rows.flatMap((row) => {
      if (!idx.has(row.i)) return [row.item]
      if (row.i !== keep.i) return []
      if (typeof row.item === "string") return [next]
      if (Array.isArray(row.item) && typeof row.item[0] === "string") {
        return [[spec, ...row.item.slice(1)]]
      }
      return [row.item]
    }),
  }
}

type Spin = {
  start: (msg: string) => void
  stop: (msg: string, code?: number) => void
}

export type PlugDeps = {
  spinner: () => Spin
  log: {
    error: (msg: string) => void
    info: (msg: string) => void
    success: (msg: string) => void
  }
  mkdir: (dir: string, opts: { recursive: true }) => Promise<void>
  resolve: (spec: string) => Promise<string>
  stat: (file: string) => Stats | BigIntStats | undefined
  readJson: <T = unknown>(file: string) => Promise<T>
  readText: (file: string) => Promise<string>
  write: (file: string, text: string) => Promise<void>
  exists: (file: string) => Promise<boolean>
  files: (dir: string, name: "opencode" | "tui") => string[]
  global: string
}

export type PlugInput = {
  mod: string
  global?: boolean
  force?: boolean
}

export type PlugCtx = {
  vcs?: string
  worktree: string
  directory: string
}

const defaultPlugDeps: PlugDeps = {
  spinner: () => spinner(),
  log: {
    error: (msg) => log.error(msg),
    info: (msg) => log.info(msg),
    success: (msg) => log.success(msg),
  },
  mkdir: async (dir, opts) => {
    await mkdir(dir, opts)
  },
  resolve: (spec) => resolvePluginTarget(spec),
  stat: (file) => Filesystem.stat(file),
  readJson: (file) => Filesystem.readJson(file),
  readText: (file) => Filesystem.readText(file),
  write: async (file, text) => {
    await Filesystem.write(file, text)
  },
  exists: (file) => Filesystem.exists(file),
  files: (dir, name) => ConfigPaths.fileInDirectory(dir, name),
  global: Global.Path.config,
}

export function createPlugTask(input: PlugInput, dep: PlugDeps = defaultPlugDeps) {
  const mod = input.mod
  const force = Boolean(input.force)
  const global = Boolean(input.global)

  return async (ctx: PlugCtx) => {
    const root = ctx.vcs === "git" ? ctx.worktree : ctx.directory
    const dir = global ? dep.global : path.join(root, ".opencode")
    await dep.mkdir(dir, { recursive: true })

    const install = dep.spinner()
    install.start("Installing plugin package...")
    const target = await dep.resolve(mod).catch((err) => err)
    if (target instanceof Error) {
      install.stop("Install failed", 1)
      dep.log.error(`Could not install "${mod}"`)
      if (target instanceof Process.RunFailedError) {
        const lines = target.stderr
          .toString()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        const errors = lines.filter((line) => line.startsWith("error:")).map((line) => line.replace(/^error:\s*/, ""))
        const detail = errors[0] ?? lines.at(-1)
        if (detail) dep.log.error(detail)
        if (lines.some((line) => line.includes("No version matching"))) {
          dep.log.info("This package depends on a version that is not available in your npm registry.")
          dep.log.info("Check npm registry/auth settings and try again.")
        }
      } else {
        dep.log.error(errorMessage(target))
      }
      return false
    }
    install.stop("Plugin package ready")

    const inspect = dep.spinner()
    inspect.start("Reading plugin manifest...")
    const stat = dep.stat(target)
    const base = stat?.isDirectory() ? target : path.dirname(target)
    const file = path.join(base, "package.json")
    const json = await dep.readJson<Record<string, unknown>>(file).catch((err) => err)
    if (json instanceof Error) {
      inspect.stop("Manifest read failed", 1)
      dep.log.error(`Installed "${mod}" but failed to read ${file}`)
      dep.log.error(errorMessage(json))
      return false
    }

    const raw = json["oc-plugin"]
    const targets = parseTargets(raw)

    if (!targets.length) {
      inspect.stop("No plugin targets found", 1)
      dep.log.error(`"${mod}" does not declare supported targets in package.json`)
      dep.log.info('Expected: "oc-plugin": ["server", "tui"] or tuples like [["tui", { ... }]].')
      return false
    }
    inspect.stop(`Detected ${targets.map((x) => x.kind).join(" + ")} target${targets.length === 1 ? "" : "s"}`)

    const patch = async (name: "opencode" | "tui", target: Target) => {
      const spin = dep.spinner()
      spin.start(`Updating ${target.kind} config...`)

      await using _ = await Flock.acquire(`plug-config:${Filesystem.resolve(path.join(dir, name))}`)

      const files = dep.files(dir, name)
      let cfg = files[0]
      for (const file of files) {
        if (!(await dep.exists(file))) continue
        cfg = file
        break
      }

      const src = await dep.readText(cfg).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return "{}"
        throw err
      })
      const text = src.trim() ? src : "{}"
      const errs: JsoncParseError[] = []
      const data = parseJsonc(text, errs, { allowTrailingComma: true })
      if (errs.length) {
        const err = errs[0]
        const lines = text.substring(0, err.offset).split("\n")
        const line = lines.length
        const col = lines[lines.length - 1].length + 1
        spin.stop(`Failed updating ${target.kind} config`, 1)
        dep.log.error(`Invalid JSON in ${cfg} (${printParseErrorCode(err.error)} at line ${line}, column ${col})`)
        dep.log.info("Fix the config file and run the command again.")
        return false
      }

      const list: unknown[] =
        data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.plugin) ? data.plugin : []
      const item = target.opts ? [mod, target.opts] : mod
      const out = patchPluginList(list, mod, item, force)

      if (out.mode === "noop") {
        spin.stop(`Already configured in ${cfg}`)
        return true
      }

      const edits = modify(text, ["plugin"], out.list, {
        formattingOptions: {
          tabSize: 2,
          insertSpaces: true,
        },
      })
      await dep.write(cfg, applyEdits(text, edits))
      spin.stop(out.mode === "replace" ? `Replaced in ${cfg}` : `Added to ${cfg}`)
      return true
    }

    if (targets.some((x) => x.kind === "server")) {
      const target = targets.find((x) => x.kind === "server")
      if (!target) return false
      const ok = await patch("opencode", target)
      if (!ok) return false
    }

    if (targets.some((x) => x.kind === "tui")) {
      const target = targets.find((x) => x.kind === "tui")
      if (!target) return false
      const ok = await patch("tui", target)
      if (!ok) return false
    }

    dep.log.success(`Installed ${mod}`)
    dep.log.info(global ? `Scope: global (${dir})` : `Scope: local (${dir})`)
    return true
  }
}

export const PlugCommand = cmd({
  command: "plug <module>",
  aliases: ["plugin"],
  describe: "install plugin and update config",
  builder: (yargs: Argv) => {
    return yargs
      .positional("module", {
        type: "string",
        describe: "npm module name",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "install in global config",
      })
      .option("force", {
        alias: ["f"],
        type: "boolean",
        default: false,
        describe: "replace existing plugin version",
      })
  },
  handler: async (args) => {
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
  },
})
