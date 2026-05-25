import type { FileSelection } from "@/context/file"

export type PromptComment = {
  path: string
  selection?: FileSelection
  comment: string
  preview?: string
  origin?: "review" | "file" | "quote"
  // FORK: quote 子分类 — "chat" = 聊天引用走 LLM 模板分流;"file" / undefined = 文件引用
  // [feat: 聊天选区-卡片化-换行] 2026-05-25
  kind?: "chat" | "file"
}

function selection(selection: unknown) {
  if (!selection || typeof selection !== "object") return undefined
  const startLine = Number((selection as FileSelection).startLine)
  const startChar = Number((selection as FileSelection).startChar)
  const endLine = Number((selection as FileSelection).endLine)
  const endChar = Number((selection as FileSelection).endChar)
  if (![startLine, startChar, endLine, endChar].every(Number.isFinite)) return undefined
  return {
    startLine,
    startChar,
    endLine,
    endChar,
  } satisfies FileSelection
}

export function createCommentMetadata(input: PromptComment) {
  return {
    opencodeComment: {
      path: input.path,
      selection: input.selection,
      comment: input.comment,
      preview: input.preview,
      origin: input.origin,
      kind: input.kind,
    },
  }
}

export function readCommentMetadata(value: unknown) {
  if (!value || typeof value !== "object") return
  const meta = (value as { opencodeComment?: unknown }).opencodeComment
  if (!meta || typeof meta !== "object") return
  const path = (meta as { path?: unknown }).path
  const comment = (meta as { comment?: unknown }).comment
  if (typeof path !== "string" || typeof comment !== "string") return
  const preview = (meta as { preview?: unknown }).preview
  const origin = (meta as { origin?: unknown }).origin
  const kind = (meta as { kind?: unknown }).kind
  return {
    path,
    selection: selection((meta as { selection?: unknown }).selection),
    comment,
    preview: typeof preview === "string" ? preview : undefined,
    origin: origin === "review" || origin === "file" || origin === "quote" ? origin : undefined,
    kind: kind === "chat" || kind === "file" ? kind : undefined,
  } satisfies PromptComment
}

export function formatCommentNote(input: {
  path: string
  selection?: FileSelection
  comment: string
  preview?: string
  kind?: "chat" | "file"
}) {
  // FORK: kind="chat" 走聊天引用模板,让 LLM 明白引文来自同一对话历史(继承上下文)
  // [feat: 聊天选区-卡片化-换行] 2026-05-25
  if (input.kind === "chat") {
    const preview = input.preview?.trim()
    const quoteSection = preview
      ? `The user is quoting text from earlier in this conversation:\n"""\n${preview}\n"""\n\n`
      : ""
    return `${quoteSection}Their follow-up question/comment: ${input.comment}`
  }

  const start = input.selection ? Math.min(input.selection.startLine, input.selection.endLine) : undefined
  const end = input.selection ? Math.max(input.selection.startLine, input.selection.endLine) : undefined
  const range =
    start === undefined || end === undefined
      ? "this file"
      : start === end
        ? `line ${start}`
        : `lines ${start} through ${end}`
  const head = `The user made the following comment regarding ${range} of ${input.path}: ${input.comment}`
  const preview = input.preview?.trim()
  if (!preview) return head
  return `${head}\n\nSelected text:\n"""\n${preview}\n"""`
}

export function parseCommentNote(text: string) {
  const match = text.match(
    /^The user made the following comment regarding (this file|line (\d+)|lines (\d+) through (\d+)) of (.+?): ([\s\S]+?)(?:\n\nSelected text:\n"""\n[\s\S]*?\n""")?$/,
  )
  if (!match) return
  const start = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) : undefined
  const end = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : undefined
  return {
    path: match[5],
    selection:
      start !== undefined && end !== undefined
        ? {
            startLine: start,
            startChar: 0,
            endLine: end,
            endChar: 0,
          }
        : undefined,
    comment: match[6],
  } satisfies PromptComment
}
