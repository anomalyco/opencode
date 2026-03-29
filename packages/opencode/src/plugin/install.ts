import path from "path"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"

import { ConfigPaths } from "@/config/paths"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flock } from "@/util/flock"

import { parsePluginSpecifier, readPluginPackage, resolvePluginTarget } from "./shared"

type Mode = "noop" | "add" | "replace"
type Kind = "server" | "tui"
type Key = string | number

type Op = {
  path: Key[]
  value: unknown
}

export type Target = {
  kind: Kind
  opts?: Record<string, unknown>
}

export type InstallDeps = {
  resolve: (spec: string) => Promise<string>
}

export type PatchDeps = {
  readText: (file: string) => Promise<string>
  write: (file: string, text: string) => Promise<void>
  exists: (file: string) => Promise<boolean>
  files: (dir: string, name: "opencode" | "tui") => string[]
}

export type PatchInput = {
  spec: string
  targets: Target[]
  force?: boolean
  global?: boolean
  vcs?: string
  worktree: string
  directory: string
  config?: string
}

type Ok<T> = {
  ok: true
} & T

type Err<C extends string, T> = {
  ok: false
  code: C
} & T

export type InstallResult = Ok<{ target: string }> | Err<"install_failed", { error: unknown }>

export type ManifestResult =
  | Ok<{ targets: Target[] }>
  | Err<"manifest_read_failed", { file: string; error: unknown }>
  | Err<"manifest_no_targets", { file: string }>

export type PatchItem = {
  kind: Kind
  mode: Mode
  file: string
}

type PatchErr =
  | Err<"invalid_json", { kind: Kind; file: string; line: number; col: number; parse: string }>
  | Err<"patch_failed", { kind: Kind; error: unknown }>

type PatchOne = Ok<{ item: PatchItem }> | PatchErr

export type PatchResult = Ok<{ dir: string; items: PatchItem[] }> | (PatchErr & { dir: string })

const defaultInstallDeps: InstallDeps = {
  resolve: (spec) => resolvePluginTarget(spec),
}

const defaultPatchDeps: PatchDeps = {
  readText: (file) => Filesystem.readText(file),
  write: async (file, text) => {
    await Filesystem.write(file, text)
  },
  exists: (file) => Filesystem.exists(file),
  files: (dir, name) => ConfigPaths.fileInDirectory(dir, name),
}

function pluginSpec(item: unknown) {
  if (typeof item === "string") return item
  if (!Array.isArray(item)) return
  if (typeof item[0] !== "string") return
  return item[0]
}

function pluginList(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  const item = data as { plugin?: unknown }
  if (!Array.isArray(item.plugin)) return
  return item.plugin
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

function patchPluginOps(
  list: unknown[],
  spec: string,
  next: unknown,
  force = false,
  array = true,
): { mode: Mode; ops: Op[] } {
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
      ops: [
        {
          path: array ? ["plugin", list.length] : ["plugin"],
          value: array ? next : [next],
        },
      ],
    }
  }

  if (!force) {
    return {
      mode: "noop",
      ops: [],
    }
  }

  const keep = dup[0]
  if (!keep) {
    return {
      mode: "noop",
      ops: [],
    }
  }

  if (dup.length === 1 && keep.spec === spec) {
    return {
      mode: "noop",
      ops: [],
    }
  }

  const set = (() => {
    if (typeof keep.item === "string") {
      return {
        path: ["plugin", keep.i],
        value: next,
      }
    }
    if (Array.isArray(keep.item) && typeof keep.item[0] === "string") {
      return {
        path: ["plugin", keep.i, 0],
        value: spec,
      }
    }
  })()

  const del = dup
    .map((item) => item.i)
    .filter((i) => i !== keep.i)
    .sort((a, b) => b - a)
    .map((i) => ({
      path: ["plugin", i],
      value: undefined,
    }))

  return {
    mode: "replace",
    ops: set ? [set, ...del] : del,
  }
}

function patchText(text: string, ops: Op[]) {
  return ops.reduce((acc, op) => {
    const edits = modify(acc, op.path, op.value, {
      formattingOptions: {
        tabSize: 2,
        insertSpaces: true,
      },
    })
    return applyEdits(acc, edits)
  }, text)
}

export async function installPlugin(spec: string, dep: InstallDeps = defaultInstallDeps): Promise<InstallResult> {
  const target = await dep.resolve(spec).then(
    (item) => ({
      ok: true as const,
      item,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    }),
  )
  if (!target.ok) {
    return {
      ok: false,
      code: "install_failed",
      error: target.error,
    }
  }
  return {
    ok: true,
    target: target.item,
  }
}

export async function readPluginManifest(target: string): Promise<ManifestResult> {
  const pkg = await readPluginPackage(target).then(
    (item) => ({
      ok: true as const,
      item,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    }),
  )
  if (!pkg.ok) {
    return {
      ok: false,
      code: "manifest_read_failed",
      file: target,
      error: pkg.error,
    }
  }

  const targets = parseTargets(pkg.item.json["oc-plugin"])
  if (!targets.length) {
    return {
      ok: false,
      code: "manifest_no_targets",
      file: pkg.item.pkg,
    }
  }

  return {
    ok: true,
    targets,
  }
}

function patchDir(input: PatchInput) {
  if (input.global) return input.config ?? Global.Path.config
  const git = input.vcs === "git" && input.worktree !== "/"
  const root = git ? input.worktree : input.directory
  return path.join(root, ".opencode")
}

function patchName(kind: Kind): "opencode" | "tui" {
  if (kind === "server") return "opencode"
  return "tui"
}

async function patchOne(dir: string, target: Target, spec: string, force: boolean, dep: PatchDeps): Promise<PatchOne> {
  const name = patchName(target.kind)
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
    return err
  })
  if (src instanceof Error) {
    return {
      ok: false,
      code: "patch_failed",
      kind: target.kind,
      error: src,
    }
  }
  const text = src.trim() ? src : "{}"

  const errs: JsoncParseError[] = []
  const data = parseJsonc(text, errs, { allowTrailingComma: true })
  if (errs.length) {
    const err = errs[0]
    const lines = text.substring(0, err.offset).split("\n")
    return {
      ok: false,
      code: "invalid_json",
      kind: target.kind,
      file: cfg,
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
      parse: printParseErrorCode(err.error),
    }
  }

  const list = pluginList(data)
  const item = target.opts ? [spec, target.opts] : spec
  const out = patchPluginOps(list ?? [], spec, item, force, Boolean(list))
  if (out.mode === "noop") {
    return {
      ok: true,
      item: {
        kind: target.kind,
        mode: out.mode,
        file: cfg,
      },
    }
  }

  const write = await dep.write(cfg, patchText(text, out.ops)).catch((error: unknown) => error)
  if (write instanceof Error) {
    return {
      ok: false,
      code: "patch_failed",
      kind: target.kind,
      error: write,
    }
  }

  return {
    ok: true,
    item: {
      kind: target.kind,
      mode: out.mode,
      file: cfg,
    },
  }
}

export async function patchPluginConfig(input: PatchInput, dep: PatchDeps = defaultPatchDeps): Promise<PatchResult> {
  const dir = patchDir(input)
  const items: PatchItem[] = []
  for (const target of input.targets) {
    const hit = await patchOne(dir, target, input.spec, Boolean(input.force), dep)
    if (!hit.ok) {
      return {
        ...hit,
        dir,
      }
    }
    items.push(hit.item)
  }
  return {
    ok: true,
    dir,
    items,
  }
}
