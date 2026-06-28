import { fileURLToPath } from "url"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"

type Pos = { line: number; character: number }
type TextEdit = { range: { start: Pos; end: Pos }; newText: string }

/** Minimal publisher shape (compatible with EventV2Bridge.Service). */
type EventPublisher = { publish: (event: any, data: any) => Effect.Effect<unknown, never, never> }

function computeLineStarts(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1)
  }
  return starts
}

function offsetAt(starts: number[], pos: Pos, length: number): number {
  const base = pos.line >= 0 && pos.line < starts.length ? starts[pos.line] : length
  return Math.max(0, Math.min(base + Math.max(0, pos.character), length))
}

function applyEdits(content: string, edits: TextEdit[]): string {
  const starts = computeLineStarts(content)
  const resolved = edits
    .map((edit) => ({
      start: offsetAt(starts, edit.range.start, content.length),
      end: offsetAt(starts, edit.range.end, content.length),
      newText: edit.newText ?? "",
    }))
    // Apply from the end backwards so earlier offsets stay valid.
    .sort((a, b) => b.start - a.start || b.end - a.end)

  let result = content
  for (const edit of resolved) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end)
  }
  return result
}

/**
 * Collect the per-file edits from an LSP WorkspaceEdit (both `changes` and
 * `documentChanges` shapes).
 */
function collect(edit: unknown): Map<string, TextEdit[]> {
  const out = new Map<string, TextEdit[]>()
  if (!edit || typeof edit !== "object") return out
  const we = edit as {
    changes?: Record<string, TextEdit[]>
    documentChanges?: Array<{ textDocument?: { uri?: string }; edits?: TextEdit[] }>
  }
  if (we.changes) {
    for (const [uri, edits] of Object.entries(we.changes)) {
      if (Array.isArray(edits)) out.set(uri, [...(out.get(uri) ?? []), ...edits])
    }
  }
  if (Array.isArray(we.documentChanges)) {
    for (const dc of we.documentChanges) {
      const uri = dc?.textDocument?.uri
      if (uri && Array.isArray(dc.edits)) out.set(uri, [...(out.get(uri) ?? []), ...dc.edits])
    }
  }
  return out
}

/**
 * Apply an LSP WorkspaceEdit to disk via FSUtil and emit file-change events.
 * Returns the list of changed absolute file paths.
 */
export const applyWorkspaceEdit = Effect.fn("Tool.applyWorkspaceEdit")(function* (
  edit: unknown,
  fs: FSUtil.Interface,
  events: EventPublisher,
) {
  const fileEdits = collect(edit)
  const changed: string[] = []
  for (const [uri, edits] of fileEdits) {
    if (edits.length === 0) continue
    const file = (() => {
      try {
        return fileURLToPath(uri)
      } catch {
        return undefined
      }
    })()
    if (!file) continue
    const content = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (content === undefined) continue
    const next = applyEdits(content, edits)
    if (next === content) continue
    yield* fs.writeWithDirs(file, next).pipe(Effect.orDie)
    yield* events.publish(FileSystem.Event.Edited, { file })
    yield* events.publish(Watcher.Event.Updated, { file, event: "change" })
    changed.push(file)
  }
  return changed
})
