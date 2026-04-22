import { cp, mkdir, rename, rm } from "fs/promises"
import path from "path"
import z from "zod"
import { Tool } from "../shared/tool"
import { Instance } from "../../project/instance"
import { assertExternalDirectory } from "../external-directory"
import { Filesystem } from "../../util/filesystem"
import { FileTime } from "../../file/time"
import { Bus } from "../../bus"
import { File } from "../../file"
import { FileWatcher } from "../../file/watcher"
import { Glob } from "../../util/glob"

const DESCRIPTION = `Performs filesystem path operations for files and directories.

Usage:
- Use this for filesystem topology changes. Prefer \`edit\` or \`write\` for content-only changes, and prefer \`apply_patch\` when the change is best expressed as a coordinated multi-file patch set.
- Use this when you need to create directories, move files or folders, copy files or folders, rename paths, or delete paths without using bash.
- Provide one or more operations in order. Operations are applied sequentially.
- Supported actions are \`mkdir\`, \`move\`, \`copy\`, \`rename\`, and \`delete\`.
- \`rename\` is for changing the name within the same parent directory. Use \`move\` when the parent directory changes.
- For \`move\` and \`copy\`, if \`target\` is an existing directory or ends with a trailing path separator, the source basename is appended under that directory.
- Existing targets are preserved unless you pass \`overwrite: true\`.
- \`copy\` and directory \`delete\` require \`recursive: true\` when the source is a directory.
- \`move\`, \`copy\`, and \`rename\` create missing target parent directories by default. Set \`create_parents: false\` only when the full target path already exists as intended.
- \`delete\` is a safe delete: the source is moved under \`.backup/delete/<timestamp>/<source-relative-path>\` inside the project instead of being permanently removed.
- \`delete\` does not use \`target\` and always creates the internal backup folder path automatically.
- The tool will keep \`.backup/\` ignored and will best-effort update \`.csproj\`, \`.fsproj\`, and \`.vbproj\` path references when operations affect explicit project entries.`

const Action = z.enum(["mkdir", "move", "copy", "delete", "rename"])

const Item = z
  .object({
    action: Action.describe("Filesystem path operation to perform."),
    source: z.string().optional().describe("Source file or directory path for move, copy, delete, or rename."),
    target: z.string().optional().describe("Target file or directory path for mkdir, move, copy, or rename."),
    recursive: z.boolean().optional().describe("Required for copying directories and deleting directories."),
    overwrite: z.boolean().optional().describe("Allow replacing the target if it already exists."),
    create_parents: z.boolean().optional().describe("Create missing parent directories for the target path."),
  })
  .superRefine((input, ctx) => {
    if (input.action === "mkdir") {
      if (!input.target) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "target is required for mkdir", path: ["target"] })
      }
      return
    }

    if (!input.source) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `source is required for ${input.action}`, path: ["source"] })
    }

    if (["move", "copy", "rename"].includes(input.action) && !input.target) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `target is required for ${input.action}`, path: ["target"] })
    }
  })

const parameters = z.object({
  operations: z.array(Item).min(1).describe("Ordered filesystem path operations to run sequentially."),
})

type Op = z.infer<typeof Item>

type Plan = {
  action: z.infer<typeof Action>
  source?: string
  target?: string
  backup?: string
  dir: boolean
}

type Update = {
  file: string
  next: string
  note: string
}

function abs(input?: string) {
  if (!input) return undefined
  return path.isAbsolute(input) ? input : path.resolve(Instance.directory, input)
}

function rel(file: string) {
  return path.relative(Instance.worktree, file).replaceAll("\\", "/")
}

function same(file: string, next: string) {
  return Filesystem.normalizePath(file) === Filesystem.normalizePath(next)
}

function inside(root: string, file: string) {
  const out = path.relative(root, file)
  return out === "" || (!out.startsWith("..") && !path.isAbsolute(out))
}

function stamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
}

function backupRel(file: string) {
  if (inside(Instance.worktree, file)) return rel(file)
  return path.join("__external__", ...file.split(/[\\/]+/).filter(Boolean))
}

function style(file: string) {
  return file.includes("\\") ? "\\" : "/"
}

function plain(file: string) {
  return !file.includes("$(") && !file.includes("*") && !file.includes("?")
}

function trail(file?: string) {
  return !!file && /[\\/]$/.test(file)
}

function resolveRef(dir: string, file: string) {
  return path.resolve(dir, file.replaceAll("\\", "/"))
}

function renderRef(dir: string, file: string, sample: string) {
  const out = path.relative(dir, file)
  return style(sample) === "\\" ? out.replaceAll("/", "\\") : out.replaceAll("\\", "/")
}

function hits(source: string, file: string, dir: boolean) {
  return dir ? inside(source, file) : same(source, file)
}

function shift(source: string, target: string, file: string, dir: boolean) {
  if (!dir) return target
  return path.join(target, path.relative(source, file))
}

function replaceAttr(text: string, key: string, prev: string, next: string) {
  return text.replace(`${key}="${prev}"`, `${key}="${next}"`)
}

function patchProject(text: string, file: string, plan: Plan) {
  const dir = path.dirname(file)
  const regs = [
    /<([A-Za-z0-9_.:-]+)\b([^>]*\b(?:Include|Update|Remove)="[^"]+"[^>]*)\/>/g,
    /<([A-Za-z0-9_.:-]+)\b([^>]*\b(?:Include|Update|Remove)="[^"]+"[^>]*)>([\s\S]*?)<\/\1>/g,
  ]

  let out = text
  for (const reg of regs) {
    out = out.replace(reg, (full) => {
      const attrs = [...full.matchAll(/\b(Include|Update|Remove)="([^"]+)"/g)]
      if (attrs.length === 0) return full

      let hit = false
      let next = full
      for (const item of attrs) {
        const key = item[1]
        const prev = item[2]
        if (!plain(prev)) continue
        const resolved = resolveRef(dir, prev)
        if (!hits(plan.source!, resolved, plan.dir)) continue
        hit = true
        if (plan.action === "delete") return ""
        const target = shift(plan.source!, plan.target!, resolved, plan.dir)
        next = replaceAttr(next, key, prev, renderRef(dir, target, prev))
      }

      if (!hit) return full
      if (plan.action !== "copy" || next === full || out.includes(next)) return next
      return `${full}\n${next}`
    })
  }

  return out.replace(/\n{3,}/g, "\n\n")
}

async function projectUpdates(plan: Plan) {
  if (!plan.source) return [] as Update[]
  if (!inside(Instance.worktree, plan.source) && !(plan.target && inside(Instance.worktree, plan.target))) return []
  const files = await Glob.scan("**/*.{csproj,fsproj,vbproj}", {
    cwd: Instance.worktree,
    absolute: true,
    dot: true,
  })
  const out: Update[] = []
  for (const file of files) {
    const text = await Filesystem.readText(file)
    const next = patchProject(text, file, plan)
    if (next === text) continue
    out.push({
      file,
      next,
      note: `Updated project path references in ${rel(file)}.`,
    })
  }
  return out
}

async function ignoreUpdates() {
  const out: Update[] = []
  for (const name of [".gitignore", ".ignore", ".rgignore", ".fdignore"]) {
    const file = path.join(Instance.worktree, name)
    const exists = await Filesystem.exists(file)
    if (!exists && name !== ".gitignore") continue
    const text = exists ? await Filesystem.readText(file) : ""
    const rows = text.split(/\r?\n/).map((item) => item.trim())
    if (rows.includes(".backup/") || rows.includes("/.backup/")) continue
    const next = text.trimEnd() ? `${text.trimEnd()}\n.backup/\n` : ".backup/\n"
    out.push({ file, next, note: `Ensured ${name} ignores .backup/.` })
  }
  return out
}

async function writeText(file: string, next: string, ctx: Tool.Context) {
  await FileTime.withLock(file, async () => {
    const exists = await Filesystem.exists(file)
    if (exists) {
      await FileTime.read(ctx.sessionID, file)
      await FileTime.assert(ctx.sessionID, file)
    }
    await Filesystem.write(file, next)
    Bus.publish(File.Event.Edited, { file })
    await Bus.publish(FileWatcher.Event.Updated, { file, event: exists ? "change" : "add" })
    await FileTime.read(ctx.sessionID, file)
  })
}

async function askEdit(ctx: Tool.Context, plan: Plan, updates: Update[]) {
  const patterns = [plan.source, plan.target, plan.backup, ...updates.map((item) => item.file)]
    .filter(Boolean)
    .map((item) => rel(item!))
  await ctx.ask({
    permission: "edit",
    patterns,
    always: ["*"],
    metadata: {
      action: plan.action,
      source: plan.source,
      target: plan.target,
      backup: plan.backup,
      files: updates.map((item) => item.file),
    },
  })
}

async function removeTarget(file: string) {
  if (!(await Filesystem.exists(file))) return
  await rm(file, { recursive: true, force: true })
}

async function moveEntry(source: string, target: string, overwrite?: boolean, parents = true) {
  if (overwrite) await removeTarget(target)
  if (!overwrite && (await Filesystem.exists(target))) throw new Error(`Target already exists: ${target}`)
  if (parents) await mkdir(path.dirname(target), { recursive: true })
  try {
    await rename(source, target)
    return
  } catch (err) {
    if (!(err instanceof Error) || !("code" in err) || err.code !== "EXDEV") throw err
  }

  const stats = await Filesystem.statAsync(source)
  if (!stats) throw new Error(`Path not found: ${source}`)
  await cp(source, target, { recursive: stats.isDirectory(), force: overwrite ?? false, errorOnExist: !overwrite })
  await rm(source, { recursive: true, force: true })
}

async function copyEntry(source: string, target: string, overwrite?: boolean, parents = true) {
  const stats = await Filesystem.statAsync(source)
  if (!stats) throw new Error(`Path not found: ${source}`)
  if (overwrite) await removeTarget(target)
  if (!overwrite && (await Filesystem.exists(target))) throw new Error(`Target already exists: ${target}`)
  if (parents) await mkdir(path.dirname(target), { recursive: true })
  await cp(source, target, { recursive: stats.isDirectory(), force: overwrite ?? false, errorOnExist: !overwrite })
}

async function targetPath(source: string, target: string, action: Plan["action"], hint = false) {
  if (action === "rename") return target
  const hit = await Filesystem.statAsync(target)
  if (hit?.isDirectory() || hint) return path.join(target, path.basename(source))
  return target
}

async function plan(input: Op, root: string) {
  if (input.action === "mkdir") {
    const target = abs(input.target)!
    return { action: input.action, target, dir: true } satisfies Plan
  }

  const source = abs(input.source)!
  const stats = await Filesystem.statAsync(source)
  if (!stats) throw new Error(`Path not found: ${source}`)
  const dir = stats.isDirectory()
  const hint = trail(input.target)
  let target = abs(input.target)

  if (input.action === "rename") {
    target = abs(input.target)
    if (!target) throw new Error("target is required for rename")
    if (path.dirname(source) !== path.dirname(target)) {
      throw new Error("rename must stay within the same parent directory; use move when the parent directory changes")
    }
  }

  if (input.action === "delete") {
    const target = path.join(root, backupRel(source))
    return { action: input.action, source, target, backup: target, dir } satisfies Plan
  }

  if (!target) throw new Error(`target is required for ${input.action}`)
  target = await targetPath(source, target, input.action, hint)
  if (same(source, target)) throw new Error(`${input.action} source and target resolve to the same path`)
  return { action: input.action, source, target, dir } satisfies Plan
}

export const PathEditTool = Tool.define("path_edit", {
  description: DESCRIPTION,
  parameters,
  async execute(input, ctx) {
    const base = path.join(Instance.worktree, ".backup", "delete", stamp())
    const notes: string[] = []
    const touched = new Set<string>()

    for (const item of input.operations) {
      const next = await plan(item, base)

      if (next.source) {
        await assertExternalDirectory(ctx, next.source, { kind: next.dir ? "directory" : "file" })
      }
      if (next.target) {
        await assertExternalDirectory(ctx, next.target, { kind: next.dir ? "directory" : "file" })
      }

      if (["copy", "delete"].includes(next.action) && next.dir && !item.recursive) {
        throw new Error(`${next.action} on a directory requires recursive: true`)
      }

      if (next.action === "mkdir") {
        await askEdit(ctx, next, [])
        await mkdir(next.target!, {
          recursive: item.recursive === true || item.create_parents !== false,
        })
        notes.push(`mkdir ${rel(next.target!)}`)
        continue
      }

      const updates = [...(next.action === "delete" ? await ignoreUpdates() : []), ...(await projectUpdates(next))]
      await askEdit(ctx, next, updates)
      const parents = next.action === "delete" ? true : (item.create_parents ?? true)

      if (["move", "rename", "delete"].includes(next.action)) {
        await moveEntry(next.source!, next.target!, item.overwrite, parents)
        notes.push(`${next.action} ${rel(next.source!)} -> ${rel(next.target!)}`)
      }

      if (next.action === "copy") {
        await copyEntry(next.source!, next.target!, item.overwrite, parents)
        notes.push(`copy ${rel(next.source!)} -> ${rel(next.target!)}`)
      }

      if (next.source && next.action !== "copy") {
        await Bus.publish(FileWatcher.Event.Updated, {
          file: next.source,
          event: "unlink",
        })
      }
      if (next.target) {
        await Bus.publish(FileWatcher.Event.Updated, { file: next.target, event: "add" })
      }

      for (const update of updates) {
        await writeText(update.file, update.next, ctx)
        touched.add(update.file)
      }
    }

    const lines = [
      ...notes.map((item) => `- ${item}`),
      ...(touched.size > 0
        ? ["", "Updated support files:", ...[...touched].sort().map((item) => `- ${rel(item)}`)]
        : []),
    ]

    return {
      title: "path_edit",
      metadata: {
        operations: notes,
        files: [...touched].sort(),
      },
      output: lines.join("\n"),
    }
  },
})
