export * as Question from "./question"

import { Schema } from "effect"
import { optional } from "./schema"
import { define, inventory } from "./event"
import { ascending } from "./identifier"
import { SessionID } from "./session-id"
import { statics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("que")).pipe(
  Schema.brand("QuestionV2.ID"),
  statics((schema) => {
    const create = () => schema.make("que_" + ascending())
    return {
      create,
      ascending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type ID = typeof ID.Type

export const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
  preview: Schema.String.pipe(optional).annotate({
    description: "Plain monospace content shown beside this option (single-select only)",
  }),
}).annotate({ identifier: "QuestionV2.Option" })
export interface Option extends Schema.Schema.Type<typeof Option> {}

// Preview handling.
//
// A preview is plain monospace text rendered verbatim in fixed-width contexts
// (TUI panes, <pre> blocks), so model-supplied values are stripped of markdown
// fence markers, ANSI escapes and control characters before they leave the tool
// boundary. Oversized input is truncated with a visible marker rather than
// rejected: a preview is a display affordance and must never fail the call.

export const PREVIEW_MAX_LENGTH = 2000
export const PREVIEW_TRUNCATED = "… (preview truncated)"

const ESC = String.fromCharCode(27)
const FENCE = /^\s*(?:`{3,}|~{3,}).*$/
// CSI sequences (colors, cursor moves) plus the shorter two-character escapes.
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}[@-Z\\\\-_]`, "g")

// Tabs become spaces so column math is stable in fixed-width panes; every other
// non-printable character is dropped. Newlines are split off before this runs.
function printable(line: string) {
  let out = ""
  for (const char of line) {
    const code = char.codePointAt(0)!
    if (code === 9) {
      out += "  "
      continue
    }
    if (code < 0x20 || code === 0x7f) continue
    out += char
  }
  return out
}

/**
 * Returns display-ready preview text, or undefined when there is nothing to
 * show. An option whose preview normalizes to undefined behaves exactly as an
 * option that never carried one.
 */
export function normalizePreview(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined

  const lines = value
    .replace(/\r\n?/g, "\n")
    .replace(ANSI, "")
    .split("\n")
    .filter((line) => !FENCE.test(line))
    .map((line) => printable(line).trimEnd())

  while (lines.length > 0 && lines[0].length === 0) lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].length === 0) lines.pop()

  const text = lines.join("\n")
  if (text.length === 0) return undefined
  if (text.length <= PREVIEW_MAX_LENGTH) return text

  return text.slice(0, PREVIEW_MAX_LENGTH).trimEnd() + "\n" + PREVIEW_TRUNCATED
}

// Preview pane geometry. Every bound is derived from the viewport, never from
// the preview itself, so the prompt cannot grow with its content and the option
// list never reflows as the selection moves (see issue #11367).
export const PREVIEW_MIN_TERM_WIDTH = 80
export const PREVIEW_MIN_ROWS = 4
export const PREVIEW_MAX_ROWS = 12
export const PREVIEW_MIN_PANE = 24
export const PREVIEW_MAX_LIST = 48

export type PreviewLayout = {
  twoPane: boolean
  listWidth: number
  previewWidth: number
  rows: number
}

/**
 * Decides the prompt layout from the terminal size alone. The two-pane layout
 * engages only when an option actually carries a preview and both columns can
 * be given usable width; otherwise the caller keeps its single-column layout.
 *
 * `chrome` is the columns the surrounding prompt spends on borders and padding.
 */
export function previewLayout(input: {
  width: number
  height: number
  previewed: boolean
  chrome?: number
}): PreviewLayout {
  const content = Math.max(0, input.width - (input.chrome ?? 6))
  const rows = Math.max(PREVIEW_MIN_ROWS, Math.min(PREVIEW_MAX_ROWS, Math.floor(input.height / 3)))
  const twoPane = input.previewed && input.width >= PREVIEW_MIN_TERM_WIDTH && content >= PREVIEW_MIN_PANE * 2 + 4
  const listWidth = Math.max(PREVIEW_MIN_PANE, Math.min(PREVIEW_MAX_LIST, Math.floor(content * 0.42)))
  // A pane spends 2 columns on its own border and padding; two-pane also has a
  // 2-column gap between the columns.
  const previewWidth = twoPane
    ? Math.max(PREVIEW_MIN_PANE, content - listWidth - 4)
    : Math.max(PREVIEW_MIN_PANE, content - 2)

  return { twoPane, listWidth, previewWidth, rows }
}

/**
 * Lays normalized preview text out for a fixed-width pane: at most `rows` rows,
 * each at most `width` columns. Both bounds come from the viewport, so the pane
 * never grows with its content — long lines are clipped rather than wrapped, and
 * the overflow row reports how much was hidden.
 */
export function previewLines(text: string, width: number, rows: number): string[] {
  const clip = (line: string) => (line.length <= width ? line : line.slice(0, Math.max(0, width - 1)) + "›")
  const all = text.split("\n")
  if (all.length <= rows) return all.map(clip)

  // Reserving a row for the notice always hides at least two lines, so the
  // count is never singular.
  const shown = all.slice(0, Math.max(0, rows - 1)).map(clip)
  shown.push(clip(`… ${all.length - shown.length} more lines`))
  return shown
}

/**
 * Strips previews the surfaces must ignore and normalizes the rest. Previews are
 * only meaningful for single-select questions, where exactly one option is
 * focused at a time; for `multiple` questions they are dropped at the source so
 * no renderer has to decide.
 */
export function normalizeOptions<T extends { readonly preview?: string | undefined }>(
  options: ReadonlyArray<T>,
  multiple: boolean | undefined,
): ReadonlyArray<T> {
  let changed = false
  const next = options.map((option) => {
    const preview = multiple === true ? undefined : normalizePreview(option.preview)
    if (preview === option.preview) return option
    changed = true
    const { preview: _dropped, ...rest } = option
    return (preview === undefined ? rest : { ...rest, preview }) as T
  })
  return changed ? next : options
}

const base = {
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  options: Schema.Array(Option).annotate({ description: "Available choices" }),
  multiple: Schema.Boolean.pipe(optional).annotate({ description: "Allow selecting multiple choices" }),
}

export const Info = Schema.Struct({
  ...base,
  custom: Schema.Boolean.pipe(optional).annotate({
    description: "Allow typing a custom answer (default: true)",
  }),
}).annotate({ identifier: "QuestionV2.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Prompt = Schema.Struct(base).annotate({ identifier: "QuestionV2.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}

export const Tool = Schema.Struct({
  messageID: Schema.String,
  callID: Schema.String,
}).annotate({ identifier: "QuestionV2.Tool" })
export interface Tool extends Schema.Schema.Type<typeof Tool> {}

export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  questions: Schema.Array(Info).annotate({ description: "Questions to ask" }),
  tool: Tool.pipe(optional),
}).annotate({ identifier: "QuestionV2.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "QuestionV2.Answer" })
export type Answer = typeof Answer.Type

export const Reply = Schema.Struct({
  answers: Schema.Array(Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}).annotate({ identifier: "QuestionV2.Reply" })
export interface Reply extends Schema.Schema.Type<typeof Reply> {}

const Asked = define({ type: "question.v2.asked", schema: Request.fields })
const Replied = define({
  type: "question.v2.replied",
  schema: {
    sessionID: SessionID,
    requestID: ID,
    answers: Schema.Array(Answer),
  },
})
const Rejected = define({
  type: "question.v2.rejected",
  schema: {
    sessionID: SessionID,
    requestID: ID,
  },
})
export const Event = { Asked, Replied, Rejected, Definitions: inventory(Asked, Replied, Rejected) }
