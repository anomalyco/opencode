import { Database } from "bun:sqlite"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import type { EditorSelection } from "./editor"

const ZedEditorRowSchema = z.object({
  item_kind: z.string(),
  editor_id: z.number().nullable(),
  workspace_id: z.number(),
  workspace_paths: z.string().nullable(),
  timestamp: z.string(),
  buffer_path: z.string().nullable(),
})

const ZedSelectionRowSchema = z.object({
  selection_start: z.number().nullable(),
  selection_end: z.number().nullable(),
})

const ZedEditorContentsSchema = z.object({
  contents: z.string().nullable(),
})

const utf8 = new TextEncoder()

type ZedEditorRow = z.infer<typeof ZedEditorRowSchema>
type ZedActiveEditorRow = ZedEditorRow & { item_kind: "Editor"; editor_id: number }
type ZedSelectionRow = z.infer<typeof ZedSelectionRowSchema>

export type ZedSelectionResult =
  | { type: "selection"; selection: EditorSelection }
  | { type: "empty" }
  | { type: "unavailable" }

export async function resolveZedSelection(dbPath: string, cwd = process.cwd()): Promise<ZedSelectionResult> {
  const active = queryZedActiveEditor(dbPath, cwd)
  if (active.type !== "row") return active

  const row = active.row
  if (!row.buffer_path) return { type: "empty" }

  const selections = queryZedEditorSelections(dbPath, row)
  if (selections.type !== "selections") return selections
  const byteRanges = selections.selections
    .flatMap((selection) => {
      if (selection.selection_start == null || selection.selection_end == null) return []
      return [
        {
          start: Math.min(selection.selection_start, selection.selection_end),
          end: Math.max(selection.selection_start, selection.selection_end),
        },
      ]
    })
    .sort((left, right) => left.start - right.start || left.end - right.end)
  if (byteRanges.length === 0) return { type: "unavailable" }

  const contents = queryZedEditorContents(dbPath, row)
  const text =
    contents.type === "contents" && contents.contents != null
      ? contents.contents
      : await Bun.file(row.buffer_path)
          .text()
          .catch(() => undefined)
  if (text == null) return { type: "unavailable" }

  const ranges = byteRanges.map((range) => {
    const startOffset = utf8ByteOffsetToStringIndex(text, range.start)
    const endOffset = utf8ByteOffsetToStringIndex(text, range.end)
    return {
      text: text.slice(startOffset, endOffset),
      selection: offsetsToSelection(text, startOffset, endOffset),
    }
  })

  return {
    type: "selection",
    selection: {
      filePath: row.buffer_path,
      source: "zed",
      ranges,
    },
  }
}

function queryZedActiveEditor(dbPath: string, cwd: string) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    const raw = db
      .query(
        `select
          i.kind as item_kind,
          e.item_id as editor_id,
          i.workspace_id as workspace_id,
          w.paths as workspace_paths,
          w.timestamp as timestamp,
          e.buffer_path as buffer_path
        from items i
        join panes p on p.pane_id = i.pane_id and p.workspace_id = i.workspace_id
        join workspaces w on w.workspace_id = i.workspace_id
        left join editors e on e.item_id = i.item_id and e.workspace_id = i.workspace_id
        where i.active = 1 and p.active = 1
        order by w.timestamp desc`,
      )
      .all()

    const rows = raw.flatMap((row) => {
      const parsed = ZedEditorRowSchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })

    if (raw.length > 0 && rows.length === 0) return { type: "unavailable" as const }

    const row = rows
      .map((row) => ({ row, score: scoreZedWorkspace(row.workspace_paths, cwd) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || right.row.timestamp.localeCompare(left.row.timestamp))[0]?.row
    if (!row) return { type: "empty" as const }
    if (row.item_kind !== "Editor") return { type: "unavailable" as const }
    if (!isZedActiveEditorRow(row)) return { type: "empty" as const }
    return { type: "row" as const, row }
  } catch {
    return { type: "unavailable" as const }
  } finally {
    db?.close()
  }
}

function queryZedEditorSelections(dbPath: string, row: ZedActiveEditorRow) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    const raw = db
      .query(
        `select
          start as selection_start,
          end as selection_end
        from editor_selections
        where editor_id = $editorID and workspace_id = $workspaceID`,
      )
      .all({ $editorID: row.editor_id, $workspaceID: row.workspace_id })

    const selections = raw.flatMap((selection) => {
      const parsed = ZedSelectionRowSchema.safeParse(selection)
      return parsed.success ? [parsed.data] : []
    })

    if (raw.length > 0 && selections.length === 0) return { type: "unavailable" as const }
    return { type: "selections" as const, selections }
  } catch {
    return { type: "unavailable" as const }
  } finally {
    db?.close()
  }
}

function queryZedEditorContents(dbPath: string, row: ZedActiveEditorRow) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    const parsed = ZedEditorContentsSchema.safeParse(
      db
        .query(
          `select contents
        from editors
        where item_id = $editorID and workspace_id = $workspaceID`,
        )
        .get({ $editorID: row.editor_id, $workspaceID: row.workspace_id }),
    )
    if (!parsed.success) return { type: "unavailable" as const }
    return { type: "contents" as const, contents: parsed.data.contents }
  } catch {
    return { type: "unavailable" as const }
  } finally {
    db?.close()
  }
}

function isZedActiveEditorRow(row: ZedEditorRow): row is ZedActiveEditorRow {
  return row.item_kind === "Editor" && row.editor_id != null
}

export function resolveZedDbPath() {
  const candidates = [
    process.env.OPENCODE_ZED_DB,
    path.join(os.homedir(), "Library", "Application Support", "Zed", "db", "0-stable", "db.sqlite"),
    path.join(os.homedir(), ".local", "share", "zed", "db", "0-stable", "db.sqlite"),
  ].filter((item): item is string => Boolean(item))

  return candidates.find((item) => isFile(item))
}

function isFile(item: string) {
  try {
    return Filesystem.stat(item)?.isFile() === true
  } catch {
    return false
  }
}

function scoreZedWorkspace(workspacePaths: string | null, cwd: string) {
  return zedWorkspacePaths(workspacePaths).reduce((score, item) => {
    if (pathContains(item, cwd)) return Math.max(score, path.resolve(item).length)
    return score
  }, 0)
}

function zedWorkspacePaths(value: string | null) {
  if (!value) return []
  const parsed = parseJson(value)
  if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string")
  return value.split(/\r?\n/).filter(Boolean)
}

export function offsetToPosition(text: string, offset: number) {
  const stringOffset = utf8ByteOffsetToStringIndex(text, offset)
  return offsetsToSelection(text, stringOffset, stringOffset).start
}

function utf8ByteOffsetToStringIndex(text: string, byteOffset: number) {
  if (byteOffset <= 0) return 0

  let bytes = 0
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) return text.length

    const nextIndex = index + (codePoint > 0xffff ? 2 : 1)
    bytes += utf8.encode(text.slice(index, nextIndex)).length
    if (bytes >= byteOffset) return nextIndex
    index = nextIndex
  }

  return text.length
}

function offsetsToSelection(text: string, startOffset: number, endOffset: number) {
  const start = Math.max(0, Math.min(startOffset, text.length))
  const end = Math.max(0, Math.min(endOffset, text.length))
  let line = 1
  let lineStart = 0
  let startPosition = position(line, lineStart, start)
  let endPosition = position(line, lineStart, end)

  for (let index = 0; index <= end; index++) {
    if (index === start) startPosition = position(line, lineStart, index)
    if (index === end) {
      endPosition = position(line, lineStart, index)
      break
    }
    if (text[index] === "\n") {
      line += 1
      lineStart = index + 1
    }
  }

  return { start: startPosition, end: endPosition }
}

function position(line: number, lineStart: number, offset: number) {
  return {
    line,
    character: offset - lineStart + 1,
  }
}

function pathContains(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return
  }
}
