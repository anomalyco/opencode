import { Database } from "bun:sqlite"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Filesystem } from "@/util"
import type { EditorSelection } from "./editor"

const ZedEditorRowSchema = z.object({
  editor_id: z.number(),
  workspace_id: z.number(),
  workspace_paths: z.string().nullable(),
  timestamp: z.string(),
  buffer_path: z.string().nullable(),
  selection_start: z.number().nullable(),
  selection_end: z.number().nullable(),
})

const ZedEditorContentsSchema = z.object({
  contents: z.string().nullable(),
})

type ZedEditorRow = z.infer<typeof ZedEditorRowSchema>

export async function resolveZedSelection(dbPath: string): Promise<EditorSelection | undefined> {
  const row = queryZedActiveEditor(dbPath, process.cwd())
  if (!row?.buffer_path || row.selection_start == null || row.selection_end == null) return

  const text =
    queryZedEditorContents(dbPath, row) ??
    (await Bun.file(row.buffer_path)
      .text()
      .catch(() => undefined))
  if (text == null) return

  const startOffset = Math.min(row.selection_start, row.selection_end)
  const endOffset = Math.max(row.selection_start, row.selection_end)

  return {
    text: text.slice(startOffset, endOffset),
    filePath: row.buffer_path,
    selection: offsetsToSelection(text, startOffset, endOffset),
  }
}

function queryZedActiveEditor(dbPath: string, cwd: string) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    return db
      .query(
        `select
          e.item_id as editor_id,
          e.workspace_id as workspace_id,
          w.paths as workspace_paths,
          w.timestamp as timestamp,
          e.buffer_path as buffer_path,
          s.start as selection_start,
          s.end as selection_end
        from items i
        join panes p on p.pane_id = i.pane_id and p.workspace_id = i.workspace_id
        join workspaces w on w.workspace_id = i.workspace_id
        join editors e on e.item_id = i.item_id and e.workspace_id = i.workspace_id
        left join editor_selections s on s.editor_id = e.item_id and s.workspace_id = e.workspace_id
        where i.active = 1 and p.active = 1 and i.kind = 'Editor' and e.buffer_path is not null
        order by w.timestamp desc`,
      )
      .all()
      .flatMap((row) => {
        const parsed = ZedEditorRowSchema.safeParse(row)
        return parsed.success ? [parsed.data] : []
      })
      .map((row) => ({ row, score: scoreZedWorkspace(row.workspace_paths, cwd) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || right.row.timestamp.localeCompare(left.row.timestamp))[0]?.row
  } catch {
    return
  } finally {
    db?.close()
  }
}

function queryZedEditorContents(dbPath: string, row: ZedEditorRow) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    return ZedEditorContentsSchema.safeParse(
      db
        .query(
          `select contents
        from editors
        where item_id = $editorID and workspace_id = $workspaceID`,
        )
        .get({ $editorID: row.editor_id, $workspaceID: row.workspace_id }),
    ).data?.contents
  } catch {
    return
  } finally {
    db?.close()
  }
}

export function resolveZedDbPath() {
  const candidates = [
    process.env.OPENCODE_ZED_DB,
    path.join(os.homedir(), "Library", "Application Support", "Zed", "db", "0-stable", "db.sqlite"),
    path.join(os.homedir(), ".local", "share", "zed", "db", "0-stable", "db.sqlite"),
  ].filter((item): item is string => Boolean(item))

  return candidates.find((item) => Filesystem.stat(item)?.isFile())
}

function scoreZedWorkspace(workspacePaths: string | null, cwd: string) {
  return zedWorkspacePaths(workspacePaths).reduce((score, item) => {
    if (pathContains(item, cwd)) return Math.max(score, 2)
    if (pathContains(cwd, item)) return Math.max(score, 1)
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
  return offsetsToSelection(text, offset, offset).start
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
