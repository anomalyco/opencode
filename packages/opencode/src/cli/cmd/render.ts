import path from "path"
import { UI } from "../ui"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { Tool } from "@/tool/tool"
import { GlobTool } from "../../tool/glob"
import { GrepTool } from "../../tool/grep"
import { ReadTool } from "../../tool/read"
import { WebFetchTool } from "../../tool/webfetch"
import { EditTool } from "../../tool/edit"
import { WriteTool } from "../../tool/write"
import { WebSearchTool } from "../../tool/websearch"
import { TaskTool } from "../../tool/task"
import { SkillTool } from "../../tool/skill"
import { ShellTool } from "../../tool/shell"
import { ShellID } from "../../tool/shell/id"
import { TodoWriteTool } from "../../tool/todo"
import { Locale } from "@/util/locale"

// --- Syntax Highlighting (Static Bundling for Binary Distribution) ---
let highlighter: any = null

export async function initHighlighter() {
  if (highlighter) return
  try {
    const { createHighlighterCore } = await import("shiki/core")
    const { createJavaScriptEngine } = await import("shiki/engine/javascript")

    // Import themes and languages statically so they are bundled by Bun
    const nord = (await import("shiki/themes/nord.mjs")).default
    const ts = (await import("shiki/langs/typescript.mjs")).default
    const js = (await import("shiki/langs/javascript.mjs")).default
    const go = (await import("shiki/langs/go.mjs")).default
    const py = (await import("shiki/langs/python.mjs")).default
    const json = (await import("shiki/langs/json.mjs")).default
    const sh = (await import("shiki/langs/bash.mjs")).default
    const md = (await import("shiki/langs/markdown.mjs")).default
    const diff = (await import("shiki/langs/diff.mjs")).default

    highlighter = await createHighlighterCore({
      themes: [nord],
      langs: [ts, js, go, py, json, sh, md, diff],
      engine: createJavaScriptEngine()
    })
  } catch (e) {
    highlighter = null
  }
}

export function colorizeCode(code: string, lang: string): string {
  if (!highlighter) return code
  try {
    return highlighter.codeToAnsi(code, {
      lang: lang || "text",
      theme: "nord",
    })
  } catch {
    return code
  }
}
// ---------------------------

export type Inline = {
  icon: string
  title: string
  description?: string
}

type ToolProps<T> = {
  input: Tool.InferParameters<T>
  metadata: Tool.InferMetadata<T>
  part: ToolPart
}

function props<T>(part: ToolPart): ToolProps<T> {
  const state = part.state
  return {
    input: state.input as Tool.InferParameters<T>,
    metadata: ("metadata" in state ? state.metadata : {}) as Tool.InferMetadata<T>,
    part,
  }
}

export function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function block(info: Inline, output?: string) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  UI.println(output)
  UI.empty()
}

function fallback(part: ToolPart) {
  const state = part.state
  const input = "input" in state ? state.input : undefined
  const title =
    ("title" in state && state.title ? state.title : undefined) ||
    (input && typeof input === "object" && Object.keys(input).length > 0 ? JSON.stringify(input) : "Unknown")
  inline({
    icon: "⚙",
    title: `${part.tool} ${title}`,
  })
}

function glob(info: ToolProps<typeof GlobTool>) {
  const root = info.input.path ?? ""
  const title = `Glob "${info.input.pattern}"`
  const suffix = root ? `in ${normalizePath(root)}` : ""
  const num = info.metadata.count
  const description =
    num === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${num} ${num === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title,
    ...(description && { description }),
  })
}

function grep(info: ToolProps<typeof GrepTool>) {
  const root = info.input.path ?? ""
  const title = `Grep "${info.input.pattern}"`
  const suffix = root ? `in ${normalizePath(root)}` : ""
  const num = info.metadata.matches
  const description =
    num === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${num} ${num === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title,
    ...(description && { description }),
  })
}

function read(info: ToolProps<typeof ReadTool>) {
  const file = normalizePath(info.input.filePath)
  const pairs = Object.entries(info.input).filter(([key, value]) => {
    if (key === "filePath") return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  const description = pairs.length ? `[${pairs.map(([key, value]) => `${key}=${value}`).join(", ")}]` : undefined
  inline({
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  })
}

function write(info: ToolProps<typeof WriteTool>) {
  block(
    {
      icon: "←",
      title: `Write ${normalizePath(info.input.filePath)}`,
    },
    info.part.state.status === "completed" ? info.part.state.output : undefined,
  )
}

function webfetch(info: ToolProps<typeof WebFetchTool>) {
  inline({
    icon: "%",
    title: `WebFetch ${info.input.url}`,
  })
}

function edit(info: ToolProps<typeof EditTool>) {
  const title = normalizePath(info.input.filePath)
  const diff = info.metadata.diff
  block(
    {
      icon: "←",
      title: `Edit ${title}`,
    },
    diff ? colorizeDiff(diff) : undefined,
  )
}

export function colorizeDiff(diff: string): string {
  const width = process.stdout.columns || 80
  const REMOVED_BG = "\x1b[48;5;52m"
  const ADDED_BG = "\x1b[48;5;22m"
  const RESET = "\x1b[0m"
  const GUTTER = 4

  const gutter = (n: number) => String(n).padStart(GUTTER, " ")
  const pad = (s: string) => s + " ".repeat(Math.max(0, width - Bun.stringWidth(s)))

  let oldLine = 0
  let newLine = 0

  return diff
    .split("\n")
    .filter((line) => {
      if (line.startsWith("Index:")) return false
      if (line.startsWith("===")) return false
      if (line.startsWith("---") || line.startsWith("+++")) return false
      return true
    })
    .map((line) => {
      if (line.startsWith("@@")) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (m) {
          oldLine = parseInt(m[1], 10)
          newLine = parseInt(m[2], 10)
        }
        return UI.Style.TEXT_DIM + line + UI.Style.TEXT_NORMAL
      }
      if (line.startsWith("-")) {
        const out = pad(gutter(oldLine) + " " + line)
        oldLine++
        return REMOVED_BG + out + RESET
      }
      if (line.startsWith("+")) {
        const out = pad(gutter(newLine) + " " + line)
        newLine++
        return ADDED_BG + out + RESET
      }
      const out = UI.Style.TEXT_DIM + gutter(newLine) + UI.Style.TEXT_NORMAL + " " + line
      oldLine++
      newLine++
      return out
    })
    .join("\n")
}

export function isDiff(text: string): boolean {
  const lines = text.split("\n").slice(0, 5)
  return lines.some((l) => l.startsWith("@@ -") || l.startsWith("diff --git ") || l.startsWith("--- "))
}

function websearch(info: ToolProps<typeof WebSearchTool>) {
  inline({
    icon: "◈",
    title: `Exa Web Search "${info.input.query}"`,
  })
}

function task(info: ToolProps<typeof TaskTool>) {
  const input = info.part.state.input
  const status = info.part.state.status
  const subagent =
    typeof input.subagent_type === "string" && input.subagent_type.trim().length > 0 ? input.subagent_type : "unknown"
  const agent = Locale.titlecase(subagent)
  const desc =
    typeof input.description === "string" && input.description.trim().length > 0 ? input.description : undefined
  const icon = status === "error" ? "✗" : status === "running" ? "•" : "✓"
  const name = desc ?? `${agent} Task`
  inline({
    icon,
    title: name,
    description: desc ? `${agent} Agent` : undefined,
  })
}

function skill(info: ToolProps<typeof SkillTool>) {
  inline({
    icon: "→",
    title: `Skill "${info.input.name}"`,
  })
}

function shell(info: ToolProps<typeof ShellTool>) {
  let output = info.part.state.status === "completed" ? info.part.state.output?.trim() : undefined
  if (output && (info.input.command.includes("diff") || isDiff(output))) {
    output = colorizeDiff(output)
  }
  block(
    {
      icon: "$",
      title: `${info.input.command}`,
    },
    output,
  )
}

function todo(info: ToolProps<typeof TodoWriteTool>) {
  block(
    {
      icon: "#",
      title: "Todos",
    },
    info.input.todos.map((item) => `${item.status === "completed" ? "[x]" : "[ ]"} ${item.content}`).join("\n"),
  )
}

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) return path.relative(process.cwd(), input) || "."
  return input
}

export function renderTool(part: ToolPart) {
  try {
    if (part.tool === ShellID.ToolID) return shell(props<typeof ShellTool>(part))
    if (part.tool === "glob") return glob(props<typeof GlobTool>(part))
    if (part.tool === "grep") return grep(props<typeof GrepTool>(part))
    if (part.tool === "read") return read(props<typeof ReadTool>(part))
    if (part.tool === "write") return write(props<typeof WriteTool>(part))
    if (part.tool === "webfetch") return webfetch(props<typeof WebFetchTool>(part))
    if (part.tool === "edit") return edit(props<typeof EditTool>(part))
    if (part.tool === "websearch") return websearch(props<typeof WebSearchTool>(part))
    if (part.tool === "task") return task(props<typeof TaskTool>(part))
    if (part.tool === "todowrite") return todo(props<typeof TodoWriteTool>(part))
    if (part.tool === "skill") return skill(props<typeof SkillTool>(part))
    return fallback(part)
  } catch {
    return fallback(part)
  }
}

export function renderRunningTask(part: ToolPart) {
  task(props<typeof TaskTool>(part))
}
