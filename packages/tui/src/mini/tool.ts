// Per-tool display rules shared across `opencode run` output paths.
//
// Each known tool (shell, edit, write, subagent, etc.) has a ToolRule that controls
// four display hooks:
//
//   view       → visibility policy for progress/final scrollback entries and
//                whether completed finals can render as structured snapshots
//   run        → inline summary for the non-interactive `run` command output
//   scroll     → text formatting for start/progress/final scrollback entries
//   snap       → structured snapshot (code block, diff, task card) for rich
//                scrollback entries
//
// Tools not in TOOL_RULES get fallback formatting.
import os from "os"
import path from "path"
import stripAnsi from "strip-ansi"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { LANGUAGE_EXTENSIONS } from "../util/filetype"
import { Locale } from "../util/locale"
import {
  canonicalToolName,
  finiteNumber,
  primitiveInputSummary,
  toolDisplayContent,
  toolDisplayMetadata,
  webSearchProviderName,
} from "../util/tool-display"
import { formatPath } from "../util/path-format"
import { isRecord } from "../util/record"
import type { RunEntryBody, StreamCommit, ToolSnapshot } from "./types"
import { defaultMiniLanguage, type MiniLanguage } from "./language"

export { canonicalToolName } from "../util/tool-display"

type ToolView = {
  output: boolean
  final: boolean
  snap?: "code" | "diff" | "structured"
}

type ToolPhase = "start" | "progress" | "final"

type ToolDict = Record<string, unknown>

type PatchFile = {
  status?: string
  file?: string
  from?: string
  patch?: string
  deletions?: number
}

type ToolInput = ToolDict & {
  id?: string
  path?: string
  pattern?: string
  url?: string
  query?: string
  agent?: string
  description?: string
  name?: string
  operation?: string
  line?: number
  character?: number
  content?: string
  command?: string
  workdir?: string
  questions?: Array<{ question?: string }>
  diff?: string
}

type ToolMetadata = ToolDict & {
  name?: string
  count?: number
  matches?: number
  diff?: string
  provider?: unknown
  files?: PatchFile[]
  answers?: string[][]
  exit?: number
}

type ToolFrame = {
  language?: MiniLanguage
  directory?: string
  raw: string
  name: string
  input: ToolDict
  meta: ToolDict
  state: ToolDict
  status: string
  error: string
  output: string
  time: {
    start?: number
    end?: number
  }
}

type ToolInline = {
  icon: string
  title: string
  description?: string
  mode?: "inline" | "block"
  body?: string
}

type ToolProps = {
  language: MiniLanguage
  input: ToolInput
  metadata: ToolMetadata
  frame: ToolFrame
}

type ToolName =
  | "invalid"
  | "shell"
  | "write"
  | "edit"
  | "patch"
  | "batch"
  | "subagent"
  | "question"
  | "read"
  | "glob"
  | "grep"
  | "list"
  | "lsp"
  | "webfetch"
  | "websearch"
  | "skill"

type ToolRule = {
  view: ToolView
  run: (props: ToolProps) => ToolInline
  scroll?: Partial<Record<ToolPhase, (props: ToolProps) => string>>
  snap?: (props: ToolProps) => ToolSnapshot | undefined
}

type ToolRegistry = Record<ToolName, ToolRule>

type AnyToolRule = ToolRule

function dict(v: unknown): ToolDict {
  return isRecord(v) ? { ...v } : {}
}

function props(frame: ToolFrame): ToolProps {
  return {
    language: frame.language ?? defaultMiniLanguage,
    input: frame.input,
    metadata: frame.meta,
    frame,
  }
}

function text(v: unknown): string {
  return typeof v === "string" ? v : ""
}

export function toolOutputText(name: string, content: ReadonlyArray<{ type: string; text?: string }> | undefined) {
  if (!content) return ""
  // V2 shell content appends model-only status after the user-visible command output.
  if (canonicalToolName(name) === "shell") return content.find((item) => item.type === "text")?.text ?? ""
  const joined = content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n")
  if (canonicalToolName(name) === "read") return readDisplayText(joined) ?? joined
  return joined
}

/** Read's model content is a JSON page envelope; unwrap the human-facing text. */
export function readDisplayText(text: string): string | undefined {
  if (!text.startsWith("{")) return undefined
  const parsed = (() => {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  })()
  const envelope = dict(parsed)
  if (typeof envelope.content === "string" && (envelope.type === "text-page" || envelope.encoding === "utf8"))
    return envelope.content
  if (!Array.isArray(envelope.entries)) return undefined
  return envelope.entries
    .flatMap((entry): string[] => {
      if (typeof entry === "string") return [entry]
      const path = dict(entry).path
      return typeof path === "string" ? [path] : []
    })
    .join("\n")
}

function normalizeInput(name: string, value: unknown) {
  const input = dict(value)
  const path = typeof input.path === "string" ? input.path : text(input.filePath)
  const agent = typeof input.agent === "string" ? input.agent : text(input.subagent_type)
  return {
    ...input,
    ...(["read", "write", "edit", "lsp"].includes(name) && path ? { path } : {}),
    ...(name === "subagent" && agent ? { agent } : {}),
  }
}

function normalizeFile(value: unknown): PatchFile | undefined {
  const file = dict(value)
  const name = text(file.file) || text(file.relativePath) || text(file.filePath)
  if (!name) return
  const legacy = text(file.type)
  const status =
    text(file.status) ||
    (legacy === "add"
      ? "added"
      : legacy === "delete"
        ? "deleted"
        : legacy === "update"
          ? "modified"
          : legacy === "move"
            ? "moved"
            : legacy)
  const patch = typeof file.patch === "string" ? file.patch : undefined
  const deletions = finiteNumber(file.deletions)
  return {
    ...file,
    file: name,
    ...(status === "moved" && text(file.filePath) ? { from: text(file.filePath) } : {}),
    ...(status ? { status } : {}),
    ...(patch === undefined ? {} : { patch }),
    ...(deletions === undefined ? {} : { deletions }),
  }
}

function normalizeMetadata(name: string, value: unknown) {
  const metadata = dict(value)
  const files = list(metadata.files).flatMap((item) => {
    const file = normalizeFile(item)
    return file ? [file] : []
  })
  const sessionID = text(metadata.sessionID) || text(metadata.sessionId)
  return {
    ...metadata,
    ...(["edit", "patch"].includes(name) && Array.isArray(metadata.files) ? { files } : {}),
    ...(name === "subagent" && sessionID ? { sessionID } : {}),
  }
}

export function normalizeTool(tool: SessionMessageAssistantTool): SessionMessageAssistantTool {
  const name = canonicalToolName(tool.name)
  if (tool.state.status === "streaming") return { ...tool, name }
  return {
    ...tool,
    name,
    state: {
      ...tool.state,
      input: normalizeInput(name, tool.state.input),
      metadata: normalizeMetadata(name, toolDisplayMetadata(tool.state)),
    },
  } as SessionMessageAssistantTool
}

function list<T>(v: unknown): T[] {
  if (!Array.isArray(v)) {
    return []
  }

  return v
}

function span(frame: ToolFrame): string {
  const start = frame.time.start
  const end = frame.time.end
  if (start === undefined || end === undefined || end <= start) {
    return ""
  }

  return (frame.language ?? defaultMiniLanguage).duration(end - start)
}

function fail(ctx: ToolFrame): string {
  const error = toolError(ctx)
  if (error) {
    return `✖ ${(ctx.language ?? defaultMiniLanguage).t("tui.mini.tool.failedWithError", { tool: ctx.name, error })}`
  }

  return `✖ ${(ctx.language ?? defaultMiniLanguage).t("tui.mini.tool.failed", { tool: ctx.name })}`
}

function toolError(ctx: ToolFrame): string {
  if (ctx.error) {
    return ctx.error
  }

  const state = text(ctx.state.error).trim()
  if (state) {
    return state
  }

  return ctx.raw.trim()
}

function fallbackStart(ctx: ToolFrame): string {
  const extra = primitiveInputSummary(ctx.input)
  if (!extra) {
    return `⚙ ${ctx.name}`
  }

  return `⚙ ${ctx.name} ${extra}`
}

function fallbackFinal(ctx: ToolFrame): string {
  if (ctx.status === "error") {
    return fail(ctx)
  }

  if (ctx.status && ctx.status !== "completed") {
    return ctx.raw.trim()
  }

  const time = span(ctx)
  if (!time) {
    return (ctx.language ?? defaultMiniLanguage).t("tui.mini.tool.completed", { tool: ctx.name })
  }

  return `${(ctx.language ?? defaultMiniLanguage).t("tui.mini.tool.completed", { tool: ctx.name })} · ${time}`
}

export function toolPath(input?: string, opts: { home?: boolean; directory?: string } = {}): string {
  return formatPath(input, {
    base: opts.directory ?? process.cwd(),
    home: opts.home ? os.homedir() : undefined,
    forwardSlashes: true,
  })
}

function displayPath(p: ToolProps, input?: string, opts: { home?: boolean } = {}) {
  return toolPath(input, { ...opts, directory: p.frame.directory })
}

function fallbackInline(ctx: ToolFrame): ToolInline {
  const title =
    Object.keys(ctx.input).length > 0
      ? JSON.stringify(ctx.input)
      : (ctx.language ?? defaultMiniLanguage).t("tui.mini.tool.unknown")

  return {
    icon: "⚙",
    title: `${ctx.name} ${title}`,
  }
}

function runGlob(p: ToolProps): ToolInline {
  const root = p.input.path ?? ""
  const title = p.language.t("tui.mini.tool.glob", { pattern: p.input.pattern ?? "" })
  const suffix = root ? p.language.t("tui.mini.tool.inPath", { path: displayPath(p, root) }) : ""
  const matches = p.metadata.count
  const description =
    matches === undefined
      ? suffix
      : `${suffix}${suffix ? " · " : ""}${p.language.plural("tui.mini.tool.matches", matches)}`
  return {
    icon: "✱",
    title,
    ...(description && { description }),
  }
}

function runGrep(p: ToolProps): ToolInline {
  const root = p.input.path ?? ""
  const title = p.language.t("tui.mini.tool.grep", { pattern: p.input.pattern ?? "" })
  const suffix = root ? p.language.t("tui.mini.tool.inPath", { path: displayPath(p, root) }) : ""
  const matches = p.metadata.matches
  const description =
    matches === undefined
      ? suffix
      : `${suffix}${suffix ? " · " : ""}${p.language.plural("tui.mini.tool.matches", matches)}`
  return {
    icon: "✱",
    title,
    ...(description && { description }),
  }
}

function runList(p: ToolProps): ToolInline {
  const dir = text(dict(p.input).path)
  return {
    icon: "→",
    title: dir
      ? p.language.t("tui.mini.tool.listPath", { path: displayPath(p, dir) })
      : p.language.t("tui.mini.tool.list"),
  }
}

function runRead(p: ToolProps): ToolInline {
  const file = displayPath(p, p.input.path)
  const description = primitiveInputSummary(p.frame.input, ["path"]) || undefined
  return {
    icon: "→",
    title: p.language.t("tui.mini.tool.read", { path: file }),
    ...(description && { description }),
  }
}

function runWrite(p: ToolProps): ToolInline {
  return {
    icon: "←",
    title: p.language.t("tui.mini.tool.write", { path: displayPath(p, p.input.path) }),
    mode: "block",
    body: p.frame.status === "completed" ? p.frame.output : undefined,
  }
}

function runWebfetch(p: ToolProps): ToolInline {
  const url = p.input.url ?? ""
  return {
    icon: "%",
    title: url ? p.language.t("tui.mini.tool.webfetchUrl", { url }) : p.language.t("tui.mini.tool.webfetch"),
  }
}

function runEdit(p: ToolProps): ToolInline {
  const file = list<PatchFile>(p.metadata.files)[0]
  return {
    icon: "←",
    title: p.language.t("tui.mini.tool.edit", { path: displayPath(p, p.input.path) }),
    mode: "block",
    body: file?.patch ?? p.metadata.diff,
  }
}

function runWebSearch(p: ToolProps): ToolInline {
  const provider = webSearchProviderName(p.metadata.provider)
  const title = provider
    ? p.language.t("tui.mini.tool.webSearchProvider", { provider })
    : p.language.t("tui.mini.tool.webSearch")
  return {
    icon: "◈",
    title: p.input.query ? `${title} "${p.input.query}"` : title,
  }
}

function runTask(p: ToolProps): ToolInline {
  const kind = p.input.agent ? Locale.titlecase(p.input.agent) : p.language.t("tui.mini.tool.unknown")
  const desc = p.input.description
  const icon = p.frame.status === "error" ? "✗" : p.frame.status === "running" ? "•" : "✓"
  return {
    icon,
    title: desc || p.language.t("tui.mini.tool.subagent", { agent: kind }),
    description: desc ? p.language.t("tui.mini.tool.agent", { agent: kind }) : undefined,
  }
}

function runSkill(p: ToolProps): ToolInline {
  const name = p.metadata.name ?? p.input.id ?? ""
  return {
    icon: "→",
    title: p.language.t("tui.mini.tool.skill", { name }),
  }
}

function runPatch(p: ToolProps): ToolInline {
  const files = p.metadata.files?.length ?? 0
  if (files === 0) {
    return {
      icon: "%",
      title: p.language.t("tui.mini.tool.patch"),
    }
  }

  return {
    icon: "%",
    title: p.language.plural("tui.mini.tool.patchFiles", files),
  }
}

function runQuestion(p: ToolProps): ToolInline {
  const total = list(p.frame.input.questions).length
  return {
    icon: "→",
    title: p.language.plural("tui.mini.tool.askedQuestions", total),
  }
}

function runInvalid(p: ToolProps): ToolInline {
  return {
    icon: "✗",
    title: p.language.t("tui.mini.tool.invalid"),
    mode: "block",
    body: p.frame.status === "completed" ? p.frame.output : undefined,
  }
}

function runBatch(p: ToolProps): ToolInline {
  const calls = list(dict(p.input).tool_calls).length
  return {
    icon: "#",
    title: calls > 0 ? p.language.plural("tui.mini.tool.batchTools", calls) : p.language.t("tui.mini.tool.batch"),
    mode: "block",
    body: p.frame.status === "completed" ? p.frame.output : undefined,
  }
}

function lspTitle(
  input: {
    operation?: string
    path?: string
    line?: number
    character?: number
  },
  opts: { home?: boolean; directory?: string; language?: MiniLanguage } = {},
): string {
  const op = input.operation || (opts.language ?? defaultMiniLanguage).t("tui.mini.tool.request")
  const file = input.path ? toolPath(input.path, opts) : ""
  const line = typeof input.line === "number" ? input.line : undefined
  const char = typeof input.character === "number" ? input.character : undefined
  const pos = line !== undefined && char !== undefined ? `:${line}:${char}` : ""
  if (!file) {
    return `LSP ${op}`
  }

  return `LSP ${op} ${file}${pos}`
}

function runLsp(p: ToolProps): ToolInline {
  return {
    icon: "→",
    title: lspTitle(p.input, { directory: p.frame.directory, language: p.language }),
  }
}

function patchTitle(file: PatchFile, directory: string | undefined, language: MiniLanguage): string {
  if (file.status === "added") {
    return `# ${language.t("tui.mini.tool.created", { path: toolPath(file.file, { directory }) })}`
  }
  if (file.status === "deleted") {
    return `# ${language.t("tui.mini.tool.deleted", { path: toolPath(file.file, { directory }) })}`
  }
  if (file.status === "moved") {
    return `# ${language.t("tui.mini.tool.moved", { from: toolPath(file.from, { directory }), to: toolPath(file.file, { directory }) })}`
  }

  return `# ${language.t("tui.mini.tool.patched", { path: toolPath(file.file, { directory }) })}`
}

function snapWrite(p: ToolProps): ToolSnapshot | undefined {
  const file = p.input.path || ""
  const content = p.input.content || ""
  if (!file && !content) {
    return undefined
  }

  return {
    kind: "code",
    title: `# ${p.language.t("tui.mini.tool.wrote", { path: displayPath(p, file) })}`,
    content,
    file,
  }
}

function snapEdit(p: ToolProps): ToolSnapshot | undefined {
  const item = list<PatchFile>(p.metadata.files)[0]
  const file = item?.file || p.input.path || ""
  const diff = item?.patch || p.metadata.diff || ""
  if (!file || !diff.trim()) {
    return undefined
  }

  return {
    kind: "diff",
    items: [
      {
        title: `# ${p.language.t("tui.mini.tool.edited", { path: displayPath(p, file) })}`,
        diff,
        file,
      },
    ],
  }
}

function snapPatch(p: ToolProps): ToolSnapshot | undefined {
  const files = list<PatchFile>(p.frame.meta.files)
  if (files.length === 0) {
    return undefined
  }

  const items = files.flatMap((file) => {
    if (!file || typeof file !== "object") {
      return []
    }

    const diff = typeof file.patch === "string" ? file.patch : ""
    if (!diff.trim()) {
      return []
    }

    const name = file.file
    return [
      {
        title: patchTitle(file, p.frame.directory, p.language),
        diff,
        file: name,
        deletions: typeof file.deletions === "number" ? file.deletions : 0,
      },
    ]
  })

  if (items.length !== files.length) {
    return undefined
  }

  return {
    kind: "diff",
    items,
  }
}

function snapTask(p: ToolProps): ToolSnapshot {
  const kind = p.input.agent ? Locale.titlecase(p.input.agent) : p.language.t("tui.mini.tool.general")
  const desc = p.input.description
  const rows = [desc].filter((item): item is string => Boolean(item))

  return {
    kind: "task",
    title: `# ${p.language.t("tui.mini.tool.subagent", { agent: kind })}`,
    rows,
    tail: "",
  }
}

function snapQuestion(p: ToolProps): ToolSnapshot {
  const answers = list<unknown[]>(p.frame.meta.answers)
  const items = list<{ question?: string }>(p.frame.input.questions).map((item, i) => {
    const answer = list<string>(answers[i]).filter((entry) => typeof entry === "string")
    return {
      question: item.question || p.language.t("tui.mini.tool.question", { number: i + 1 }),
      answer: answer.length > 0 ? answer.join(", ") : p.language.t("tui.mini.tool.noAnswer"),
    }
  })

  return {
    kind: "question",
    items,
    tail: "",
  }
}

function scrollBashStart(p: ToolProps): string {
  const cmd = p.input.command ?? ""
  const wd = p.input.workdir ?? ""
  const formatted = wd && wd !== "." ? displayPath(p, wd, { home: true }) : ""
  const dir = formatted === "." ? "" : formatted
  if (cmd && !dir) {
    return `$ ${cmd}`
  }

  if (!cmd) {
    return dir ? `${dir}$` : ""
  }

  return `${dir}$ ${cmd}`
}

function scrollBashProgress(p: ToolProps): string {
  const out = stripAnsi(p.frame.raw)
  const cmd = (p.input.command ?? "").trim()
  const fmt = (text: string) => {
    const body = text.replace(/^\n+/, "").replace(/\n+$/, "")
    return body ? `\n${body}` : ""
  }

  if (!cmd) {
    return out.replace(/\n+$/, "")
  }

  const wdRaw = (p.input.workdir ?? "").trim()
  const wd = wdRaw ? displayPath(p, wdRaw, { home: true }) : ""
  const lines = out.split("\n")
  const first = (lines[0] || "").trim()
  const second = (lines[1] || "").trim()

  if (wd && (first === wd || first === wdRaw) && second === cmd) {
    return fmt(lines.slice(2).join("\n"))
  }

  if (first === cmd || first === `$ ${cmd}`) {
    return fmt(lines.slice(1).join("\n"))
  }

  if (wd && (first === `${wd} ${cmd}` || first === `${wdRaw} ${cmd}`)) {
    return fmt(lines.slice(1).join("\n"))
  }

  return fmt(out)
}

function scrollShellFinal(p: ToolProps): string {
  if (p.frame.status === "error") {
    return fail(p.frame)
  }

  const code = p.metadata.exit
  const time = span(p.frame)
  if (code === undefined) {
    if (!time) {
      return p.language.t("tui.mini.tool.shellCompleted")
    }

    return `${p.language.t("tui.mini.tool.shellCompleted")} · ${time}`
  }

  return `${p.language.t("tui.mini.tool.shellExit", { code })}${time ? ` · ${time}` : ""}`
}

function scrollReadStart(p: ToolProps): string {
  const file = displayPath(p, p.input.path)
  const extra = primitiveInputSummary(p.frame.input, ["path"])
  const tail = extra ? ` ${extra}` : ""
  return `→ ${p.language.t("tui.mini.tool.read", { path: file })}${tail}`.trim()
}

function scrollWriteStart(_: ToolProps): string {
  return ""
}

function scrollEditStart(_: ToolProps): string {
  return ""
}

function scrollPatchStart(_: ToolProps): string {
  return ""
}

function patchLine(file: PatchFile, directory: string | undefined, language: MiniLanguage): string {
  if (file.status === "added") {
    return `+ ${language.t("tui.mini.tool.created", { path: toolPath(file.file, { directory }) })}`
  }

  if (file.status === "deleted") {
    return `- ${language.t("tui.mini.tool.deleted", { path: toolPath(file.file, { directory }) })}`
  }
  if (file.status === "moved") {
    return `→ ${language.t("tui.mini.tool.movedInline", { from: toolPath(file.from, { directory }), to: toolPath(file.file, { directory }) })}`
  }

  return `~ ${language.t("tui.mini.tool.patched", { path: toolPath(file.file, { directory }) })}`
}

function scrollPatchFinal(p: ToolProps): string {
  if (p.frame.status === "error") {
    return fail(p.frame)
  }

  const files = list<PatchFile>(p.frame.meta.files)
  if (files.length === 0) {
    const time = span(p.frame)
    if (!time) {
      return p.language.t("tui.mini.tool.patchAction")
    }

    return `${p.language.t("tui.mini.tool.patchAction")} · ${time}`
  }

  const showModified = !files.some((file) => file?.status && file.status !== "modified")
  const shown = files.filter((file) => showModified || file.status !== "modified")
  const rows = shown.slice(0, 6).map((file) => patchLine(file, p.frame.directory, p.language))
  if (shown.length > 6) {
    rows.push(p.language.t("tui.mini.tool.more", { count: shown.length - 6 }))
  }

  if (rows.length > 0) {
    return rows.join("\n")
  }

  return patchLine(files[0]!, p.frame.directory, p.language)
}

function scrollTaskStart(_: ToolProps): string {
  return ""
}

function taskResult(output: string): string | undefined {
  if (!output.trim()) {
    return undefined
  }

  const match = output.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/)
  if (match) {
    return match[1].trim() || undefined
  }

  const next = output
    .split("\n")
    .filter((line) => !line.startsWith("task_id:"))
    .join("\n")
    .trim()
  return next || undefined
}

function scrollTaskFinal(p: ToolProps): string {
  if (p.frame.status === "error") {
    return fail(p.frame)
  }

  const kind = p.input.agent ? Locale.titlecase(p.input.agent) : p.language.t("tui.mini.tool.general")
  const row = p.input.description
  if (!row) {
    return `# ${p.language.t("tui.mini.tool.subagent", { agent: kind })}`
  }

  return `# ${p.language.t("tui.mini.tool.subagent", { agent: kind })}\n${row}`
}

function scrollQuestionStart(_: ToolProps): string {
  return ""
}

function scrollQuestionFinal(p: ToolProps): string {
  const q = p.input.questions ?? []
  const a = p.metadata.answers ?? []
  const time = span(p.frame)
  if (q.length === 0) {
    if (!time) {
      return p.language.plural("tui.mini.tool.questionCount", 0)
    }

    return `${p.language.plural("tui.mini.tool.questionCount", 0)} · ${time}`
  }

  const rows: string[] = []
  for (const [i, item] of q.slice(0, 4).entries()) {
    const prompt = item.question
    const reply = a[i] ?? []
    rows.push(`? ${prompt || p.language.t("tui.mini.tool.question", { number: i + 1 })}`)
    rows.push(`  ${reply.length > 0 ? reply.join(", ") : p.language.t("tui.mini.tool.noAnswer")}`)
  }

  if (q.length > 4) {
    rows.push(p.language.t("tui.mini.tool.more", { count: q.length - 4 }))
  }

  return rows.join("\n")
}

function scrollLspStart(p: ToolProps): string {
  return `→ ${lspTitle(p.input, { directory: p.frame.directory, language: p.language })}`
}

function scrollSkillStart(p: ToolProps): string {
  return `→ ${p.language.t("tui.mini.tool.skill", { name: p.metadata.name ?? p.input.id ?? "" })}`
}

function scrollGlobStart(p: ToolProps): string {
  const pattern = p.input.pattern ?? ""
  const head =
    "✱ " + (pattern ? p.language.t("tui.mini.tool.glob", { pattern }) : p.language.t("tui.mini.tool.globTitle"))
  const dir = p.input.path ?? ""
  if (!dir) {
    return head
  }

  return `${head} ${p.language.t("tui.mini.tool.inPath", { path: displayPath(p, dir) })}`
}

function scrollGlobFinal(p: ToolProps): string {
  return toolError(p.frame) || fail(p.frame)
}

function scrollGrepStart(p: ToolProps): string {
  const pattern = p.input.pattern ?? ""
  const head =
    "✱ " + (pattern ? p.language.t("tui.mini.tool.grep", { pattern }) : p.language.t("tui.mini.tool.grepTitle"))
  const dir = p.input.path ?? ""
  if (!dir) {
    return head
  }

  return `${head} ${p.language.t("tui.mini.tool.inPath", { path: displayPath(p, dir) })}`
}

function scrollListStart(p: ToolProps): string {
  const dir = text(dict(p.input).path)
  if (!dir) {
    return `→ ${p.language.t("tui.mini.tool.list")}`
  }

  return `→ ${p.language.t("tui.mini.tool.listPath", { path: displayPath(p, dir) })}`
}

function scrollWebfetchStart(p: ToolProps): string {
  const url = p.input.url ?? ""
  if (!url) {
    return `% ${p.language.t("tui.mini.tool.webfetch")}`
  }

  return `% ${p.language.t("tui.mini.tool.webfetchUrl", { url })}`
}

function scrollWebSearchStart(p: ToolProps): string {
  const provider = webSearchProviderName(p.metadata.provider)
  const title = provider
    ? p.language.t("tui.mini.tool.webSearchProvider", { provider })
    : p.language.t("tui.mini.tool.webSearch")
  const query = p.input.query ?? ""
  if (!query) {
    return `◈ ${title}`
  }

  return `◈ ${title} "${query}"`
}

const TOOL_RULES = {
  invalid: {
    view: {
      output: true,
      final: false,
    },
    run: runInvalid,
    scroll: {
      start: () => "",
    },
  },
  shell: {
    view: {
      output: true,
      final: false,
    },
    run: runShell,
    scroll: {
      start: scrollBashStart,
      progress: scrollBashProgress,
      final: scrollShellFinal,
    },
  },
  write: {
    view: {
      output: false,
      final: true,
      snap: "code",
    },
    run: runWrite,
    snap: snapWrite,
    scroll: {
      start: scrollWriteStart,
    },
  },
  edit: {
    view: {
      output: false,
      final: true,
      snap: "diff",
    },
    run: runEdit,
    snap: snapEdit,
    scroll: {
      start: scrollEditStart,
    },
  },
  patch: {
    view: {
      output: false,
      final: true,
      snap: "diff",
    },
    run: runPatch,
    snap: snapPatch,
    scroll: {
      start: scrollPatchStart,
      final: scrollPatchFinal,
    },
  },
  batch: {
    view: {
      output: true,
      final: false,
    },
    run: runBatch,
    scroll: {
      start: () => "",
    },
  },
  subagent: {
    view: {
      output: false,
      final: true,
      snap: "structured",
    },
    run: runTask,
    snap: snapTask,
    scroll: {
      start: scrollTaskStart,
      final: scrollTaskFinal,
    },
  },
  question: {
    view: {
      output: false,
      final: true,
      snap: "structured",
    },
    run: runQuestion,
    snap: snapQuestion,
    scroll: {
      start: scrollQuestionStart,
      final: scrollQuestionFinal,
    },
  },
  read: {
    view: {
      output: false,
      final: false,
    },
    run: runRead,
    scroll: {
      start: scrollReadStart,
    },
  },
  glob: {
    view: {
      output: false,
      final: false,
    },
    run: runGlob,
    scroll: {
      start: scrollGlobStart,
      final: scrollGlobFinal,
    },
  },
  grep: {
    view: {
      output: false,
      final: false,
    },
    run: runGrep,
    scroll: {
      start: scrollGrepStart,
    },
  },
  list: {
    view: {
      output: false,
      final: false,
    },
    run: runList,
    scroll: {
      start: scrollListStart,
    },
  },
  lsp: {
    view: {
      output: false,
      final: false,
    },
    run: runLsp,
    scroll: {
      start: scrollLspStart,
    },
  },
  webfetch: {
    view: {
      output: false,
      final: false,
    },
    run: runWebfetch,
    scroll: {
      start: scrollWebfetchStart,
    },
  },
  websearch: {
    view: {
      output: false,
      final: false,
    },
    run: runWebSearch,
    scroll: {
      start: scrollWebSearchStart,
    },
  },
  skill: {
    view: {
      output: false,
      final: false,
    },
    run: runSkill,
    scroll: {
      start: scrollSkillStart,
    },
  },
} as const satisfies ToolRegistry

function key(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_RULES, name)
}

function rule(name?: string): AnyToolRule | undefined {
  if (!name || !key(name)) {
    return undefined
  }

  return TOOL_RULES[name]
}

function frame(part: SessionMessageAssistantTool, directory?: string, language = defaultMiniLanguage): ToolFrame {
  const tool = normalizeTool(part)
  if (tool.state.status === "streaming")
    return {
      directory,
      language,
      raw: tool.state.input,
      name: tool.name,
      input: {},
      meta: {},
      state: dict(tool.state),
      status: tool.state.status,
      error: "",
      output: "",
      time: { start: tool.time.created },
    }
  const output = toolOutputText(tool.name, toolDisplayContent(tool.state))
  return {
    directory,
    language,
    raw: output,
    name: tool.name,
    input: normalizeInput(tool.name, tool.state.input),
    meta: normalizeMetadata(tool.name, tool.state.metadata),
    state: dict(tool.state),
    status: tool.state.status,
    error: tool.state.status === "error" ? tool.state.error.message : "",
    output,
    time: {
      start: tool.time.ran ?? tool.time.created,
      end: tool.time.completed,
    },
  }
}

function toolFrame(commit: StreamCommit, raw: string, language = defaultMiniLanguage): ToolFrame {
  const current = commit.part ? frame(commit.part, commit.directory) : undefined
  return {
    directory: commit.directory,
    language,
    raw,
    name: canonicalToolName(commit.tool || current?.name || "tool"),
    input: current?.input ?? {},
    meta: current?.meta ?? {},
    state: current?.state ?? {},
    status: commit.toolState ?? current?.status ?? "",
    error: (commit.toolError ?? current?.error ?? "").trim(),
    output: current?.output ?? raw,
    time: current?.time ?? {},
  }
}

function runShell(p: ToolProps): ToolInline {
  return {
    icon: "$",
    title: p.input.command || "",
    mode: "block",
    body: p.frame.status === "completed" ? p.frame.output.trim() : undefined,
  }
}

export function toolView(name?: string): ToolView {
  return (
    rule(name ? canonicalToolName(name) : undefined)?.view ?? {
      output: true,
      final: true,
    }
  )
}

export function toolStructuredFinal(commit: StreamCommit): boolean {
  const state = commit.toolState ?? commit.part?.state.status
  return (
    commit.kind === "tool" &&
    commit.phase === "final" &&
    state === "completed" &&
    Boolean(toolView(commit.tool ?? commit.part?.name).snap)
  )
}

export function toolInlineInfo(
  part: SessionMessageAssistantTool,
  directory?: string,
  language = defaultMiniLanguage,
): ToolInline {
  const ctx = frame(part, directory, language)
  const draw = rule(ctx.name)?.run
  try {
    if (draw) {
      return draw(props(ctx))
    }
  } catch {
    return fallbackInline(ctx)
  }

  return fallbackInline(ctx)
}

export function toolScroll(phase: ToolPhase, ctx: ToolFrame): string {
  const draw = rule(ctx.name)?.scroll?.[phase]
  try {
    if (draw) {
      return draw(props(ctx))
    }
  } catch {
    if (phase === "start") {
      return fallbackStart(ctx)
    }
    if (phase === "progress") {
      return ctx.raw
    }
    return fallbackFinal(ctx)
  }

  if (phase === "start") {
    return fallbackStart(ctx)
  }

  if (phase === "progress") {
    return ctx.raw
  }

  return fallbackFinal(ctx)
}

function toolSnapshot(commit: StreamCommit, raw: string, language: MiniLanguage): ToolSnapshot | undefined {
  const ctx = toolFrame(commit, raw, language)
  const draw = rule(ctx.name)?.snap
  if (!draw) {
    return undefined
  }

  try {
    return draw(props(ctx))
  } catch {
    return undefined
  }
}

function textBody(content: string): RunEntryBody | undefined {
  if (!content) {
    return undefined
  }

  return {
    type: "text",
    content,
  }
}

function markdownBody(content: string): RunEntryBody | undefined {
  if (!content) {
    return undefined
  }

  return {
    type: "markdown",
    content,
  }
}

function structuredBody(commit: StreamCommit, raw: string, language: MiniLanguage): RunEntryBody | undefined {
  const snap = toolSnapshot(commit, raw, language)
  if (!snap) {
    return undefined
  }

  return {
    type: "structured",
    snapshot: snap,
  }
}

const STRUCTURED_FALLBACK_LENGTH = 4_096

function structuredFallback(value: ToolDict, language: MiniLanguage): RunEntryBody | undefined {
  if (Object.keys(value).length === 0) return
  const content = JSON.stringify(value, null, 2)
  if (!content) return
  const suffix = "\n" + language.t("tui.mini.tool.truncated")
  return {
    type: "code",
    content:
      content.length <= STRUCTURED_FALLBACK_LENGTH
        ? content
        : content.slice(0, STRUCTURED_FALLBACK_LENGTH - suffix.length) + suffix,
    filetype: "json",
  }
}

function shellOutput(command: string, raw: string): string | undefined {
  const body = stripAnsi(raw).replace(/^\n+/, "").replace(/\n+$/, "")
  if (!body) {
    return undefined
  }

  if (!command) {
    return body
  }

  return `\n${body}`
}

export function toolEntryBody(
  commit: StreamCommit,
  raw: string,
  options?: { shellOutput?: boolean; language?: MiniLanguage },
): RunEntryBody | undefined {
  const language = options?.language ?? defaultMiniLanguage
  if (commit.shell) {
    if (commit.phase === "start") {
      return textBody(`$ ${commit.shell.command}`)
    }

    if (commit.phase === "progress") {
      return textBody(shellOutput(commit.shell.command, raw) ?? "")
    }

    if (commit.toolState === "error") {
      const ctx = toolFrame(commit, raw, language)
      return textBody(toolScroll("final", ctx))
    }

    return undefined
  }

  const ctx = toolFrame(commit, raw, language)
  const view = toolView(ctx.name)

  if (ctx.name === "shell" && commit.phase === "progress" && options?.shellOutput === false) return undefined

  if (ctx.name === "subagent") {
    if (commit.phase === "start") {
      return undefined
    }

    if (commit.phase === "final" && ctx.status === "completed") {
      const result = taskResult(ctx.output)
      if (result) {
        return markdownBody(result)
      }
    }
  }

  if (commit.phase === "progress" && !view.output) {
    return undefined
  }

  if (commit.phase === "final") {
    if (ctx.status === "error") {
      return textBody(toolScroll("final", ctx))
    }

    if (!view.final) {
      return undefined
    }

    if (ctx.status && ctx.status !== "completed") {
      return textBody(ctx.raw.trim())
    }

    if (toolStructuredFinal(commit)) {
      return structuredBody(commit, raw, language) ?? textBody(toolScroll("final", ctx))
    }

    if (!rule(ctx.name) && !ctx.output.trim()) {
      return structuredFallback(ctx.meta, language) ?? textBody(toolScroll("final", ctx))
    }
  }

  return textBody(toolScroll(commit.phase, ctx))
}

export function toolFiletype(input?: string): string | undefined {
  if (!input) {
    return undefined
  }

  const ext = path.extname(input)
  const lang = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(lang)) {
    return "typescript"
  }

  return lang
}
