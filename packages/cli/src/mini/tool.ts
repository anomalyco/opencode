// Per-tool display rules shared across `opencode run` output paths.
//
// Each known tool (bash, edit, write, task, etc.) has a ToolRule that controls
// five display hooks:
//
//   view       → visibility policy for progress/final scrollback entries and
//                whether completed finals can render as structured snapshots
//   run        → inline summary for the non-interactive `run` command output
//   scroll     → text formatting for start/progress/final scrollback entries
//   permission → display info for the permission UI (icon, title, diff)
//   snap       → structured snapshot (code block, diff, task card) for rich
//                scrollback entries
//
// Tools not in TOOL_RULES get fallback formatting.
import os from "os"
import path from "path"
import stripAnsi from "strip-ansi"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { LANGUAGE_EXTENSIONS } from "@opencode-ai/tui/util/filetype"
import { Locale } from "@opencode-ai/tui/util/locale"
import type { RunEntryBody, StreamCommit, ToolSnapshot } from "./types"

export type ToolView = {
  output: boolean
  final: boolean
  snap?: "code" | "diff" | "structured"
}

export type ToolPhase = "start" | "progress" | "final"

export type ToolDict = Record<string, unknown>

type PatchFile = {
  type?: string
  relativePath?: string
  filePath?: string
  movePath?: string
  patch?: string
  deletions?: number
}

type ToolInput = ToolDict & {
  path?: string
  pattern?: string
  filePath?: string
  filepath?: string
  url?: string
  query?: string
  subagent_type?: string
  description?: string
  name?: string
  operation?: string
  line?: number
  character?: number
  content?: string
  command?: string
  workdir?: string
  todos?: Array<{ status?: string; content?: string }>
  questions?: Array<{ question?: string }>
  diff?: string
}

type ToolMetadata = ToolDict & {
  count?: number
  matches?: number
  diff?: string
  provider?: unknown
  files?: PatchFile[]
  answers?: string[][]
  exit?: number
}

export type ToolFrame = {
  raw: string
  name: string
  input: ToolDict
  meta: ToolDict
  state: ToolDict
  status: string
  error: string
}

export type ToolInline = {
  icon: string
  title: string
  description?: string
  mode?: "inline" | "block"
  body?: string
}

export type ToolPermissionInfo = {
  icon: string
  title: string
  lines: string[]
  diff?: string
  file?: string
}

export type ToolProps = {
  input: ToolInput
  metadata: ToolMetadata
  frame: ToolFrame
}

type ToolPermissionProps = {
  input: ToolInput
  metadata: ToolMetadata
  patterns: string[]
}

type ToolPermissionCtx = {
  input: ToolDict
  meta: ToolDict
  patterns: string[]
}

type ToolName =
  | "invalid"
  | "bash"
  | "write"
  | "edit"
  | "patch"
  | "batch"
  | "task"
  | "todowrite"
  | "question"
  | "read"
  | "glob"
  | "grep"
  | "list"
  | "lsp"
  | "webfetch"
  | "websearch"
  | "skill"
  | "plan_exit"

type ToolRule = {
  view: ToolView
  run: (props: ToolProps) => ToolInline
  scroll?: Partial<Record<ToolPhase, (props: ToolProps) => string>>
  permission?: (props: ToolPermissionProps) => ToolPermissionInfo
  snap?: (props: ToolProps) => ToolSnapshot | undefined
}

type ToolRegistry = Record<ToolName, ToolRule>

type AnyToolRule = ToolRule

function dict(v: unknown): ToolDict {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return {}
  }

  return { ...v }
}

function props(frame: ToolFrame): ToolProps {
  return {
    input: frame.input,
    metadata: frame.meta,
    frame,
  }
}

function permission(ctx: ToolPermissionCtx): ToolPermissionProps {
  return {
    input: ctx.input,
    metadata: ctx.meta,
    patterns: ctx.patterns,
  }
}

function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

function text(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function num(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return undefined
  }

  return v
}

function list<T>(v: unknown): T[] {
  if (!Array.isArray(v)) {
    return []
  }

  return v
}

function info(data: ToolDict, skip: string[] = []): string {
  const list = Object.entries(data).filter(([key, val]) => {
    if (skip.includes(key)) {
      return false
    }

    return typeof val === "string" || typeof val === "number" || typeof val === "boolean"
  })

  if (list.length === 0) {
    return ""
  }

  return `[${list.map(([key, val]) => `${key}=${String(val)}`).join(", ")}]`
}

function span(state: ToolDict): string {
  const time = dict(state.time)
  const start = num(time.start)
  const end = num(time.end)
  if (start === undefined || end === undefined || end <= start) {
    return ""
  }

  return Locale.duration(end - start)
}

function fail(ctx: ToolFrame): string {
  const error = toolError(ctx)
  if (error) {
    return `✖ ${ctx.name} failed: ${error}`
  }

  return `✖ ${ctx.name} failed`
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
  const extra = info(ctx.input)
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

  const time = span(ctx.state)
  if (!time) {
    return `${ctx.name} completed`
  }

  return `${ctx.name} completed · ${time}`
}

export function toolPath(input?: string, opts: { home?: boolean } = {}): string {
  if (!input) {
    return ""
  }

  const cwd = process.cwd()
  const home = os.homedir()
  const abs = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const rel = path.relative(cwd, abs)

  if (!rel) {
    return "."
  }

  if (!rel.startsWith("..")) {
    return rel.replaceAll("\\", "/")
  }

  if (opts.home && home && (abs === home || abs.startsWith(home + path.sep))) {
    return abs.replace(home, "~").replaceAll("\\", "/")
  }

  return abs.replaceAll("\\", "/")
}

function fallbackInline(ctx: ToolFrame): ToolInline {
  const title = text(ctx.state.title) || (Object.keys(ctx.input).length > 0 ? JSON.stringify(ctx.input) : "Unknown")

  return {
    icon: "⚙",
    title: `${ctx.name} ${title}`,
  }
}

function count(n: number, label: string): string {
  return `${n} ${label}${n === 1 ? "" : "es"}`
}

function runGlob(p: ToolProps): ToolInline {
  const root = p.input.path ?? ""
  const title = `Glob "${p.input.pattern ?? ""}"`
  const suffix = root ? `in ${toolPath(root)}` : ""
  const matches = p.metadata.count
  const description = matches === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${count(matches, "match")}`
  return {
    icon: "✱",
    title,
    ...(description && { description }),
  }
}

function runGrep(p: ToolProps): ToolInline {
  const root = p.input.path ?? ""
  const title = `Grep "${p.input.pattern ?? ""}"`
  const suffix = root ? `in ${toolPath(root)}` : ""
  const matches = p.metadata.matches
  const description = matches === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${count(matches, "match")}`
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
    title: dir ? `List ${toolPath(dir)}` : "List",
  }
}

function runRead(p: ToolProps): ToolInline {
  const file = toolPath(p.input.filePath)
  const description = info(p.frame.input, ["filePath"]) || undefined
  return {
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  }
}

function runWrite(p: ToolProps): ToolInline {
  return {
    icon: "←",
    title: `Write ${toolPath(p.input.filePath)}`,
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

function runWebfetch(p: ToolProps): ToolInline {
  const url = p.input.url ?? ""
  return {
    icon: "%",
    title: url ? `WebFetch ${url}` : "WebFetch",
  }
}

function runEdit(p: ToolProps): ToolInline {
  return {
    icon: "←",
    title: `Edit ${toolPath(p.input.filePath)}`,
    mode: "block",
    body: p.metadata.diff,
  }
}

function runWebSearch(p: ToolProps): ToolInline {
  const title = webSearchProviderLabel(p.metadata.provider)
  return {
    icon: "◈",
    title: p.input.query ? `${title} "${p.input.query}"` : title,
  }
}

function runTask(p: ToolProps): ToolInline {
  const kind = Locale.titlecase(p.input.subagent_type || "unknown")
  const desc = p.input.description
  const icon = p.frame.status === "error" ? "✗" : p.frame.status === "running" ? "•" : "✓"
  return {
    icon,
    title: desc || `${kind} Task`,
    description: desc ? `${kind} Agent` : undefined,
  }
}

function runTodo(p: ToolProps): ToolInline {
  return {
    icon: "#",
    title: "Todos",
    mode: "block",
    body: list<{ status?: string; content?: string }>(p.frame.input.todos)
      .flatMap((item) => {
        const body = typeof item?.content === "string" ? item.content : ""
        if (!body) {
          return []
        }

        const mark = item.status === "completed" ? "[✓]" : item.status === "in_progress" ? "[•]" : "[ ]"
        return [`${mark} ${body}`]
      })
      .join("\n"),
  }
}

function runSkill(p: ToolProps): ToolInline {
  return {
    icon: "→",
    title: `Skill "${p.input.name ?? ""}"`,
  }
}

function runPatch(p: ToolProps): ToolInline {
  const files = p.metadata.files?.length ?? 0
  if (files === 0) {
    return {
      icon: "%",
      title: "Patch",
    }
  }

  return {
    icon: "%",
    title: `Patch ${files} file${files === 1 ? "" : "s"}`,
  }
}

function runQuestion(p: ToolProps): ToolInline {
  const total = list(p.frame.input.questions).length
  return {
    icon: "→",
    title: `Asked ${total} question${total === 1 ? "" : "s"}`,
  }
}

function runInvalid(p: ToolProps): ToolInline {
  return {
    icon: "✗",
    title: text(p.frame.state.title) || "Invalid Tool",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

function runBatch(p: ToolProps): ToolInline {
  const calls = list(dict(p.input).tool_calls).length
  return {
    icon: "#",
    title: text(p.frame.state.title) || (calls > 0 ? `Batch ${calls} tool${calls === 1 ? "" : "s"}` : "Batch"),
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

function lspTitle(
  input: {
    operation?: string
    filePath?: string
    line?: number
    character?: number
  },
  opts: { home?: boolean } = {},
): string {
  const op = input.operation || "request"
  const file = input.filePath ? toolPath(input.filePath, opts) : ""
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
    title: text(p.frame.state.title) || lspTitle(p.input),
  }
}

function runPlanExit(p: ToolProps): ToolInline {
  return {
    icon: "→",
    title: text(p.frame.state.title) || "Switching to build agent",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

function patchTitle(file: PatchFile): string {
  const rel = file.relativePath
  const from = file.filePath
  if (file.type === "add") {
    return `# Created ${rel || toolPath(from)}`
  }
  if (file.type === "delete") {
    return `# Deleted ${rel || toolPath(from)}`
  }
  if (file.type === "move") {
    return `# Moved ${toolPath(from)} -> ${rel || toolPath(file.movePath)}`
  }

  return `# Patched ${rel || toolPath(from)}`
}

function snapWrite(p: ToolProps): ToolSnapshot | undefined {
  const file = p.input.filePath || ""
  const content = p.input.content || ""
  if (!file && !content) {
    return undefined
  }

  return {
    kind: "code",
    title: `# Wrote ${toolPath(file)}`,
    content,
    file,
  }
}

function snapEdit(p: ToolProps): ToolSnapshot | undefined {
  const file = p.input.filePath || ""
  const diff = p.metadata.diff || ""
  if (!file || !diff.trim()) {
    return undefined
  }

  return {
    kind: "diff",
    items: [
      {
        title: `# Edited ${toolPath(file)}`,
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

    const name = file.movePath || file.filePath || file.relativePath
    return [
      {
        title: patchTitle(file),
        diff,
        file: name,
        deletions: typeof file.deletions === "number" ? file.deletions : 0,
      },
    ]
  })

  if (items.length === 0) {
    return undefined
  }

  return {
    kind: "diff",
    items,
  }
}

function snapTask(p: ToolProps): ToolSnapshot {
  const kind = Locale.titlecase(p.input.subagent_type || "general")
  const desc = p.input.description
  const title = text(p.frame.state.title)
  const rows = [desc || title].filter((item): item is string => Boolean(item))

  return {
    kind: "task",
    title: `# ${kind} Task`,
    rows,
    tail: "",
  }
}

function snapTodo(p: ToolProps): ToolSnapshot {
  const items = list<{ status?: string; content?: string }>(p.frame.input.todos).flatMap((item) => {
    const content = typeof item?.content === "string" ? item.content : ""
    if (!content) {
      return []
    }

    return [
      {
        status: typeof item.status === "string" ? item.status : "",
        content,
      },
    ]
  })

  return {
    kind: "todo",
    items,
    tail: "",
  }
}

function snapQuestion(p: ToolProps): ToolSnapshot {
  const answers = list<unknown[]>(p.frame.meta.answers)
  const items = list<{ question?: string }>(p.frame.input.questions).map((item, i) => {
    const answer = list<string>(answers[i]).filter((entry) => typeof entry === "string")
    return {
      question: item.question || `Question ${i + 1}`,
      answer: answer.length > 0 ? answer.join(", ") : "(no answer)",
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
  const formatted = wd && wd !== "." ? toolPath(wd) : ""
  const dir = formatted === "." ? "" : formatted
  if (cmd && !dir) {
    return `$ ${cmd}`
  }

  if (!cmd) {
    return dir ? `# Running in ${dir}` : ""
  }

  return `# Running in ${dir}\n$ ${cmd}`
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
  const wd = wdRaw ? toolPath(wdRaw) : ""
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

function scrollBashFinal(p: ToolProps): string {
  if (p.frame.status === "error") {
    return fail(p.frame)
  }

  const code = p.metadata.exit ?? num(p.frame.meta.exitCode) ?? num(p.frame.meta.exit_code)
  const time = span(p.frame.state)
  if (code === undefined) {
    if (!time) {
      return "bash completed"
    }

    return `bash completed · ${time}`
  }

  return `bash completed (exit ${code})${time ? ` · ${time}` : ""}`
}

function scrollReadStart(p: ToolProps): string {
  const file = toolPath(p.input.filePath)
  const extra = info(p.frame.input, ["filePath"])
  const tail = extra ? ` ${extra}` : ""
  return `→ Read ${file}${tail}`.trim()
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

function patchLine(file: PatchFile): string {
  const type = file.type
  const rel = file.relativePath
  const from = file.filePath

  if (type === "add") {
    return `+ Created ${rel || toolPath(from)}`
  }

  if (type === "delete") {
    return `- Deleted ${rel || toolPath(from)}`
  }

  if (type === "move") {
    return `→ Moved ${toolPath(from)} → ${rel || toolPath(file.movePath)}`
  }

  return `~ Patched ${rel || toolPath(from)}`
}

function scrollPatchFinal(p: ToolProps): string {
  if (p.frame.status === "error") {
    return fail(p.frame)
  }

  const files = list<PatchFile>(p.frame.meta.files)
  if (files.length === 0) {
    const time = span(p.frame.state)
    if (!time) {
      return "patch"
    }

    return `patch · ${time}`
  }

  const show_updates = !files.some((file) => file?.type && file.type !== "update")
  const shown = files.filter((file) => show_updates || file.type !== "update")
  const rows = shown.slice(0, 6).map(patchLine)
  if (shown.length > 6) {
    rows.push(`... and ${shown.length - 6} more`)
  }

  if (rows.length > 0) {
    return rows.join("\n")
  }

  return patchLine(files[0]!)
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

  const kind = Locale.titlecase(p.input.subagent_type || "general")
  const row = p.input.description || text(p.frame.state.title)
  if (!row) {
    return `# ${kind} Task`
  }

  return `# ${kind} Task\n${row}`
}

function scrollTodoStart(_: ToolProps): string {
  return ""
}

function scrollTodoFinal(p: ToolProps): string {
  const items = list<{ status?: string }>(p.input.todos)
  const time = span(p.frame.state)
  if (items.length === 0) {
    if (!time) {
      return "0 todos"
    }

    return `0 todos · ${time}`
  }

  const doneN = items.filter((item) => item.status === "completed").length
  const runN = items.filter((item) => item.status === "in_progress").length
  const left = items.length - doneN - runN
  const tail = [`${items.length} total`]
  if (doneN > 0) {
    tail.push(`${doneN} done`)
  }
  if (runN > 0) {
    tail.push(`${runN} active`)
  }
  if (left > 0) {
    tail.push(`${left} pending`)
  }

  if (time) {
    tail.push(time)
  }

  return tail.join(" · ")
}

function scrollQuestionStart(_: ToolProps): string {
  return ""
}

function scrollQuestionFinal(p: ToolProps): string {
  const q = p.input.questions ?? []
  const a = p.metadata.answers ?? []
  const time = span(p.frame.state)
  if (q.length === 0) {
    if (!time) {
      return "0 questions"
    }

    return `0 questions · ${time}`
  }

  const rows: string[] = []
  for (const [i, item] of q.slice(0, 4).entries()) {
    const prompt = item.question
    const reply = a[i] ?? []
    rows.push(`? ${prompt || `Question ${i + 1}`}`)
    rows.push(`  ${reply.length > 0 ? reply.join(", ") : "(no answer)"}`)
  }

  if (q.length > 4) {
    rows.push(`... and ${q.length - 4} more`)
  }

  return rows.join("\n")
}

function scrollLspStart(p: ToolProps): string {
  return `→ ${lspTitle(p.input)}`
}

function scrollSkillStart(p: ToolProps): string {
  return `→ Skill "${p.input.name ?? ""}"`
}

function scrollGlobStart(p: ToolProps): string {
  const pattern = p.input.pattern ?? ""
  const head = pattern ? `✱ Glob "${pattern}"` : "✱ Glob"
  const dir = p.input.path ?? ""
  if (!dir) {
    return head
  }

  return `${head} in ${toolPath(dir)}`
}

function scrollGlobFinal(p: ToolProps): string {
  return toolError(p.frame) || fail(p.frame)
}

function scrollGrepStart(p: ToolProps): string {
  const pattern = p.input.pattern ?? ""
  const head = pattern ? `✱ Grep "${pattern}"` : "✱ Grep"
  const dir = p.input.path ?? ""
  if (!dir) {
    return head
  }

  return `${head} in ${toolPath(dir)}`
}

function scrollListStart(p: ToolProps): string {
  const dir = text(dict(p.input).path)
  if (!dir) {
    return "→ List"
  }

  return `→ List ${toolPath(dir)}`
}

function scrollWebfetchStart(p: ToolProps): string {
  const url = p.input.url ?? ""
  if (!url) {
    return "% WebFetch"
  }

  return `% WebFetch ${url}`
}

function scrollWebSearchStart(p: ToolProps): string {
  const title = webSearchProviderLabel(p.metadata.provider)
  const query = p.input.query ?? ""
  if (!query) {
    return `◈ ${title}`
  }

  return `◈ ${title} "${query}"`
}

function permEdit(p: ToolPermissionProps): ToolPermissionInfo {
  const input = p.input as { filePath?: string; filepath?: string; diff?: string }
  const file = input.filePath || input.filepath || p.patterns[0] || ""
  return {
    icon: "→",
    title: `Edit ${toolPath(file, { home: true })}`,
    lines: [],
    diff: p.metadata.diff ?? input.diff,
    file,
  }
}

function permRead(p: ToolPermissionProps): ToolPermissionInfo {
  const file = p.input.filePath || p.patterns[0] || ""
  return {
    icon: "→",
    title: `Read ${toolPath(file, { home: true })}`,
    lines: file ? [`Path: ${toolPath(file, { home: true })}`] : [],
  }
}

function permGlob(p: ToolPermissionProps): ToolPermissionInfo {
  const pattern = p.input.pattern || p.patterns[0] || ""
  return {
    icon: "✱",
    title: `Glob "${pattern}"`,
    lines: pattern ? [`Pattern: ${pattern}`] : [],
  }
}

function permGrep(p: ToolPermissionProps): ToolPermissionInfo {
  const pattern = p.input.pattern || p.patterns[0] || ""
  return {
    icon: "✱",
    title: `Grep "${pattern}"`,
    lines: pattern ? [`Pattern: ${pattern}`] : [],
  }
}

function permList(p: ToolPermissionProps): ToolPermissionInfo {
  const dir = text(dict(p.input).path) || p.patterns[0] || ""
  return {
    icon: "→",
    title: `List ${toolPath(dir, { home: true })}`,
    lines: dir ? [`Path: ${toolPath(dir, { home: true })}`] : [],
  }
}

function permBash(p: ToolPermissionProps): ToolPermissionInfo {
  const cmd = p.input.command || ""
  return {
    icon: "#",
    title: "Shell command",
    lines: cmd ? [`$ ${cmd}`] : p.patterns.map((item) => `- ${item}`),
  }
}

function permTask(p: ToolPermissionProps): ToolPermissionInfo {
  const type = p.input.subagent_type || "general"
  const desc = p.input.description
  return {
    icon: "#",
    title: `${Locale.titlecase(type)} Task`,
    lines: desc ? [`◉ ${desc}`] : [],
  }
}

function permWebfetch(p: ToolPermissionProps): ToolPermissionInfo {
  const url = p.input.url || ""
  return {
    icon: "%",
    title: `WebFetch ${url}`,
    lines: url ? [`URL: ${url}`] : [],
  }
}

function permWebSearch(p: ToolPermissionProps): ToolPermissionInfo {
  const query = p.input.query || ""
  const title = webSearchProviderLabel(p.metadata.provider)
  return {
    icon: "◈",
    title: query ? `${title} "${query}"` : title,
    lines: query ? [`Query: ${query}`] : [],
  }
}

function permLsp(p: ToolPermissionProps): ToolPermissionInfo {
  const file = p.input.filePath || ""
  const line = typeof p.input.line === "number" ? p.input.line : undefined
  const char = typeof p.input.character === "number" ? p.input.character : undefined
  const pos = line !== undefined && char !== undefined ? `${line}:${char}` : undefined
  return {
    icon: "→",
    title: lspTitle(p.input, { home: true }),
    lines: [
      ...(p.input.operation ? [`Operation: ${p.input.operation}`] : []),
      ...(file ? [`Path: ${toolPath(file, { home: true })}`] : []),
      ...(pos ? [`Position: ${pos}`] : []),
    ],
  }
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
  bash: {
    view: {
      output: true,
      final: false,
    },
    run: runBash,
    scroll: {
      start: scrollBashStart,
      progress: scrollBashProgress,
      final: scrollBashFinal,
    },
    permission: permBash,
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
    permission: permEdit,
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
  task: {
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
    permission: permTask,
  },
  todowrite: {
    view: {
      output: false,
      final: true,
      snap: "structured",
    },
    run: runTodo,
    snap: snapTodo,
    scroll: {
      start: scrollTodoStart,
      final: scrollTodoFinal,
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
    permission: permRead,
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
    permission: permGlob,
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
    permission: permGrep,
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
    permission: permList,
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
    permission: permLsp,
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
    permission: permWebfetch,
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
    permission: permWebSearch,
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
  plan_exit: {
    view: {
      output: true,
      final: false,
    },
    run: runPlanExit,
    scroll: {
      start: () => "",
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

function frame(part: ToolPart): ToolFrame {
  const state = dict(part.state)
  return {
    raw: "",
    name: part.tool,
    input: dict(state.input),
    meta: "metadata" in part.state ? dict(part.state.metadata) : {},
    state,
    status: text(state.status),
    error: text(state.error),
  }
}

export function toolFrame(commit: StreamCommit, raw: string): ToolFrame {
  const state = dict(commit.part?.state)
  return {
    raw,
    name: commit.tool || commit.part?.tool || "tool",
    input: dict(state.input),
    meta: commit.part?.state && "metadata" in commit.part.state ? dict(commit.part.state.metadata) : {},
    state,
    status: commit.toolState ?? text(state.status),
    error: (commit.toolError ?? "").trim(),
  }
}

function runBash(p: ToolProps): ToolInline {
  return {
    icon: "$",
    title: p.input.command || "",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output).trim() : undefined,
  }
}

export function toolView(name?: string): ToolView {
  return (
    rule(name)?.view ?? {
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
    Boolean(toolView(commit.tool ?? commit.part?.tool).snap)
  )
}

export function toolInlineInfo(part: ToolPart): ToolInline {
  const ctx = frame(part)
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

export function toolPermissionInfo(
  name: string,
  input: ToolDict,
  meta: ToolDict,
  patterns: string[],
): ToolPermissionInfo | undefined {
  const draw = rule(name)?.permission
  if (!draw) {
    return undefined
  }

  try {
    return draw(permission({ input, meta, patterns }))
  } catch {
    return undefined
  }
}

export function toolSnapshot(commit: StreamCommit, raw: string): ToolSnapshot | undefined {
  const ctx = toolFrame(commit, raw)
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

function structuredBody(commit: StreamCommit, raw: string): RunEntryBody | undefined {
  const snap = toolSnapshot(commit, raw)
  if (!snap) {
    return undefined
  }

  return {
    type: "structured",
    snapshot: snap,
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

export function toolEntryBody(commit: StreamCommit, raw: string): RunEntryBody | undefined {
  if (commit.shell) {
    if (commit.phase === "start") {
      return textBody(`$ ${commit.shell.command}`)
    }

    if (commit.phase === "progress") {
      return textBody(shellOutput(commit.shell.command, raw) ?? "")
    }

    if (commit.toolState === "error") {
      const ctx = toolFrame(commit, raw)
      return textBody(toolScroll("final", ctx))
    }

    return undefined
  }

  const ctx = toolFrame(commit, raw)
  const view = toolView(ctx.name)

  if (ctx.name === "task") {
    if (commit.phase === "start") {
      return undefined
    }

    if (commit.phase === "final" && ctx.status === "completed") {
      const result = taskResult(text(ctx.state.output))
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
      return structuredBody(commit, raw) ?? textBody(toolScroll("final", ctx))
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
