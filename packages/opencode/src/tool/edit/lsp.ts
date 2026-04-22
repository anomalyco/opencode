import { Snapshot } from "@/snapshot"
import { Bus } from "../../bus"
import { File } from "../../file"
import { FileTime } from "../../file/time"
import { FileWatcher } from "../../file/watcher"
import { Format } from "../../format"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { LSPClient } from "../../lsp/client"
import { Filesystem } from "../../util/filesystem"
import { createTwoFilesPatch, diffLines } from "diff"
import { rm } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import type { Tool } from "../shared/tool"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5
const MAX_ACTION_ERRORS = 3
const MAX_ACTIONS = 3

type AnyRecord = Record<string, unknown>

type EditLike = {
  range?: {
    start?: {
      line?: number
      character?: number
    }
    end?: {
      line?: number
      character?: number
    }
  }
  newText?: string
}

type FilePlan = {
  file: string
  existed: boolean
  old: string
  next: string
  diff: string
  filediff: Snapshot.FileDiff
}

export async function withTouchedFiles<T>(files: string[], fn: (touches: LSP.TouchStatus[]) => Promise<T>) {
  const list = [...new Set(files.map((item) => Filesystem.normalizePath(item)))]
  const touches: LSP.TouchStatus[] = []
  for (const file of list) touches.push(await LSP.touchFile(file, true))
  try {
    return await fn(touches)
  } finally {
    for (const file of list) await LSP.closeFile(file).catch(() => undefined)
  }
}

export function appendTouchWarnings(output: string, touches: LSP.TouchStatus[]) {
  const lines = touches.flatMap((item) => LSP.touchWarnings(item))
  if (!lines.length) return output
  return `${output}\n\n${lines.map((item) => `LSP notice: ${item}`).join("\n")}`
}

export function appendDiagnostics(output: string, diagnostics: Record<string, LSPClient.Diagnostic[]>, files: string[]) {
  const seen = new Set(files.map((item) => Filesystem.normalizePath(item)))
  const list = [...seen]

  for (const file of list) {
    const issues = diagnostics[file] ?? []
    const errors = issues.filter((item) => item.severity === 1)
    if (!errors.length) continue
    const rel = path.relative(Instance.worktree, file).replaceAll("\\", "/")
    const label = list.length === 1 ? "this file" : rel
    output += diagnosticBlock(output, file, label, errors)
  }

  let count = 0
  for (const [file, issues] of Object.entries(diagnostics)) {
    if (seen.has(file)) continue
    const errors = issues.filter((item) => item.severity === 1)
    if (!errors.length) continue
    if (count >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
    count++
    output += diagnosticBlock(output, file, "other files", errors)
  }

  return output
}

export async function appendCodeActions(output: string, diagnostics: Record<string, LSPClient.Diagnostic[]>, files: string[]) {
  for (const file of [...new Set(files.map((item) => Filesystem.normalizePath(item)))]) {
    const issues = (diagnostics[file] ?? []).filter((item) => item.severity === 1).slice(0, MAX_ACTION_ERRORS)
    if (!issues.length) continue

    const actions: string[] = []
    for (const issue of issues) {
      const result = await LSP.codeAction({
        file,
        line: issue.range.start.line,
        character: issue.range.start.character,
        endLine: issue.range.end.line,
        endCharacter: issue.range.end.character,
        only: ["quickfix", "refactor", "refactor.rename", "source.fixAll"],
      }).catch(() => [])

      for (const item of result.slice(0, MAX_ACTIONS)) {
        const title = actionTitle(item)
        if (!title || actions.includes(title)) continue
        actions.push(title)
      }
    }

    if (!actions.length) continue
    const rel = path.relative(Instance.worktree, file).replaceAll("\\", "/")
    output += `\n\nLSP suggested fixes for ${rel}:\n<code-actions file="${file}">\n${actions
      .map((item) => `- ${item}`)
      .join("\n")}\n</code-actions>`
  }

  return output
}

export async function tryRenamePlan(input: {
  file: string
  old: string
  next: string
  replaceAll?: boolean
  sessionID: Tool.Context["sessionID"]
}) {
  if (input.replaceAll) return
  if (!ident(input.old) || !ident(input.next)) return
  if (!(await LSP.hasClients(input.file))) return

  const content = await Filesystem.readText(input.file).catch(() => undefined)
  if (content === undefined) return
  const hit = renameHit(content, input.old)
  if (!hit) return

  const prep = await withTouchedFiles([input.file], async () => {
    return LSP.prepareRename({
      file: input.file,
      line: hit.line,
      character: hit.character,
    }).catch(() => [])
  })
  if (!prep.length) return

  const result = await withTouchedFiles([input.file], async () => {
    return LSP.rename({
      file: input.file,
      line: hit.line,
      character: hit.character,
      newName: input.next,
    }).catch(() => [])
  })

  const plan = await workspacePlan(result, input.sessionID)
  if (!plan?.length) return
  return plan
}

export async function applyRenamePlan(input: { plan: FilePlan[]; ctx: Tool.Context; file: string }) {
  const diff = input.plan.map((item) => item.diff).filter(Boolean).join("\n")
  const files = input.plan.map((item) => ({
    filePath: item.file,
    relativePath: path.relative(Instance.worktree, item.file).replaceAll("\\", "/"),
    type: item.existed ? "update" : "add",
    patch: item.diff,
    additions: item.filediff.additions,
    deletions: item.filediff.deletions,
  }))

  await input.ctx.ask({
    permission: "edit",
    patterns: files.map((item) => item.relativePath),
    always: ["*"],
    metadata: {
      filepath: files.map((item) => item.filePath).join(", "),
      diff,
      files,
    },
  })

  const done: FilePlan[] = []
  try {
    for (const item of input.plan) {
      await Filesystem.write(item.file, item.next)
      await Format.file(item.file)
      const now = await Filesystem.readText(item.file)
      item.next = now
      item.diff = trim(item.file, item.old, now)
      item.filediff = filediff(item.file, item.old, now, item.diff)
      Bus.publish(File.Event.Edited, { file: item.file })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: item.file,
        event: item.existed ? "change" : "add",
      })
      await FileTime.read(input.ctx.sessionID, item.file)
      done.push(item)
    }
  } catch (err) {
    for (const item of done.reverse()) {
      if (item.existed) {
        await Filesystem.write(item.file, item.old).catch(() => undefined)
      } else {
        await rm(item.file, { force: true }).catch(() => undefined)
      }
      Bus.publish(File.Event.Edited, { file: item.file })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: item.file,
        event: item.existed ? "change" : "unlink",
      }).catch(() => undefined)
      if (item.existed) await FileTime.read(input.ctx.sessionID, item.file).catch(() => undefined)
    }
    throw err
  }

  const touched = input.plan.map((item) => item.file)
  const diagnostics: Record<string, LSPClient.Diagnostic[]> = {}
  let touches: LSP.TouchStatus[] = []

  let output = `Applied semantic rename across ${input.plan.length} file${input.plan.length === 1 ? "" : "s"}.`
  await withTouchedFiles(touched, async (next) => {
    touches = next
    const result = await LSP.diagnostics()
    Object.assign(diagnostics, result)
    output = appendTouchWarnings(output, touches)
    output = appendDiagnostics(output, result, touched)
    output = await appendCodeActions(output, result, touched)
  })

  const primary = input.plan.find((item) => Filesystem.normalizePath(item.file) === Filesystem.normalizePath(input.file)) ?? input.plan[0]

  return {
    filePath: primary.file,
    contentOld: primary.old,
    contentNew: primary.next,
    output: {
      title: `${path.relative(Instance.worktree, primary.file)}`,
      output,
      metadata: {
        diagnostics,
        lsp: {
          touches,
        },
        diff: input.plan.map((item) => item.diff).filter(Boolean).join("\n"),
        filediff: primary.filediff,
        files: input.plan.map((item) => ({
          path: item.file,
          filePath: item.file,
          patch: item.diff,
          additions: item.filediff.additions,
          deletions: item.filediff.deletions,
        })),
        semantic: {
          rename: true,
        },
      },
    },
  }
}

function diagnosticBlock(output: string, file: string, label: string, errors: LSPClient.Diagnostic[]) {
  const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
  const suffix =
    errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
  const msg =
    label === "this file"
      ? "LSP errors detected in this file, please fix:"
      : label === "other files"
        ? "LSP errors detected in other files:"
        : `LSP errors detected in ${label}, please fix:`
  return `${output.includes(msg) && label === "other files" ? "" : `\n\n${msg}`}\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
}

function actionTitle(value: unknown) {
  const item = record(value)
  const title = string(item.title)
  if (!title) return
  const kind = string(item.kind)
  return kind ? `${title} (${kind})` : title
}

function record(value: unknown): AnyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as AnyRecord
}

function string(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function ident(value: string) {
  return /^[A-Za-z_$][\w$]*$/.test(value)
}

function renameHit(content: string, find: string) {
  const pattern = new RegExp(`(?<![\\w$])${escape(find)}(?![\\w$])`, "g")
  const hits = [...content.matchAll(pattern)]
  if (hits.length !== 1) return
  const idx = hits[0]?.index
  if (idx === undefined) return
  const prefix = content.slice(0, idx)
  if (!ascii(prefix)) return
  const lines = prefix.split("\n")
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  }
}

function ascii(value: string) {
  return /^[\x00-\x7F]*$/.test(value)
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function workspacePlan(items: unknown[], sessionID: Tool.Context["sessionID"]) {
  const edit = items.map(record).find((item) => item.documentChanges || item.changes)
  if (!edit) return
  const docs = await workspaceDocs(edit, sessionID)
  if (!docs.length) return
  return docs
}

async function workspaceDocs(edit: AnyRecord, sessionID: Tool.Context["sessionID"]) {
  const groups = new Map<string, EditLike[]>()

  if (Array.isArray(edit.documentChanges)) {
    for (const item of edit.documentChanges.map(record)) {
      if (string(item.kind)) return []
      const textDocument = record(item.textDocument)
      const uri = string(textDocument.uri)
      const edits = Array.isArray(item.edits) ? item.edits.map(record) : []
      if (!uri || !edits.length) return []
      const file = Filesystem.normalizePath(fileURLToPath(uri))
      groups.set(file, [...(groups.get(file) ?? []), ...edits])
    }
  }

  const changes = record(edit.changes)
  for (const [uri, value] of Object.entries(changes)) {
    const edits = Array.isArray(value) ? value.map(record) : []
    if (!edits.length) continue
    const file = Filesystem.normalizePath(fileURLToPath(uri))
    groups.set(file, [...(groups.get(file) ?? []), ...edits])
  }

  const out: FilePlan[] = []
  for (const [file, edits] of groups.entries()) {
    const existed = await Filesystem.exists(file)
    const old = existed ? await Filesystem.readText(file) : ""
    if (existed) await FileTime.assert(sessionID, file)
    const next = applyTextEdits(old, edits)
    const diff = trim(file, old, next)
    out.push({
      file,
      existed,
      old,
      next,
      diff,
      filediff: filediff(file, old, next, diff),
    })
  }
  return out
}

function applyTextEdits(content: string, edits: EditLike[]) {
  const ranges = edits
    .map((item) => {
      const start = item.range?.start
      const end = item.range?.end
      if (
        typeof start?.line !== "number" ||
        typeof start.character !== "number" ||
        typeof end?.line !== "number" ||
        typeof end.character !== "number" ||
        typeof item.newText !== "string"
      ) {
        return
      }
      return {
        start: pos(content, start.line, start.character),
        end: pos(content, end.line, end.character),
        text: item.newText,
      }
    })
    .filter((item): item is { start: number; end: number; text: string } => !!item)
    .sort((a, b) => b.start - a.start || b.end - a.end)

  let next = content
  for (const item of ranges) next = `${next.slice(0, item.start)}${item.text}${next.slice(item.end)}`
  return next
}

function pos(content: string, line: number, character: number) {
  let offset = 0
  let row = 0
  while (row < line) {
    const idx = content.indexOf("\n", offset)
    if (idx === -1) return content.length
    offset = idx + 1
    row++
  }
  return Math.min(offset + character, content.length)
}

function trim(file: string, old: string, next: string) {
  return createTwoFilesPatch(file, file, old, next).trim()
}

function filediff(file: string, old: string, next: string, patch: string): Snapshot.FileDiff {
  return {
    file,
    patch,
    additions: diffLines(old, next).reduce((total, change) => total + (change.added ? change.count || 0 : 0), 0),
    deletions: diffLines(old, next).reduce((total, change) => total + (change.removed ? change.count || 0 : 0), 0),
  }
}
