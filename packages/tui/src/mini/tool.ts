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
import type { SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { LANGUAGE_EXTENSIONS } from "../util/filetype"
import { Locale } from "../util/locale"
import {
  canonicalToolName,
  finiteNumber,
  primitiveInputSummary,
  toolDisplayMetadata,
  webSearchProviderLabel,
} from "../util/tool-display"
import { formatPath } from "../util/path-format"
import type { RunEntryBody, StreamCommit, ToolSnapshot } from "./types"

export type { MiniToolPart } from "./types"
export { canonicalToolName } from "../util/tool-display"

export type ToolView = {
  output: boolean
  final: boolean
  snap?: "code" | "diff" | "structured"
}

export type ToolPhase = "start" | "progress" | "final"

export type ToolDict = Record<string, unknown>

type PatchFile = {
  status?: string
  file?: string
  from?: string
  patch?: string
  deletions?: number
}

type ToolInput = ToolDict & {
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
  count?: number
  matches?: number
  diff?: string
  provider?: unknown
  files?: PatchFile[]
  answers?: string[][]
  exit?: number
}

export type ToolFrame = {
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

export type ToolInline = {
  icon: string
  title: string
  description?: string
  mode?: "inline" | "block"
  body?: string
}

export type ToolProps = {
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
  | "plan_exit"

type ToolRule = {
  view: ToolView
  run: (props: ToolProps) => ToolInline
  scroll?: Partial<Record<ToolPhase, (props: ToolProps) => string>>
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

function text(v: unknown): string {
  return typeof v === "string" ? v : ""
}

export function toolOutputText(name: string, content: ReadonlyArray<{ type: string; text?: string }>) {
  // V2 shell content appends model-only status after the user-visible command output.
  if (canonicalToolName(name) === "shell") return content.find((item) => item.type === "text")?.text ?? ""
  return content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n")
}

function normalizeInput(name: string, value: unknown) {
  const input = dict(value)
  const path = typeof input.path === "string" ? input.path : text(input.filePath) || text(input.filepath)
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
  const patch = typeof file.patch === "string" ? file.patch : text(file.diff) || undefined
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

function normalizeStructured(name: string, value: unknown) {
  const structured = dict(value)
  const files = list(structured.files).flatMap((item) => {
    const file = normalizeFile(item)
    return file ? [file] : []
  })
  const sessionID = text(structured.sessionID) || text(structured.sessionId)
  return {
    ...structured,
    ...(["edit", "patch"].includes(name) && Array.isArray(structured.files) ? { files } : {}),
    ...(name === "subagent" && sessionID ? { sessionID } : {}),
    ...(name === "shell" &&
    finiteNumber(structured.exit) === undefined &&
    finiteNumber(structured.exitCode) !== undefined
      ? { exit: finiteNumber(structured.exitCode) }
      : {}),
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
      structured: normalizeStructured(name, toolDisplayMetadata(tool.state)),
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
    return `${ctx.name} completed`
  }

  return `${ctx.name} completed · ${time}`
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
  const title = Object.keys(ctx.input).length > 0 ? JSON.stringify(ctx.input) : "Unknown"

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
  const suffix = root ? `in ${displayPath(p, root)}` : ""
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
  const suffix = root ? `in ${displayPath(p, root)}` : ""
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
    title: dir ? `List ${displayPath(p, dir)}` : "List",
  }
}

function runRead(p: ToolProps): ToolInline {
  const file = displayPath(p, p.input.path)
  const description = primitiveInputSummary(p.frame.input, ["path"]) || undefined
  return {
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  }
}

function runWrite(p: ToolProps): ToolInline {
  return {
    icon: "←",
    title: `Write ${displayPath(p, p.input.path)}`,
    mode: "block",
    body: p.frame.status === "completed" ? p.frame.output : undefined,
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
  const file = list<PatchFile>(p.metadata.files)[0]
  return {
    icon: "←",
    title: `Edit ${displayPath(p, p.input.path)}`,
    mode: "block",
    body: file?.patch ?? p.metadata.diff,
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
  const kind = Locale.titlecase(p.input.agent || "unknown")
  const desc = p.input.description
  const icon = p.frame.status === "error" ? "✗" : p.frame.status === "running" ? "•" : "✓"
  return {
    icon,
    title: desc || `${kind} Subagent`,
    description: desc ? `${kind} Agent` : undefined,
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
    title: "Invalid Tool",
    mode: "block",
    body: p.frame.status === "completed" ? p.frame.output : undefined,
  }
}

function runBatch(p: ToolProps): ToolInline {
  const calls = list(dict(p.input).tool_calls).length
  return {
    icon: "#",
    title: calls > 0 ? `Batch ${calls} tool${calls === 1 ? "" : "s"}` : "Batch",
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
  opts: { home?: boolean; directory?: string } = {},
): string {
  const op = input.operation || "request"
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
    title: lspTitle(p.input, { directory: p.frame.directory }),
  }
}

function runPlanExit(p: ToolProps): ToolInline {
  return {
    icon: "→",
    title: "Switching to build agent",
    mode: "block",
    body: p.frame.status === "completed" ? p.frame.output : undefined,
  }
}

function patchTitle(file: PatchFile, directory?: string): string {
  if (file.status === "added") {
    return `# Created ${toolPath(file.file, { directory })}`
  }
  if (file.status === "deleted") {
    return `# Deleted ${toolPath(file.file, { directory })}`
  }
  if (file.status === "moved") {
    return `# Moved ${toolPath(file.from, { directory })} -> ${toolPath(file.file, { directory })}`
  }

  return `# Patched ${toolPath(file.file, { directory })}`
}

function snapWrite(p: ToolProps): ToolSnapshot | undefined {
  const file = p.input.path || ""
  const content = p.input.content || ""
  if (!file && !content) {
    return undefined
  }

  return {
    kind: "code",
    title: `# Wrote ${displayPath(p, file)}`,
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
        title: `# Edited ${displayPath(p, file)}`,
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
        title: patchTitle(file, p.frame.directory),
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
  const kind = Locale.titlecase(p.input.agent || "general")
  const desc = p.input.description
  const rows = [desc].filter((item): item is string => Boolean(item))

  return {
    kind: "task",
    title: `# ${kind} Subagent`,
    rows,
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
  const formatted = wd && wd !== "." ? displayPath(p, wd) : ""
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
  const wd = wdRaw ? displayPath(p, wdRaw) : ""
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

  const code = p.metadata.exit ?? finiteNumber(p.frame.meta.exitCode) ?? finiteNumber(p.frame.meta.exit_code)
  const time = span(p.frame)
  if (code === undefined) {
    if (!time) {
      return "shell completed"
    }

    return `shell completed · ${time}`
  }

  return `shell completed (exit ${code})${time ? ` · ${time}` : ""}`
}

function scrollReadStart(p: ToolProps): string {
  const file = displayPath(p, p.input.path)
  const extra = primitiveInputSummary(p.frame.input, ["path"])
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

function patchLine(file: PatchFile, directory?: string): string {
  if (file.status === "added") {
    return `+ Created ${toolPath(file.file, { directory })}`
  }

  if (file.status === "deleted") {
    return `- Deleted ${toolPath(file.file, { directory })}`
  }
  if (file.status === "moved") {
    return `→ Moved ${toolPath(file.from, { directory })} → ${toolPath(file.file, { directory })}`
  }

  return `~ Patched ${toolPath(file.file, { directory })}`
}

function scrollPatchFinal(p: ToolProps): string {
  if (p.frame.status === "error") {
    return fail(p.frame)
  }

  const files = list<PatchFile>(p.frame.meta.files)
  if (files.length === 0) {
    const time = span(p.frame)
    if (!time) {
      return "patch"
    }

    return `patch · ${time}`
  }

  const showModified = !files.some((file) => file?.status && file.status !== "modified")
  const shown = files.filter((file) => showModified || file.status !== "modified")
  const rows = shown.slice(0, 6).map((file) => patchLine(file, p.frame.directory))
  if (shown.length > 6) {
    rows.push(`... and ${shown.length - 6} more`)
  }

  if (rows.length > 0) {
    return rows.join("\n")
  }

  return patchLine(files[0]!, p.frame.directory)
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

  const kind = Locale.titlecase(p.input.agent || "general")
  const row = p.input.description
  if (!row) {
    return `# ${kind} Subagent`
  }

  return `# ${kind} Subagent\n${row}`
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
  return `→ ${lspTitle(p.input, { directory: p.frame.directory })}`
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

  return `${head} in ${displayPath(p, dir)}`
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

  return `${head} in ${displayPath(p, dir)}`
}

function scrollListStart(p: ToolProps): string {
  const dir = text(dict(p.input).path)
  if (!dir) {
    return "→ List"
  }

  return `→ List ${displayPath(p, dir)}`
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

function frame(part: SessionMessageAssistantTool, directory?: string): ToolFrame {
  const tool = normalizeTool(part)
  if (tool.state.status === "streaming")
    return {
      directory,
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
  const output = toolOutputText(tool.name, tool.state.content)
  return {
    directory,
    raw: output,
    name: tool.name,
    input: normalizeInput(tool.name, tool.state.input),
    meta: normalizeStructured(tool.name, tool.state.structured),
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

export function toolFrame(commit: StreamCommit, raw: string): ToolFrame {
  const current = commit.part ? frame(commit.part, commit.directory) : undefined
  return {
    directory: commit.directory,
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

export function toolInlineInfo(part: SessionMessageAssistantTool, directory?: string): ToolInline {
  const ctx = frame(part, directory)
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

const STRUCTURED_FALLBACK_LENGTH = 4_096

function structuredFallback(value: ToolDict): RunEntryBody | undefined {
  if (Object.keys(value).length === 0) return
  const content = JSON.stringify(value, null, 2)
  if (!content) return
  const suffix = "\n... [truncated]"
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
      return structuredBody(commit, raw) ?? textBody(toolScroll("final", ctx))
    }

    if (!rule(ctx.name) && !ctx.output.trim()) {
      return structuredFallback(ctx.meta) ?? textBody(toolScroll("final", ctx))
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
