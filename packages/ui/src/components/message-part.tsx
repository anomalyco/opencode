import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation } from "@solidjs/router"
import stripAnsi from "strip-ansi"
import { Dynamic } from "solid-js/web"
import {
  AssistantMessage,
  AgentPart,
  FilePart,
  Message as MessageType,
  Part as PartType,
  ReasoningPart,
  TextPart,
  ToolPart,
  UserMessage,
  Todo,
  QuestionAnswer,
  QuestionInfo,
} from "@opencode-ai/sdk/v2"
import { useData } from "../context"
import { useFileComponent } from "../context/file"
import { useDialog } from "../context/dialog"
import { type UiI18n, useI18n } from "../context/i18n"
import { BasicTool, GenericTool } from "./basic-tool"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { Card } from "./card"
import { Collapsible } from "./collapsible"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { ToolErrorCard } from "./tool-error-card"
import { Checkbox } from "./checkbox"
import { DiffChanges } from "./diff-changes"
import { Markdown } from "./markdown"
import type { MarkdownStage } from "./markdown"
import { ImagePreview } from "./image-preview"
import { getDirectory as _getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { checksum } from "@opencode-ai/core/util/encode"
import { Tooltip } from "./tooltip"
import { IconButton } from "./icon-button"
import { TextShimmer } from "./text-shimmer"
import { AnimatedCountList } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"
import { Spinner } from "./spinner"
import { animate } from "motion"
import { attached, inline, kind } from "./message-file"
import { skillText } from "./message-skill"
import { hookName, isCustomHookTool, normalizeTool } from "./tool-meta"
import {
  groupParts as groupOrderedParts,
  orderTextReasoningSegments,
  type PartGroup,
} from "./message-part-order"
export type { PartGroup } from "./message-part-order"

type ProviderSummary = {
  id?: string
  name?: string
  models?: Record<string, { name?: string } | undefined>
}

function providerByID(all: unknown, providerID: string): ProviderSummary | undefined {
  if (!all) return undefined
  if (all instanceof Map) return all.get(providerID) as ProviderSummary | undefined
  if (Array.isArray(all)) {
    return all.find((item): item is ProviderSummary => {
      if (!item || typeof item !== "object") return false
      return (item as ProviderSummary).id === providerID
    })
  }
  const get = (all as { get?: unknown }).get
  if (typeof get === "function") return get.call(all, providerID) as ProviderSummary | undefined
  return undefined
}

function ShellSubmessage(props: { text: string; animate?: boolean }) {
  let widthRef: HTMLSpanElement | undefined
  let valueRef: HTMLSpanElement | undefined

  onMount(() => {
    if (!props.animate) return
    requestAnimationFrame(() => {
      if (widthRef) {
        animate(widthRef, { width: "auto" }, { type: "spring", visualDuration: 0.25, bounce: 0 })
      }
      if (valueRef) {
        animate(valueRef, { opacity: 1, filter: "blur(0px)" }, { duration: 0.32, ease: [0.16, 1, 0.3, 1] })
      }
    })
  })

  return (
    <span data-component="shell-submessage">
      <span ref={widthRef} data-slot="shell-submessage-width" style={{ width: props.animate ? "0px" : undefined }}>
        <span data-slot="basic-tool-tool-subtitle">
          <span
            ref={valueRef}
            data-slot="shell-submessage-value"
            style={props.animate ? { opacity: 0, filter: "blur(2px)" } : undefined}
          >
            {props.text}
          </span>
        </span>
      </span>
    </span>
  )
}

interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
}

function formatQuestionPart(part: string | { type: "image"; url: string; mime: string; filename?: string }) {
  if (typeof part === "string") return part
  return part.filename ? `[image: ${part.filename}]` : "[image]"
}

function getDiagnostics(
  diagnosticsByFile: Record<string, Diagnostic[]> | undefined,
  filePath: string | undefined,
): Diagnostic[] {
  if (!diagnosticsByFile || !filePath) return []
  const diagnostics = diagnosticsByFile[filePath] ?? []
  return diagnostics.filter((d) => d.severity === 1).slice(0, 3)
}

function DiagnosticsDisplay(props: { diagnostics: Diagnostic[] }): JSX.Element {
  const i18n = useI18n()
  return (
    <Show when={props.diagnostics.length > 0}>
      <div data-component="diagnostics">
        <For each={props.diagnostics}>
          {(diagnostic) => (
            <div data-slot="diagnostic">
              <span data-slot="diagnostic-label">{i18n.t("ui.messagePart.diagnostic.error")}</span>
              <span data-slot="diagnostic-location">
                [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]
              </span>
              <span data-slot="diagnostic-message">{diagnostic.message}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

export interface MessageProps {
  message: MessageType
  parts: PartType[]
  actions?: UserActions
  showAssistantCopyPartID?: string | null
  interrupted?: boolean
  showReasoningSummaries?: boolean
  showCustomHookParts?: boolean
  markdownEager?: boolean
  markdownViewport?: HTMLDivElement
  markdownHighlight?: "full" | "defer"
  markdownMath?: "full" | "defer"
  markdownStage?: MarkdownStage
  onMarkdownStage?: (key: string, stage: MarkdownStage | undefined) => void
}

export type SessionAction = (input: { sessionID: string; messageID: string }) => Promise<void> | void

export type UserActions = {
  fork?: SessionAction
  revert?: SessionAction
}

export interface MessagePartProps {
  part: PartType
  message: MessageType
  hideDetails?: boolean
  defaultOpen?: boolean
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  markdownEager?: boolean
  markdownViewport?: HTMLDivElement
  markdownHighlight?: "full" | "defer"
  markdownMath?: "full" | "defer"
  markdownStage?: MarkdownStage
  onMarkdownStage?: (key: string, stage: MarkdownStage | undefined) => void
}

export type PartComponent = Component<MessagePartProps>

export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

const LIVE_TEXT_MIN_CHARS = 2
const LIVE_TEXT_MAX_CHARS = 48

function nextLiveText(current: string, target: string) {
  if (!target.startsWith(current)) return target
  if (current.length >= target.length) return target

  const remaining = target.length - current.length
  const size = Math.max(
    LIVE_TEXT_MIN_CHARS,
    Math.min(LIVE_TEXT_MAX_CHARS, Math.ceil(remaining / 5), remaining > 160 ? 32 : 12),
  )
  let end = Math.min(target.length, current.length + size)

  // Avoid leaving a single punctuation/whitespace character stranded for the
  // next paint; it reads as smoother without waiting for fixed-size chunks.
  while (end < target.length && end - current.length < LIVE_TEXT_MAX_CHARS) {
    const char = target[end]
    if (!char || !/[\s.,;:!?)}\]'"`]/.test(char)) break
    end += 1
  }

  return target.slice(0, end)
}

function createLiveValue(getValue: () => string) {
  const [value, setValue] = createSignal(getValue())
  let rafId: number | undefined
  let target = getValue()

  const step = () => {
    rafId = undefined
    const current = value()
    const next = nextLiveText(current, target)
    if (next !== current) setValue(next)
    if (next !== target) schedule()
  }

  const schedule = () => {
    if (rafId !== undefined) return
    rafId = requestAnimationFrame(() => {
      step()
    })
  }

  createEffect(() => {
    target = getValue()
    if (target.length < value().length || !target.startsWith(value())) {
      setValue(target)
      return
    }
    schedule()
  })

  onCleanup(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId)
  })

  return value
}

function createLiveText(getValue: () => string, active: () => boolean) {
  const [value, setValue] = createSignal(getValue())
  const live = createLiveValue(getValue)

  createEffect(() => {
    if (active()) {
      setValue(live())
      return
    }
    setValue(getValue())
  })

  return value
}

function clip(text: string, size = 40) {
  return JSON.stringify(text.slice(-size))
}

function relativizeProjectPath(path: string, directory?: string) {
  if (!path) return ""
  if (!directory) return path
  if (directory === "/") return path
  if (directory === "\\") return path
  if (path === directory) return ""

  const separator = directory.includes("\\") ? "\\" : "/"
  const prefix = directory.endsWith(separator) ? directory : directory + separator
  if (!path.startsWith(prefix)) return path
  return path.slice(directory.length)
}

function getDirectory(path: string | undefined) {
  const data = useData()
  return relativizeProjectPath(_getDirectory(path), data.directory)
}

import type { IconProps } from "./icon"

export type ToolInfo = {
  icon: IconProps["name"]
  title: string
  subtitle?: string
}

function text(value: unknown) {
  if (typeof value !== "string") return
  const next = value.trim()
  if (!next) return
  return next
}

// OpenClaw tool payloads commonly use path/file_path while built-in tools use filePath.
function file(input: Record<string, unknown>) {
  return text(input.filePath) ?? text(input.file_path) ?? text(input.path)
}

// OpenClaw exec payloads commonly use cmd while built-in bash uses command.
function cmd(input: Record<string, unknown>, metadata?: Record<string, unknown>) {
  return text(input.command) ?? text(input.cmd) ?? text(metadata?.command) ?? text(metadata?.cmd)
}

function hookType(input: Record<string, any>, metadata: Record<string, any>) {
  const keys = ["hook_type", "hookType", "stage", "phase", "event_type", "eventType"]
  for (const src of [metadata, input]) {
    for (const key of keys) {
      const value = text(src?.[key])
      if (value) return value
    }
  }

  const desc = text(input.description) ?? text(metadata.description)
  if (!desc) return
  const phase = /\bbefore\b/i.test(desc) ? "before" : /\bafter\b/i.test(desc) ? "after" : ""
  const event = desc.match(/([a-z]+(?:\.[a-z_]+)+(?:\.(?:before|after))?)/i)?.[1]
  if (phase && event) return `${phase} ${event}`
  if (phase) return phase
  if (event) return event
}

function agentTitle(i18n: UiI18n, type?: string) {
  if (!type) return i18n.t("ui.tool.agent.default")
  return i18n.t("ui.tool.agent", { type })
}

export function getToolInfo(tool: string, input: any = {}, metadata: any = {}): ToolInfo {
  const i18n = useI18n()
  switch (tool) {
    case "read":
      return {
        icon: "glasses",
        title: i18n.t("ui.tool.read"),
        subtitle: file(input) ? getFilename(file(input)!) : undefined,
      }
    case "list":
      return {
        icon: "bullet-list",
        title: i18n.t("ui.tool.list"),
        subtitle: input.path ? getFilename(input.path) : undefined,
      }
    case "glob":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.glob"),
        subtitle: input.pattern,
      }
    case "grep":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.grep"),
        subtitle: input.pattern,
      }
    case "webfetch":
      return {
        icon: "window-cursor",
        title: i18n.t("ui.tool.webfetch"),
        subtitle: input.url,
      }
    case "websearch":
      return {
        icon: "window-cursor",
        title: i18n.t("ui.tool.websearch"),
        subtitle: input.query,
      }
    case "codesearch":
      return {
        icon: "code",
        title: i18n.t("ui.tool.codesearch"),
        subtitle: input.query,
      }
    case "task": {
      const type =
        typeof input.subagent_type === "string" && input.subagent_type
          ? input.subagent_type[0]!.toUpperCase() + input.subagent_type.slice(1)
          : undefined
      return {
        icon: "task",
        title: agentTitle(i18n, type),
        subtitle: input.description,
      }
    }
    case "bash":
    case "hook":
    case "exec":
      const hook = hookName(input, metadata)
      const type = hookType(input, metadata)
      return {
        icon: "console",
        title: hook ?? (tool === "exec" ? "Exec" : i18n.t("ui.tool.shell")),
        subtitle: hook ? type : (text(input.description) ?? text(metadata.description) ?? cmd(input, metadata)),
      }
    case "edit":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.edit"),
        subtitle: input.filePath ? getFilename(input.filePath) : undefined,
      }
    case "write":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.write"),
        subtitle: input.filePath ? getFilename(input.filePath) : undefined,
      }
    case "apply_patch":
      return {
        icon: "code-lines",
        title: i18n.t("ui.tool.patch"),
        subtitle: input.files?.length
          ? `${input.files.length} ${i18n.t(input.files.length > 1 ? "ui.common.file.other" : "ui.common.file.one")}`
          : undefined,
      }
    case "todowrite":
      return {
        icon: "checklist",
        title: i18n.t("ui.tool.todos"),
      }
    case "question":
      return {
        icon: "bubble-5",
        title: i18n.t("ui.tool.questions"),
      }
    case "skill":
      return {
        icon: "brain",
        title: input.name || i18n.t("ui.tool.skill"),
      }
    default:
      return {
        icon: "mcp",
        title: tool,
      }
  }
}

function urls(text: string | undefined) {
  if (!text) return []
  const seen = new Set<string>()
  return [...text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)]
    .map((item) => item[0].replace(/[),.;:!?]+$/g, ""))
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function sessionLink(id: string | undefined, path: string, href?: (id: string) => string | undefined) {
  if (!id) return

  const direct = href?.(id)
  if (direct) return direct

  const idx = path.indexOf("/session")
  if (idx === -1) return
  return `${path.slice(0, idx)}/session/${id}`
}
const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"])
function toolName(part: { tool: string }) {
  return normalizeTool(part.tool)
}

function isGenericAgentMessage(message: MessageType) {
  return "agent" in message && message.agent === "genericagent"
}

type GenericAgentTextSegment =
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; input: Record<string, unknown>; output: string }

function parseGenericAgentToolInput(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    return { input }
  }
  return { input }
}

// Matches both GenericAgent tool-call serialisations emitted by agent_loop.py:
//   verbose=True  →  "🛠️ Tool: `name`  📥 args:\n````text\n{json}\n````\n`````\n{output}\n`````"
//   verbose=False →  "🛠️ name(compact_args)" on a single line (default in the
//                    opencode bridge_shim, which forces agent.verbose=False)
// The compact form has no trailing output block (the underlying tool's yields
// are exhausted by agent_loop without being forwarded to the UI).
const GENERIC_AGENT_TOOL_PATTERN =
  /🛠️\s+(?:Tool:\s*`([^`]+)`\s*📥\s*args:[ \t]*\n`{4}text\n([\s\S]*?)\n`{4}[ \t]*(?:\n`{5}\n([\s\S]*?)\n`{5})?|([\w]+)\(([^\n]*)\)[ \t]*$)/gm

function parseGenericAgentCompactArgs(name: string, raw: string): Record<string, unknown> {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return {}
  // _compact_tool_args truncates long payloads with a literal "..." suffix and
  // emits bare strings (not JSON) for a couple of special tools. Try JSON first
  // then fall back to a synthesised shape so the tool card still renders.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // fall through to heuristics below
    }
  }
  if (name === "update_working_checkpoint") return { key_info: trimmed }
  if (name === "ask_user") return { question: trimmed }
  return { input: trimmed }
}

function parseGenericAgentToolText(text: string): GenericAgentTextSegment[] {
  const segments: GenericAgentTextSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(GENERIC_AGENT_TOOL_PATTERN)) {
    const start = match.index ?? 0
    const before = text.slice(cursor, start).replace(/\n{3,}/g, "\n\n").trim()
    if (before) segments.push({ type: "text", text: before })

    if (match[1] !== undefined) {
      // verbose form
      segments.push({
        type: "tool",
        tool: match[1] || "tool",
        input: parseGenericAgentToolInput(match[2] || "{}"),
        output: match[3] || "",
      })
    } else {
      // compact form
      const tool = match[4] || "tool"
      segments.push({
        type: "tool",
        tool,
        input: parseGenericAgentCompactArgs(tool, match[5] || ""),
        output: "",
      })
    }
    cursor = start + match[0].length
  }

  const rest = text.slice(cursor).replace(/\n{3,}/g, "\n\n").trim()
  if (rest) segments.push({ type: "text", text: rest })
  return segments
}

function customPart(part: ToolPart) {
  const metadata = part.state.status === "pending" ? {} : (part.state.metadata ?? {})
  const input = part.state.input ?? {}
  return isCustomHookTool(part.tool, input, metadata)
}

function list<T>(value: T[] | undefined | null, fallback: T[]) {
  if (Array.isArray(value)) return value
  return fallback
}

function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

export function groupParts(parts: { messageID: string; part: PartType }[]) {
  return groupOrderedParts(parts, isContextGroupTool)
}

function index<T extends { id: string }>(items: readonly T[]) {
  return new Map(items.map((item) => [item.id, item] as const))
}

export function renderable(part: PartType, showReasoningSummaries = true, showCustomHookParts = true) {
  if (part.type === "tool") {
    const tool = toolName(part)
    if (HIDDEN_TOOLS.has(tool)) return false
    if (!showCustomHookParts && customPart(part)) return false
    if (tool === "question") return part.state.status !== "pending"
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!part.text?.trim()
  return !!PART_MAPPING[part.type]
}

function toolDefaultOpen(tool: string, shell = false, edit = false) {
  if (tool === "bash") return shell
  if (tool === "edit" || tool === "write" || tool === "apply_patch") return edit
}

function partDefaultOpen(part: PartType, shell = false, edit = false) {
  if (part.type !== "tool") return
  return toolDefaultOpen(part.tool, shell, edit)
}

export function AssistantParts(props: {
  messages: AssistantMessage[]
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  working?: boolean
  showReasoningSummaries?: boolean
  showCustomHookParts?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  markdownEager?: boolean
  markdownViewport?: HTMLDivElement
  markdownHighlight?: "full" | "defer"
  markdownMath?: "full" | "defer"
  markdownStage?: MarkdownStage
  onMarkdownStage?: (key: string, stage: MarkdownStage | undefined) => void
}) {
  const data = useData()
  const emptyParts: PartType[] = []

  const grouped = createMemo(() => {
    const keys: string[] = []
    const items: Record<
      string,
      { type: "part"; part: PartType; message: AssistantMessage } | { type: "context"; parts: ToolPart[] }
    > = {}
    const push = (
      key: string,
      item: { type: "part"; part: PartType; message: AssistantMessage } | { type: "context"; parts: ToolPart[] },
    ) => {
      keys.push(key)
      items[key] = item
    }

    let ctx: ToolPart[] = []
    let ctxKey = ""

    const flush = () => {
      if (ctx.length === 0) return
      push(ctxKey, { type: "context", parts: ctx })
      ctx = []
      ctxKey = ""
    }

    for (const message of props.messages) {
      const parts = orderTextReasoningSegments(
        list(data.store.part?.[message.id], emptyParts).filter((part) =>
          renderable(part, props.showReasoningSummaries ?? true, props.showCustomHookParts ?? true),
        ),
        (part) => part,
      )

      for (const part of parts) {
        if (isContextGroupTool(part)) {
          if (ctx.length === 0) ctxKey = `context:${part.id}`
          ctx.push(part)
          continue
        }
        flush()
        push(`part:${message.id}:${part.id}`, { type: "part", part, message })
      }
    }

    flush()

    return { keys, items }
  })

  const last = createMemo(() => grouped()?.keys.at(-1))

  return (
    <For each={grouped()?.keys ?? []}>
      {(key) => {
        const item = createMemo(() => grouped().items[key])
        const ctx = createMemo(() => {
          const value = item()
          if (!value) return
          if (value.type !== "context") return
          return value
        })
        const part = createMemo(() => {
          const value = item()
          if (!value) return
          if (value.type !== "part") return
          return value
        })
        const tail = createMemo(() => last() === key)
        return (
          <>
            <Show when={ctx()}>
              {(entry) => <ContextToolGroup parts={entry().parts} busy={props.working && tail()} />}
            </Show>
            <Show when={part()}>
              {(entry) => (
                <Part
                  part={entry().part}
                  message={entry().message}
                  showAssistantCopyPartID={props.showAssistantCopyPartID}
                  turnDurationMs={props.turnDurationMs}
                  defaultOpen={partDefaultOpen(entry().part, props.shellToolDefaultOpen, props.editToolDefaultOpen)}
                  markdownEager={props.markdownEager}
                  markdownViewport={props.markdownViewport}
                  markdownHighlight={props.markdownHighlight}
                  markdownMath={props.markdownMath}
                  markdownStage={props.markdownStage}
                  onMarkdownStage={props.onMarkdownStage}
                />
              )}
            </Show>
          </>
        )
      }}
    </For>
  )
}

function isContextGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(toolName(part))
}

function contextToolDetail(part: ToolPart): string | undefined {
  const metadata = part.state.status === "pending" ? {} : (part.state.metadata ?? {})
  const info = getToolInfo(toolName(part), part.state.input ?? {}, metadata)
  if (info.subtitle) return info.subtitle
  if (part.state.status === "error") return part.state.error
  if ((part.state.status === "running" || part.state.status === "completed") && part.state.title)
    return part.state.title
  const description = part.state.input?.description
  if (typeof description === "string") return description
  return undefined
}

function contextToolTrigger(part: ToolPart, i18n: ReturnType<typeof useI18n>) {
  const data = useData()
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const path = typeof input.path === "string" ? input.path : "/"
  const filePath = file(input)
  const pattern = typeof input.pattern === "string" ? input.pattern : undefined
  const include = typeof input.include === "string" ? input.include : undefined
  const offset = typeof input.offset === "number" ? input.offset : undefined
  const limit = typeof input.limit === "number" ? input.limit : undefined

  switch (toolName(part)) {
    case "read": {
      const args: string[] = []
      if (offset !== undefined) args.push("offset=" + offset)
      if (limit !== undefined) args.push("limit=" + limit)
      const subtitle = filePath ? relativizeProjectPath(filePath, data.directory) || filePath : ""
      return {
        title: i18n.t("ui.tool.read"),
        subtitle,
        args,
      }
    }
    case "list":
      return {
        title: i18n.t("ui.tool.list"),
        subtitle: getDirectory(path),
      }
    case "glob":
      return {
        title: i18n.t("ui.tool.glob"),
        subtitle: getDirectory(path),
        args: pattern ? ["pattern=" + pattern] : [],
      }
    case "grep": {
      const args: string[] = []
      if (pattern) args.push("pattern=" + pattern)
      if (include) args.push("include=" + include)
      return {
        title: i18n.t("ui.tool.grep"),
        subtitle: getDirectory(path),
        args,
      }
    }
    default: {
      const info = getToolInfo(toolName(part), input)
      return {
        title: info.title,
        subtitle: info.subtitle || contextToolDetail(part),
        args: [],
      }
    }
  }
}

function contextToolSummary(parts: ToolPart[], i18n: ReturnType<typeof useI18n>) {
  const read = parts.filter((part) => part.tool === "read").length
  const search = parts.filter((part) => part.tool === "glob" || part.tool === "grep").length
  const list = parts.filter((part) => part.tool === "list").length
  return [
    read
      ? i18n.t(read === 1 ? "ui.messagePart.context.read.one" : "ui.messagePart.context.read.other", { count: read })
      : undefined,
    search
      ? i18n.t(search === 1 ? "ui.messagePart.context.search.one" : "ui.messagePart.context.search.other", {
          count: search,
        })
      : undefined,
    list
      ? i18n.t(list === 1 ? "ui.messagePart.context.list.one" : "ui.messagePart.context.list.other", { count: list })
      : undefined,
  ].filter((value): value is string => !!value)
}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

export function Message(props: MessageProps) {
  return (
    <Switch>
      <Match when={props.message.role === "user" && props.message}>
        {(userMessage) => (
          <UserMessageDisplay
            message={userMessage() as UserMessage}
            parts={props.parts}
            actions={props.actions}
            interrupted={props.interrupted}
            showCustomHookParts={props.showCustomHookParts}
            markdownEager={props.markdownEager}
            markdownViewport={props.markdownViewport}
            markdownHighlight={props.markdownHighlight}
            markdownMath={props.markdownMath}
          />
        )}
      </Match>
      <Match when={props.message.role === "assistant" && props.message}>
        {(assistantMessage) => (
          <AssistantMessageDisplay
            message={assistantMessage() as AssistantMessage}
            parts={props.parts}
            showAssistantCopyPartID={props.showAssistantCopyPartID}
            showReasoningSummaries={props.showReasoningSummaries}
            showCustomHookParts={props.showCustomHookParts}
            markdownEager={props.markdownEager}
            markdownHighlight={props.markdownHighlight}
            markdownMath={props.markdownMath}
          />
        )}
      </Match>
    </Switch>
  )
}

export function AssistantMessageDisplay(props: {
  message: AssistantMessage
  parts: PartType[]
  showAssistantCopyPartID?: string | null
  showReasoningSummaries?: boolean
  showCustomHookParts?: boolean
  markdownEager?: boolean
  markdownHighlight?: "full" | "defer"
  markdownMath?: "full" | "defer"
}) {
  const grouped = createMemo(() => {
    const keys: string[] = []
    const items: Record<string, { type: "part"; part: PartType } | { type: "context"; parts: ToolPart[] }> = {}
    const push = (key: string, item: { type: "part"; part: PartType } | { type: "context"; parts: ToolPart[] }) => {
      keys.push(key)
      items[key] = item
    }

    const parts = orderTextReasoningSegments(
      props.parts.filter((part) => renderable(part, props.showReasoningSummaries ?? true, props.showCustomHookParts ?? true)),
      (part) => part,
    )
    let start = -1

    const flush = (end: number) => {
      if (start < 0) return
      const first = parts[start]
      const last = parts[end]
      if (!first || !last) {
        start = -1
        return
      }
      push(`context:${first.id}`, {
        type: "context",
        parts: parts.slice(start, end + 1).filter((part): part is ToolPart => isContextGroupTool(part)),
      })
      start = -1
    }

    parts.forEach((part, index) => {
      if (isContextGroupTool(part)) {
        if (start < 0) start = index
        return
      }

      flush(index - 1)
      push(`part:${part.id}`, { type: "part", part })
    })

    flush(parts.length - 1)

    return { keys, items }
  })

  return (
    <For each={grouped()?.keys ?? []}>
      {(key) => {
        const item = createMemo(() => grouped()?.items[key])
        const ctx = createMemo(() => {
          const value = item()
          if (!value) return
          if (value.type !== "context") return
          return value
        })
        const part = createMemo(() => {
          const value = item()
          if (!value) return
          if (value.type !== "part") return
          return value
        })
        return (
          <>
            <Show when={ctx()}>{(entry) => <ContextToolGroup parts={entry().parts} />}</Show>
            <Show when={part()}>
              {(entry) => (
                <Part
                  part={entry().part}
                  message={props.message}
                  showAssistantCopyPartID={props.showAssistantCopyPartID}
                  markdownEager={props.markdownEager}
                  markdownMath={props.markdownMath}
                />
              )}
            </Show>
          </>
        )
      }}
    </For>
  )
}

function ContextToolGroup(props: { parts: ToolPart[]; busy?: boolean }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const pending = createMemo(
    () =>
      !!props.busy || props.parts.some((part) => part.state.status === "pending" || part.state.status === "running"),
  )
  const summary = createMemo(() => contextToolSummary(props.parts, i18n))
  const details = createMemo(() => summary().join(", "))

  return (
    <Collapsible open={open()} onOpenChange={setOpen} class="tool-collapsible">
      <Collapsible.Trigger>
        <div data-component="context-tool-group-trigger">
          <Show when={!pending()}>
            <div data-slot="context-tool-group-indicator">
              <Icon name="eye" size="small" />
            </div>
          </Show>
          <Show
            when={pending()}
            fallback={
              <span data-slot="context-tool-group-title">
                <span data-slot="context-tool-group-label">{i18n.t("ui.sessionTurn.status.gatheredContext")}</span>
                <Show when={details().length}>
                  <span data-slot="context-tool-group-summary">{details()}</span>
                </Show>
              </span>
            }
          >
            <span data-slot="context-tool-group-title">
              <span data-slot="context-tool-group-label">
                <TextShimmer text={i18n.t("ui.sessionTurn.status.gatheringContext")} />
              </span>
              <Show when={details().length}>
                <span data-slot="context-tool-group-summary">{details()}</span>
              </Show>
            </span>
          </Show>
          <Collapsible.Arrow />
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div data-component="context-tool-group-list">
          <For each={props.parts}>
            {(part) => {
              const trigger = contextToolTrigger(part, i18n)
              const running = part.state.status === "pending" || part.state.status === "running"
              return (
                <div data-slot="context-tool-group-item">
                  <div data-component="tool-trigger">
                    <div data-slot="basic-tool-tool-trigger-content">
                      <div data-slot="basic-tool-tool-info">
                        <div data-slot="basic-tool-tool-info-structured">
                          <div data-slot="basic-tool-tool-info-main">
                            <span data-slot="basic-tool-tool-title" class="tool-read">
                              <Show when={running} fallback={trigger.title}>
                                <TextShimmer text={trigger.title} />
                              </Show>
                            </span>
                            <Show when={!running && trigger.subtitle}>
                              <span data-slot="basic-tool-tool-subtitle">{trigger.subtitle}</span>
                            </Show>
                            <Show when={!running && trigger.args?.length}>
                              <For each={trigger.args}>
                                {(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}
                              </For>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}


function LazyAction(props: { children: JSX.Element; size?: "small" | "normal" }) {
  const [mounted, setMounted] = createSignal(false)
  const mount = () => setMounted(true)

  return (
    <span data-component="lazy-action" data-mounted={mounted() ? "true" : undefined} onPointerEnter={mount}>
      <Show
        when={mounted()}
        fallback={<span data-slot="lazy-action-placeholder" data-size={props.size ?? "normal"} aria-hidden="true" />}
      >
        {props.children}
      </Show>
    </span>
  )
}

export function UserMessageDisplay(props: {
  message: UserMessage
  parts: PartType[]
  actions?: UserActions
  interrupted?: boolean
  showCustomHookParts?: boolean
  markdownEager?: boolean
  markdownViewport?: HTMLDivElement
  markdownHighlight?: "full" | "defer"
  markdownMath?: "full" | "defer"
  markdownStage?: MarkdownStage
  onMarkdownStage?: (key: string, stage: MarkdownStage | undefined) => void
}) {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()
  const [state, setState] = createStore({
    copied: false,
    busy: undefined as "fork" | "revert" | undefined,
  })
  const copied = () => state.copied
  const busy = () => state.busy

  const textPart = createMemo(
    () => props.parts?.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined,
  )

  const text = createMemo(() => textPart()?.text || "")

  const skillTemplatePart = createMemo(() => skillText(props.parts))

  const files = createMemo(() => (props.parts?.filter((p) => p.type === "file") as FilePart[]) ?? [])

  const attachments = createMemo(() => files().filter(attached))

  const inlineFiles = createMemo(() => files().filter(inline))

  const agents = createMemo(() => (props.parts?.filter((p) => p.type === "agent") as AgentPart[]) ?? [])
  const hooks = createMemo(() =>
    props.parts.filter(
      (part): part is ToolPart => part.type === "tool" && renderable(part, true, props.showCustomHookParts ?? true),
    ),
  )

  const model = createMemo(() => {
    const providerID = props.message.model?.providerID
    const modelID = props.message.model?.modelID
    if (!providerID || !modelID) return ""
    const match = providerByID(data.store.provider?.all, providerID)
    return match?.models?.[modelID]?.name ?? modelID
  })
  const timefmt = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { timeStyle: "short" }))

  const provider = createMemo(() => {
    const providerID = props.message.model?.providerID
    if (!providerID) return ""
    const match = providerByID(data.store.provider?.all, providerID)
    return match?.name ?? providerID
  })

  const agent = createMemo(() => {
    const a = props.message.agent
    if (!a) return ""
    return a[0]?.toUpperCase() + a.slice(1)
  })

  const stamp = createMemo(() => {
    const created = props.message.time?.created
    if (typeof created !== "number") return ""
    return timefmt().format(created)
  })

  const metaTail = createMemo(() => {
    const items = [stamp(), props.interrupted ? i18n.t("ui.message.interrupted") : ""]
    return items.filter((x) => !!x).join("\u00A0\u00B7\u00A0")
  })
  const openImagePreview = (url: string, alt?: string) => {
    dialog.show(() => <ImagePreview src={url} alt={alt} />)
  }

  const handleCopy = async () => {
    const content = text()
    if (!content) return
    await navigator.clipboard.writeText(content)
    setState("copied", true)
    setTimeout(() => setState("copied", false), 2000)
  }

  const run = (kind: "fork" | "revert") => {
    const act = kind === "fork" ? props.actions?.fork : props.actions?.revert
    if (!act || busy()) return
    setState("busy", kind)
    void Promise.resolve()
      .then(() =>
        act({
          sessionID: props.message.sessionID,
          messageID: props.message.id,
        }),
      )
      .finally(() => {
        if (busy() === kind) setState("busy", undefined)
      })
  }

  return (
    <div data-component="user-message">
      <Show when={attachments().length > 0}>
        <div data-slot="user-message-attachments">
          <For each={attachments()}>
            {(file) => {
              const type = kind(file)
              const name = file.filename ?? i18n.t("ui.message.attachment.alt")

              return (
                <div
                  data-slot="user-message-attachment"
                  data-type={type}
                  data-clickable={type === "image" ? "true" : undefined}
                  title={type === "file" ? name : undefined}
                  onClick={() => {
                    if (type === "image") openImagePreview(file.url, name)
                  }}
                >
                  <Show
                    when={type === "image"}
                    fallback={
                      <div data-slot="user-message-attachment-file">
                        <FileIcon node={{ path: name, type: "file" }} />
                        <span data-slot="user-message-attachment-name">{name}</span>
                      </div>
                    }
                  >
                    <img data-slot="user-message-attachment-image" src={file.url} alt={name} />
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
      <Show when={text()}>
        <>
          <div data-slot="user-message-body">
            <div data-slot="user-message-text">
              <Markdown
                text={text()}
                cacheKey={textPart()?.id}
                stage={props.markdownStage}
                onStage={props.onMarkdownStage}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                highlight={props.markdownHighlight}
                math={props.markdownMath}
              />
            </div>
          </div>
          <div data-slot="user-message-meta-bar">
            <Show when={agent() || provider() || model() || metaTail()}>
              <span data-slot="user-message-meta-wrap">
                <Show when={agent()}>
                  <span data-slot="user-message-meta-agent" class="text-12-regular cursor-default">
                    {agent()}
                  </span>
                </Show>
                <Show when={agent() && (provider() || model())}>
                  <span data-slot="user-message-meta-sep" class="text-12-regular cursor-default">
                    {"\u00A0\u00B7\u00A0"}
                  </span>
                </Show>
                <Show when={provider()}>
                  <span data-slot="user-message-meta-provider" class="text-12-regular cursor-default">
                    {provider()}
                  </span>
                </Show>
                <Show when={provider() && model()}>
                  <span data-slot="user-message-meta-sep" class="text-12-regular cursor-default">
                    {"\u00A0\u00B7\u00A0"}
                  </span>
                </Show>
                <Show when={model()}>
                  <span data-slot="user-message-meta-model" class="text-12-regular cursor-default">
                    {model()}
                  </span>
                </Show>
                <Show when={(agent() || provider() || model()) && metaTail()}>
                  <span data-slot="user-message-meta-sep" class="text-12-regular cursor-default">
                    {"\u00A0\u00B7\u00A0"}
                  </span>
                </Show>
                <Show when={metaTail()}>
                  <span data-slot="user-message-meta-tail" class="text-12-regular cursor-default">
                    {metaTail()}
                  </span>
                </Show>
              </span>
            </Show>
            <div data-slot="user-message-copy-wrapper" data-interrupted={props.interrupted ? "" : undefined}>
              <Show when={props.actions?.fork}>
                <Tooltip value={i18n.t("ui.message.forkMessage")} placement="top" gutter={4} lazyMount>
                  <IconButton
                    icon="fork"
                    size="normal"
                    variant="ghost"
                    disabled={!!busy()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation()
                      run("fork")
                    }}
                    aria-label={i18n.t("ui.message.forkMessage")}
                  />
                </Tooltip>
              </Show>
              <Show when={props.actions?.revert}>
                <Tooltip value={i18n.t("ui.message.revertMessage")} placement="top" gutter={4} lazyMount>
                  <IconButton
                    icon="reset"
                    size="normal"
                    variant="ghost"
                    disabled={!!busy()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation()
                      run("revert")
                    }}
                    aria-label={i18n.t("ui.message.revertMessage")}
                  />
                </Tooltip>
              </Show>
              <Tooltip
                value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
                placement="top"
                gutter={4}
                lazyMount
              >
                <IconButton
                  icon={copied() ? "check" : "copy"}
                  size="normal"
                  variant="ghost"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleCopy()
                  }}
                  aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
                />
              </Tooltip>
            </div>
          </div>
        </>
      </Show>
      <Show when={skillTemplatePart()}>
        <BasicTool
          icon="console"
          trigger={{
            title: "Skill",
          }}
        >
          <div data-slot="user-message-skill-content">
            <Markdown
              text={skillTemplatePart()!.text}
              stage={props.markdownStage}
              onStage={props.onMarkdownStage}
              eager={props.markdownEager}
              viewport={props.markdownViewport}
              highlight={props.markdownHighlight}
              math={props.markdownMath}
            />
          </div>
        </BasicTool>
      </Show>
      <Show when={hooks().length > 0}>
        <div data-slot="user-message-hooks">
          <For each={hooks()}>
            {(part) => (
              <Part
                part={part}
                message={props.message}
                markdownEager={props.markdownEager}
                markdownViewport={props.markdownViewport}
                markdownHighlight={props.markdownHighlight}
                markdownMath={props.markdownMath}
                markdownStage={props.markdownStage}
                onMarkdownStage={props.onMarkdownStage}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export function Part(props: MessagePartProps) {
  const component = createMemo(() => PART_MAPPING[props.part.type])
  return (
    <Show when={component()}>
      <Dynamic
        component={component()}
        part={props.part}
        message={props.message}
        hideDetails={props.hideDetails}
        defaultOpen={props.defaultOpen}
        showAssistantCopyPartID={props.showAssistantCopyPartID}
        turnDurationMs={props.turnDurationMs}
        markdownEager={props.markdownEager}
        markdownViewport={props.markdownViewport}
        markdownHighlight={props.markdownHighlight}
        markdownMath={props.markdownMath}
        markdownStage={props.markdownStage}
        onMarkdownStage={props.onMarkdownStage}
      />
    </Show>
  )
}

export interface ToolProps {
  input: Record<string, any>
  metadata: Record<string, any>
  tool: string
  output?: string
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  locked?: boolean
  markdownEager?: boolean
  markdownViewport?: HTMLDivElement
  markdownStage?: MarkdownStage
  onMarkdownStage?: (key: string, stage: MarkdownStage | undefined) => void
}

export type ToolComponent = Component<ToolProps>

const state: Record<
  string,
  {
    name: string
    render?: ToolComponent
  }
> = {}

export function registerTool(input: { name: string; render?: ToolComponent }) {
  state[input.name] = input
  return input
}

export function getTool(name: string) {
  return state[name]?.render
}

export const ToolRegistry = {
  register: registerTool,
  render: getTool,
}

function ToolFileAccordion(props: { path: string; actions?: JSX.Element; children: JSX.Element }) {
  const value = createMemo(() => props.path || "tool-file")

  return (
    <Accordion multiple data-scope="apply-patch" style={{ "--sticky-accordion-offset": "40px" }} defaultValue={[]}>
      <Accordion.Item value={value()}>
        <StickyAccordionHeader>
          <Accordion.Trigger>
            <div data-slot="apply-patch-trigger-content">
              <div data-slot="apply-patch-file-info">
                <FileIcon node={{ path: props.path, type: "file" }} />
                <div data-slot="apply-patch-file-name-container">
                  <Show when={props.path.includes("/")}>
                    <span data-slot="apply-patch-directory">{`\u202A${getDirectory(props.path)}\u202C`}</span>
                  </Show>
                  <span data-slot="apply-patch-filename">{getFilename(props.path)}</span>
                </div>
              </div>
              <div data-slot="apply-patch-trigger-actions">
                {props.actions}
                <Icon name="chevron-grabber-vertical" size="small" />
              </div>
            </div>
          </Accordion.Trigger>
        </StickyAccordionHeader>
        <Accordion.Content>{props.children}</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  )
}

PART_MAPPING["tool"] = function ToolPartDisplay(props) {
  const data = useData()
  const i18n = useI18n()
  const loc = useLocation()
  const part = () => props.part as ToolPart
  const tool = toolName(part())
  if (tool === "todowrite" || tool === "todoread") return null

  const hideQuestion = createMemo(() => tool === "question" && part().state.status === "pending")

  const emptyMetadata: Record<string, any> = {}

  const input = () => part().state.input
  const partMetadata = () => {
    const state = part().state
    if (state.status === "pending") return emptyMetadata
    if ("metadata" in state && state.metadata) return state.metadata
    return emptyMetadata
  }
  const taskId = createMemo(() => {
    if (part().tool !== "task") return
    const value = partMetadata().sessionId
    if (typeof value === "string" && value) return value
  })
  const taskHref = createMemo(() => {
    if (part().tool !== "task") return
    return sessionLink(taskId(), loc.pathname, data.sessionHref)
  })
  const taskSubtitle = createMemo(() => {
    if (part().tool !== "task") return undefined
    const value = input().description
    if (typeof value === "string" && value) return value
    return taskId()
  })

  const render = ToolRegistry.render(tool) ?? GenericTool

  return (
    <Show when={!hideQuestion()}>
      <div data-component="tool-part-wrapper">
        <Switch>
          <Match when={part().state.status === "error"}>
            {(() => {
              const state = part().state
              if (state.status !== "error") return null
              const cleaned = state.error.replace("Error: ", "")
              if (tool === "question" && cleaned.includes("dismissed this question")) {
                return (
                  <div style="width: 100%; display: flex; justify-content: flex-end;">
                    <span class="text-13-regular text-text-weak cursor-default">
                      {i18n.t("ui.messagePart.questions.dismissed")}
                    </span>
                  </div>
                )
              }
              return (
                <ToolErrorCard
                  tool={part().tool}
                  error={state.error}
                  defaultOpen={props.defaultOpen}
                  subtitle={taskSubtitle()}
                  href={taskHref()}
                  onHrefClick={() => {
                    const id = taskId()
                    if (!id) return
                    data.navigateToSession?.(id)
                  }}
                />
              )
            })()}
          </Match>
          <Match when={true}>
            <Dynamic
              component={render}
              input={input()}
              tool={part().tool}
              metadata={partMetadata()}
              // @ts-expect-error
              output={part().state.output}
              status={part().state.status}
              hideDetails={props.hideDetails}
              defaultOpen={props.defaultOpen}
              markdownEager={props.markdownEager}
              markdownViewport={props.markdownViewport}
              markdownStage={props.markdownStage}
              onMarkdownStage={props.onMarkdownStage}
            />
          </Match>
        </Switch>
      </div>
    </Show>
  )
}

export function MessageDivider(props: { label: string }) {
  return (
    <div data-component="compaction-part">
      <div data-slot="compaction-part-divider">
        <span data-slot="compaction-part-line" />
        <span data-slot="compaction-part-label" class="text-12-regular text-text-weak">
          {props.label}
        </span>
        <span data-slot="compaction-part-line" />
      </div>
    </div>
  )
}

PART_MAPPING["compaction"] = function CompactionPartDisplay() {
  const i18n = useI18n()
  return <MessageDivider label={i18n.t("ui.messagePart.compaction")} />
}

PART_MAPPING["text"] = function TextPartDisplay(props) {
  const data = useData()
  const i18n = useI18n()
  const numfmt = createMemo(() => new Intl.NumberFormat(i18n.locale()))
  const part = props.part as TextPart
  const interrupted = createMemo(
    () =>
      props.message.role === "assistant" && (props.message as AssistantMessage).error?.name === "MessageAbortedError",
  )

  const model = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const message = props.message as AssistantMessage
    const match = providerByID(data.store.provider?.all, message.providerID)
    return match?.models?.[message.modelID]?.name ?? message.modelID
  })

  const provider = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const message = props.message as AssistantMessage
    const match = providerByID(data.store.provider?.all, message.providerID)
    return match?.name ?? message.providerID
  })

  const duration = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const message = props.message as AssistantMessage
    const completed = message.time.completed
    const ms =
      typeof props.turnDurationMs === "number"
        ? props.turnDurationMs
        : typeof completed === "number"
          ? completed - message.time.created
          : -1
    if (!(ms >= 0)) return ""
    const total = Math.round(ms / 1000)
    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt().format(total) })
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt().format(minutes),
      seconds: numfmt().format(seconds),
    })
  })

  const meta = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const agent = (props.message as AssistantMessage).agent
    const items = [
      agent ? agent[0]?.toUpperCase() + agent.slice(1) : "",
      provider(),
      model(),
      duration(),
      interrupted() ? i18n.t("ui.message.interrupted") : "",
    ]
    return items.filter((x) => !!x).join(" \u00B7 ")
  })

  const displayText = () => (part.text ?? "").trim()
  const streaming = createMemo(() => {
    if (props.message.role !== "assistant") return false
    return typeof (props.message as AssistantMessage).time.completed !== "number"
  })
  const isLastTextPart = createMemo(() => {
    const last = (data.store.part?.[props.message.id] ?? [])
      .filter((item): item is TextPart => item?.type === "text" && !!item.text?.trim())
      .at(-1)
    return last?.id === part.id
  })
  const end = createMemo(() => {
    const parts = data.store.part?.[props.message.id] ?? []
    const index = parts.findIndex((item) => item.id === part.id)
    if (index < 0) return true
    for (let i = index + 1; i < parts.length; i++) {
      const next = parts[i]
      if (!next) continue
      if (!renderable(next)) continue
      return false
    }
    return true
  })
  const renderText = createLiveText(displayText, () => streaming() && isLastTextPart())
  let prev = displayText().length
  let last = isLastTextPart()
  let live = streaming()

  createEffect(() => {
    const len = displayText().length
    const tail = clip(displayText())
    if (len < prev) {
      console.warn(`[text-part] text rollback msg=${props.message.id} part=${part.id} prev=${prev} next=${len} tail=${tail}`)
    }

    const nextLast = isLastTextPart()
    const nextLive = streaming()
    if (nextLast !== last || nextLive !== live) {
      console.debug(
        `[text-part] stream mode msg=${props.message.id} part=${part.id} len=${len} last=${nextLast} streaming=${nextLive} tail=${tail}`,
      )
    }

    prev = len
    last = nextLast
    live = nextLive
  })

  const body = createMemo(() => renderText())
  const genericAgentSegments = createMemo(() => {
    if (!isGenericAgentMessage(props.message)) return []
    return parseGenericAgentToolText(body())
  })
  const hasGenericAgentToolSegments = createMemo(() => genericAgentSegments().some((segment) => segment.type === "tool"))
  const plain = createMemo(() => streaming() && isLastTextPart() && end())
  const showCopy = createMemo(() => {
    if (props.message.role !== "assistant") return isLastTextPart()
    if (props.showAssistantCopyPartID === null) return false
    if (typeof props.showAssistantCopyPartID === "string") return props.showAssistantCopyPartID === part.id
    return isLastTextPart()
  })
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const content = displayText()
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Show when={body()}>
      <div data-component="text-part">
        <div data-slot="text-part-body">
          <Show
            when={hasGenericAgentToolSegments()}
            fallback={
              <Markdown
                text={body()}
                cacheKey={plain() ? `${part.id}:stream` : part.id}
                stage={props.markdownStage}
                onStage={props.onMarkdownStage}
                plain={plain()}
                streaming={plain()}
                instant={streaming()}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                highlight={props.markdownHighlight}
                math={props.markdownMath}
              />
            }
          >
            <For each={genericAgentSegments()}>
              {(segment, index) => (
                <Switch>
                  <Match when={segment.type === "text" ? segment.text : undefined}>
                    {(text) => (
                      <Markdown
                        text={text()}
                        cacheKey={`${part.id}:ga-text:${index()}`}
                        stage={props.markdownStage}
                        onStage={props.onMarkdownStage}
                        eager={props.markdownEager}
                        viewport={props.markdownViewport}
                        highlight={props.markdownHighlight}
                        math={props.markdownMath}
                      />
                    )}
                  </Match>
                  <Match when={segment.type === "tool" ? segment : undefined}>
                    {(tool) => (
                      <GenericTool
                        tool={tool().tool}
                        input={tool().input}
                        output={tool().output}
                        status="completed"
                        hideDetails={props.hideDetails}
                      />
                    )}
                  </Match>
                </Switch>
              )}
            </For>
          </Show>
        </div>
        <Show when={showCopy()}>
          <div data-slot="text-part-copy-wrapper" data-interrupted={interrupted() ? "" : undefined}>
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
              placement="top"
              gutter={4}
              lazyMount
            >
              <IconButton
                icon={copied() ? "check" : "copy"}
                size="normal"
                variant="ghost"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopy}
                aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
              />
            </Tooltip>
            <Show when={meta()}>
              <span data-slot="text-part-meta" class="text-12-regular text-text-weak cursor-default">
                {meta()}
              </span>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}

PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
  const i18n = useI18n()
  const part = props.part as ReasoningPart
  const text = () => part.text.trim()
  const [open, setOpen] = createSignal(false)
  const streaming = createMemo(() => {
    if (props.message.role !== "assistant") return false
    return typeof (props.message as AssistantMessage).time.completed !== "number"
  })
  const title = createMemo(() =>
    streaming() ? i18n.t("ui.messagePart.reasoning.thinking") : i18n.t("ui.messagePart.reasoning.thought"),
  )

  const previewText = createMemo(() => {
    const content = text()
    if (!content) return ""
    const lines = content.split("\n")
    return lines.slice(-3).join("\n")
  })

  createEffect(
    on(streaming, (now, prev) => {
      if (prev === true && now === false) {
        setOpen(false)
      }
    }),
  )

  return (
    <Show when={text()}>
      <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="reasoning-collapsible">
        <Collapsible.Trigger>
          <div data-component="reasoning-trigger" data-streaming={streaming()}>
            <div data-slot="reasoning-trigger-title">
              <span>{title()}</span>
              <Show when={streaming()} fallback={<Icon name="circle-check" size="small" />}>
                <Spinner />
              </Show>
            </div>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Show when={streaming() && !open()}>
          <div data-component="reasoning-part" data-mode="preview">
            <div data-slot="reasoning-preview">{previewText()}</div>
          </div>
        </Show>
        <Collapsible.Content>
          <Show when={open()}>
            <div data-component="reasoning-part" data-mode="full">
              <Markdown
                text={text()}
                cacheKey={part.id}
                stage={props.markdownStage}
                onStage={props.onMarkdownStage}
                streaming={streaming()}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                highlight={props.markdownHighlight}
                math={streaming() ? "defer" : props.markdownMath}
              />
            </div>
          </Show>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  )
}

ToolRegistry.register({
  name: "read",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const args: string[] = []
    if (props.input.offset) args.push("offset=" + props.input.offset)
    if (props.input.limit) args.push("limit=" + props.input.limit)
    const loaded = createMemo(() => {
      if (props.status !== "completed") return []
      const value = props.metadata.loaded
      if (!value || !Array.isArray(value)) return []
      return value.filter((p): p is string => typeof p === "string")
    })
    const path = createMemo(() => {
      const value = file(props.input) ?? ""
      if (!value) return ""
      return relativizeProjectPath(value, data.directory) || value
    })
    return (
      <>
        <BasicTool
          {...props}
          icon="glasses"
          trigger={{
            title: i18n.t("ui.tool.read"),
            titleClass: "tool-read",
            subtitle: path(),
            args,
          }}
        />
        <For each={loaded()}>
          {(filepath) => (
            <div data-component="tool-loaded-file">
              <Icon name="enter" size="small" />
              <span>
                {i18n.t("ui.tool.loaded")} {relativizeProjectPath(filepath, data.directory)}
              </span>
            </div>
          )}
        </For>
      </>
    )
  },
})

function ShellTool(props: ToolProps & { title: string }) {
  const i18n = useI18n()
  const running = createMemo(() => props.status === "pending" || props.status === "running")
  const hook = createMemo(() => hookName(props.input ?? {}, props.metadata ?? {}))
  const type = createMemo(() => hookType(props.input ?? {}, props.metadata ?? {}))
  const line = createMemo(() => cmd(props.input ?? {}, props.metadata ?? {}) ?? "")
  const subtitle = createMemo(() => {
    if (hook()) return type()
    return text(props.input.description) ?? text(props.metadata.description) ?? line()
  })
  const body = createMemo(() => {
    const out = stripAnsi(props.output || props.metadata.output || "")
    return line() ? `$ ${line()}${out ? "\n\n" + out : ""}` : out
  })
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const value = body()
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <BasicTool
      {...props}
      showPendingMeta
      showPendingDetails={!!body()}
      forceOpen={false}
      icon="console"
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title" class={hook() ? "hook-name" : "tool-exec"}>
              <TextShimmer text={hook() ?? props.title} active={running()} />
            </span>
            <Show when={subtitle()}>
              <span data-slot="basic-tool-tool-subtitle" classList={{ "hook-type": !!hook() }}>
                {subtitle()}
              </span>
            </Show>
            <Show when={running() && !hook()}>
              <span data-slot="basic-tool-tool-arg">
                <ToolStatusTitle
                  active
                  activeText={i18n.t("ui.tool.shell.running")}
                  doneText={i18n.t("ui.tool.shell.ran")}
                />
              </span>
            </Show>
          </div>
        </div>
      }
    >
      <Show when={body()}>
        <div data-component="bash-output">
          <div data-slot="bash-copy">
            <LazyAction size="small">
              <Tooltip
                value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                placement="top"
                gutter={4}
                lazyMount
              >
                <IconButton
                  icon={copied() ? "check" : "copy"}
                  size="small"
                  variant="secondary"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleCopy}
                  aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                />
              </Tooltip>
            </LazyAction>
          </div>
          <div data-slot="bash-scroll" data-scrollable>
            <pre data-slot="bash-pre">
              <code>{body()}</code>
            </pre>
          </div>
        </div>
      </Show>
    </BasicTool>
  )
}

ToolRegistry.register({
  name: "list",
  render(props) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="bullet-list"
        trigger={{
          title: i18n.t("ui.tool.list"),
          titleClass: "tool-read",
          subtitle: getDirectory(props.input.path || "/"),
        }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown
                text={output()}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                stage={props.markdownStage}
                onStage={props.onMarkdownStage}
              />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "glob",
  render(props) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.glob"),
          titleClass: "tool-read",
          subtitle: getDirectory(props.input.path || "/"),
          args: props.input.pattern ? ["pattern=" + props.input.pattern] : [],
        }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown
                text={output()}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                stage={props.markdownStage}
                onStage={props.onMarkdownStage}
              />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "grep",
  render(props) {
    const i18n = useI18n()
    const args: string[] = []
    if (props.input.pattern) args.push("pattern=" + props.input.pattern)
    if (props.input.include) args.push("include=" + props.input.include)
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.grep"),
          titleClass: "tool-read",
          subtitle: getDirectory(props.input.path || "/"),
          args,
        }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown
                text={output()}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                stage={props.markdownStage}
                onStage={props.onMarkdownStage}
              />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "webfetch",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    const url = createMemo(() => {
      const value = props.input.url
      if (typeof value !== "string") return ""
      return value
    })
    return (
      <BasicTool
        {...props}
        hideDetails
        icon="window-cursor"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title" class="tool-read">
                <Show when={pending()} fallback={i18n.t("ui.tool.webfetch")}>
                  <TextShimmer text={i18n.t("ui.tool.webfetch")} />
                </Show>
              </span>
              <Show when={!pending() && url()}>
                <a
                  data-slot="basic-tool-tool-subtitle"
                  class="clickable subagent-link"
                  href={url()}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                >
                  {url()}
                </a>
              </Show>
            </div>
            <Show when={!pending() && url()}>
              <div data-component="tool-action">
                <Icon name="square-arrow-top-right" size="small" />
              </div>
            </Show>
          </div>
        }
      />
    )
  },
})

ToolRegistry.register({
  name: "task",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const loc = useLocation()

    const childSessionId = () => props.metadata.sessionId as string | undefined
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    const type = createMemo(() => {
      const raw = props.input.subagent_type
      if (typeof raw !== "string" || !raw) return undefined
      return raw[0]!.toUpperCase() + raw.slice(1)
    })
    const title = createMemo(() => agentTitle(i18n, type()))
    const subtitle = createMemo(() => {
      const value = props.input.description
      if (typeof value === "string" && value) return value
      return childSessionId()
    })
    const href = createMemo(() => sessionLink(childSessionId(), loc.pathname, data.sessionHref))

    const handleLinkClick = (e: MouseEvent) => {
      // Always preventDefault: a same-origin <a> default navigation reloads
      // the entire document in the desktop webview, which re-triggers the
      // startup shell. If SPA navigation is unavailable, we'd rather no-op
      // than full-reload.
      e.stopPropagation()
      e.preventDefault()
      if (e.button !== 0) return
      const sessionId = childSessionId()
      if (!sessionId) return
      data.navigateToSession?.(sessionId)
    }

    const trigger = () => (
      <div data-slot="basic-tool-tool-info-structured">
        <div data-slot="basic-tool-tool-info-main">
          <span data-slot="basic-tool-tool-title" class="capitalize agent-title">
            <Show when={pending()} fallback={title()}>
              <TextShimmer text={title()} />
            </Show>
          </span>
          <Show when={subtitle()}>
            <Switch>
              <Match when={href()}>
                <a
                  data-slot="basic-tool-tool-subtitle"
                  class="clickable subagent-link"
                  href={href()!}
                  onClick={handleLinkClick}
                >
                  {subtitle()}
                </a>
              </Match>
              <Match when={true}>
                <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>
              </Match>
            </Switch>
          </Show>
        </div>
        <Show when={!pending() && href()}>
          <div data-component="tool-action">
            <Icon name="align-right" size="small" />
          </div>
        </Show>
      </div>
    )

    return <BasicTool {...props} hideDetails icon="task" trigger={trigger()} />
  },
})

ToolRegistry.register({
  name: "skill",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    const name = createMemo(() => {
      const fromMeta = props.metadata?.name
      if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim()
      const fromInput = props.input?.name
      if (typeof fromInput === "string" && fromInput.trim()) return fromInput.trim()
      return ""
    })

    return (
      <BasicTool
        {...props}
        icon="console"
        trigger={{
          title: pending() ? "Skill" : `Skill: /${name()}`,
          subtitle: pending() ? undefined : i18n.t("ui.tool.loaded"),
        }}
      >
        <Show when={props.output && !pending()}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown
                text={String(output())}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                stage={props.markdownStage}
                onStage={props.onMarkdownStage}
              />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "bash",
  render(props) {
    const i18n = useI18n()
    return <ShellTool {...props} title={i18n.t("ui.tool.shell")} />
  },
})

ToolRegistry.register({
  name: "exec",
  render(props) {
    return <ShellTool {...props} title="Exec" />
  },
})

ToolRegistry.register({
  name: "hook",
  render(props) {
    const i18n = useI18n()
    const hook = createMemo(() => hookName(props.input ?? {}, props.metadata ?? {}))
    const type = createMemo(() => hookType(props.input ?? {}, props.metadata ?? {}))
    return (
      <BasicTool
        {...props}
        icon="console"
        trigger={{
          title: hook() ?? i18n.t("ui.tool.shell"),
          titleClass: hook() ? "hook-name" : "tool-exec",
          subtitle: hook() ? type() : (props.input.description ?? props.metadata.description),
          subtitleClass: hook() ? "hook-type" : undefined,
        }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown
                text={String(output())}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                stage={props.markdownStage}
                onStage={props.onMarkdownStage}
              />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "edit",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, props.input.filePath))
    const path = createMemo(() => props.metadata?.filediff?.file || props.input.filePath || "")
    const filename = () => getFilename(props.input.filePath ?? "")
    const pending = () => props.status === "pending" || props.status === "running"
    return (
      <div data-component="edit-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          defer
          trigger={
            <div data-component="edit-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <Show when={pending()} fallback={i18n.t("ui.messagePart.title.edit")}>
                      <TextShimmer text={i18n.t("ui.messagePart.title.edit")} />
                    </Show>
                  </span>
                  <Show when={!pending()}>
                    <span data-slot="message-part-title-filename">{filename()}</span>
                  </Show>
                </div>
                <Show when={!pending() && props.input.filePath?.includes("/")}>
                  <div data-slot="message-part-path">
                    <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                  </div>
                </Show>
              </div>
              <div data-slot="message-part-actions">
                <Show when={!pending() && props.metadata.filediff}>
                  <DiffChanges changes={props.metadata.filediff} />
                </Show>
              </div>
            </div>
          }
        >
          <Show when={path()}>
            <ToolFileAccordion
              path={path()}
              actions={
                <Show when={!pending() && props.metadata.filediff}>{(diff) => <DiffChanges changes={diff()} />}</Show>
              }
            >
              <div data-component="edit-content">
                <Dynamic
                  component={fileComponent}
                  mode="diff"
                  before={{
                    name: props.metadata?.filediff?.file || props.input.filePath,
                    contents: props.metadata?.filediff?.before || props.input.oldString,
                  }}
                  after={{
                    name: props.metadata?.filediff?.file || props.input.filePath,
                    contents: props.metadata?.filediff?.after || props.input.newString,
                  }}
                />
              </div>
            </ToolFileAccordion>
          </Show>
          <DiagnosticsDisplay diagnostics={diagnostics()} />
        </BasicTool>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "write",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, props.input.filePath))
    const path = createMemo(() => props.input.filePath || "")
    const filename = () => getFilename(props.input.filePath ?? "")
    const pending = () => props.status === "pending" || props.status === "running"
    return (
      <div data-component="write-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          defer
          trigger={
            <div data-component="write-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <Show when={pending()} fallback={i18n.t("ui.messagePart.title.write")}>
                      <TextShimmer text={i18n.t("ui.messagePart.title.write")} />
                    </Show>
                  </span>
                  <Show when={!pending()}>
                    <span data-slot="message-part-title-filename">{filename()}</span>
                  </Show>
                </div>
                <Show when={!pending() && props.input.filePath?.includes("/")}>
                  <div data-slot="message-part-path">
                    <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                  </div>
                </Show>
              </div>
              <div data-slot="message-part-actions">{/* <DiffChanges diff={diff} /> */}</div>
            </div>
          }
        >
          <Show when={props.input.content && path()}>
            <ToolFileAccordion path={path()}>
              <div data-component="write-content">
                <Dynamic
                  component={fileComponent}
                  mode="text"
                  file={{
                    name: props.input.filePath,
                    contents: props.input.content,
                    cacheKey: checksum(props.input.content),
                  }}
                  overflow="scroll"
                />
              </div>
            </ToolFileAccordion>
          </Show>
          <DiagnosticsDisplay diagnostics={diagnostics()} />
        </BasicTool>
      </div>
    )
  },
})

interface ApplyPatchFile {
  filePath: string
  relativePath: string
  type: "add" | "update" | "delete" | "move"
  diff: string
  before: string
  after: string
  additions: number
  deletions: number
  movePath?: string
}

ToolRegistry.register({
  name: "apply_patch",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const files = createMemo(() => (props.metadata.files ?? []) as ApplyPatchFile[])
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    const single = createMemo(() => {
      const list = files()
      if (list.length !== 1) return
      return list[0]
    })
    const [expanded, setExpanded] = createSignal<string[]>([])

    const subtitle = createMemo(() => {
      const count = files().length
      if (count === 0) return ""
      return `${count} ${i18n.t(count > 1 ? "ui.common.file.other" : "ui.common.file.one")}`
    })

    return (
      <Show
        when={single()}
        fallback={
          <div data-component="apply-patch-tool">
            <BasicTool
              {...props}
              icon="code-lines"
              defer
              trigger={{
                title: i18n.t("ui.tool.patch"),
                titleClass: "tool-edit",
                subtitle: subtitle(),
              }}
            >
              <Show when={files().length > 0}>
                <Accordion
                  multiple
                  data-scope="apply-patch"
                  style={{ "--sticky-accordion-offset": "40px" }}
                  value={expanded()}
                  onChange={(value) => setExpanded(Array.isArray(value) ? value : value ? [value] : [])}
                >
                  <For each={files()}>
                    {(file) => {
                      const active = createMemo(() => expanded().includes(file.filePath))
                      const [visible, setVisible] = createSignal(false)

                      createEffect(() => {
                        if (!active()) {
                          setVisible(false)
                          return
                        }

                        requestAnimationFrame(() => {
                          if (!active()) return
                          setVisible(true)
                        })
                      })

                      return (
                        <Accordion.Item value={file.filePath} data-type={file.type}>
                          <StickyAccordionHeader>
                            <Accordion.Trigger>
                              <div data-slot="apply-patch-trigger-content">
                                <div data-slot="apply-patch-file-info">
                                  <FileIcon node={{ path: file.relativePath, type: "file" }} />
                                  <div data-slot="apply-patch-file-name-container">
                                    <Show when={file.relativePath.includes("/")}>
                                      <span data-slot="apply-patch-directory">{`\u202A${getDirectory(file.relativePath)}\u202C`}</span>
                                    </Show>
                                    <span data-slot="apply-patch-filename">{getFilename(file.relativePath)}</span>
                                  </div>
                                </div>
                                <div data-slot="apply-patch-trigger-actions">
                                  <Switch>
                                    <Match when={file.type === "add"}>
                                      <span data-slot="apply-patch-change" data-type="added">
                                        {i18n.t("ui.patch.action.created")}
                                      </span>
                                    </Match>
                                    <Match when={file.type === "delete"}>
                                      <span data-slot="apply-patch-change" data-type="removed">
                                        {i18n.t("ui.patch.action.deleted")}
                                      </span>
                                    </Match>
                                    <Match when={file.type === "move"}>
                                      <span data-slot="apply-patch-change" data-type="modified">
                                        {i18n.t("ui.patch.action.moved")}
                                      </span>
                                    </Match>
                                    <Match when={true}>
                                      <DiffChanges changes={{ additions: file.additions, deletions: file.deletions }} />
                                    </Match>
                                  </Switch>
                                  <Icon name="chevron-grabber-vertical" size="small" />
                                </div>
                              </div>
                            </Accordion.Trigger>
                          </StickyAccordionHeader>
                          <Accordion.Content>
                            <Show when={visible()}>
                              <div data-component="apply-patch-file-diff">
                                <Dynamic
                                  component={fileComponent}
                                  mode="diff"
                                  before={{ name: file.filePath, contents: file.before }}
                                  after={{ name: file.movePath ?? file.filePath, contents: file.after }}
                                />
                              </div>
                            </Show>
                          </Accordion.Content>
                        </Accordion.Item>
                      )
                    }}
                  </For>
                </Accordion>
              </Show>
            </BasicTool>
          </div>
        }
      >
        {(file) => (
          <div data-component="apply-patch-tool">
            <BasicTool
              {...props}
              icon="code-lines"
              defer
              trigger={
                <div data-component="edit-trigger">
                  <div data-slot="message-part-title-area">
                    <div data-slot="message-part-title">
                      <span data-slot="message-part-title-text">
                        <Show when={pending()} fallback={i18n.t("ui.tool.patch")}>
                          <TextShimmer text={i18n.t("ui.tool.patch")} />
                        </Show>
                      </span>
                      <Show when={!pending()}>
                        <span data-slot="message-part-title-filename">{getFilename(file().relativePath)}</span>
                      </Show>
                    </div>
                    <Show when={!pending() && file().relativePath.includes("/")}>
                      <div data-slot="message-part-path">
                        <span data-slot="message-part-directory">{getDirectory(file().relativePath)}</span>
                      </div>
                    </Show>
                  </div>
                  <div data-slot="message-part-actions">
                    <Show when={!pending()}>
                      <DiffChanges changes={{ additions: file().additions, deletions: file().deletions }} />
                    </Show>
                  </div>
                </div>
              }
            >
              <ToolFileAccordion
                path={file().relativePath}
                actions={
                  <Switch>
                    <Match when={file().type === "add"}>
                      <span data-slot="apply-patch-change" data-type="added">
                        {i18n.t("ui.patch.action.created")}
                      </span>
                    </Match>
                    <Match when={file().type === "delete"}>
                      <span data-slot="apply-patch-change" data-type="removed">
                        {i18n.t("ui.patch.action.deleted")}
                      </span>
                    </Match>
                    <Match when={file().type === "move"}>
                      <span data-slot="apply-patch-change" data-type="modified">
                        {i18n.t("ui.patch.action.moved")}
                      </span>
                    </Match>
                    <Match when={true}>
                      <DiffChanges changes={{ additions: file().additions, deletions: file().deletions }} />
                    </Match>
                  </Switch>
                }
              >
                <div data-component="apply-patch-file-diff">
                  <Dynamic
                    component={fileComponent}
                    mode="diff"
                    before={{ name: file().filePath, contents: file().before }}
                    after={{ name: file().movePath ?? file().filePath, contents: file().after }}
                  />
                </div>
              </ToolFileAccordion>
            </BasicTool>
          </div>
        )}
      </Show>
    )
  },
})

ToolRegistry.register({
  name: "todowrite",
  render(props) {
    const i18n = useI18n()
    const todos = createMemo(() => {
      const meta = props.metadata?.todos
      if (Array.isArray(meta)) return meta

      const input = props.input.todos
      if (Array.isArray(input)) return input

      return []
    })

    const subtitle = createMemo(() => {
      const list = todos()
      if (list.length === 0) return ""
      return `${list.filter((t: Todo) => t.status === "completed").length}/${list.length}`
    })

    return (
      <BasicTool
        {...props}
        defaultOpen
        icon="checklist"
        trigger={{
          title: i18n.t("ui.tool.todos"),
          titleClass: "tool-interact",
          subtitle: subtitle(),
        }}
      >
        <Show when={todos().length}>
          <div data-component="todos">
            <For each={todos()}>
              {(todo: Todo) => (
                <Checkbox readOnly checked={todo.status === "completed"}>
                  <span
                    data-slot="message-part-todo-content"
                    data-completed={todo.status === "completed" ? "completed" : undefined}
                  >
                    {todo.content}
                  </span>
                </Checkbox>
              )}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "question",
  render(props) {
    const i18n = useI18n()
    const dialog = useDialog()
    const questions = createMemo(() => (props.input.questions ?? []) as QuestionInfo[])
    const answers = createMemo(() => (props.metadata.answers ?? []) as QuestionAnswer[])
    const completed = createMemo(() => answers().length > 0)

    const subtitle = createMemo(() => {
      const count = questions().length
      if (count === 0) return ""
      if (completed()) return i18n.t("ui.question.subtitle.answered", { count })
      return `${count} ${i18n.t(count > 1 ? "ui.common.question.other" : "ui.common.question.one")}`
    })

    return (
      <BasicTool
        {...props}
        defaultOpen={completed()}
        icon="bubble-5"
        trigger={{
          title: i18n.t("ui.tool.questions"),
          titleClass: "tool-interact",
          subtitle: subtitle(),
        }}
      >
        <Show when={completed()}>
          <div data-component="question-answers">
            <For each={questions()}>
              {(q, i) => {
                const answer = () => answers()[i()] ?? []
                const textParts = () => answer().filter((part) => typeof part === "string")
                const imageParts = () =>
                  answer().filter(
                    (part): part is { type: "image"; url: string; mime: string; filename?: string } =>
                      typeof part !== "string" && part.type === "image",
                  )

                return (
                  <div data-slot="question-answer-item">
                    <div data-slot="question-text">{q.question}</div>
                    <div data-slot="answer-content">
                      <Show when={textParts().length > 0}>
                        <div data-slot="answer-text">{textParts().join(", ")}</div>
                      </Show>
                      <Show when={imageParts().length > 0}>
                        <div data-slot="answer-images">
                          <For each={imageParts()}>
                            {(image) => (
                              <button
                                type="button"
                                data-slot="answer-image-button"
                                onClick={() =>
                                  dialog.show(() => (
                                    <ImagePreview
                                      src={image.url}
                                      alt={image.filename ?? i18n.t("ui.message.attachment.alt")}
                                    />
                                  ))
                                }
                              >
                                <img
                                  src={image.url}
                                  alt={image.filename ?? i18n.t("ui.message.attachment.alt")}
                                  data-slot="answer-image-thumbnail"
                                />
                                <Show when={image.filename}>
                                  <span data-slot="answer-image-filename">{image.filename}</span>
                                </Show>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={answer().length === 0}>
                        <div data-slot="answer-text">{i18n.t("ui.question.answer.none")}</div>
                      </Show>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "skill",
  render(props) {
    const i18n = useI18n()
    const title = createMemo(() => props.input.name || i18n.t("ui.tool.skill"))
    const running = createMemo(() => props.status === "pending" || props.status === "running")

    const titleContent = () => <TextShimmer text={title()} active={running()} />

    const trigger = () => (
      <div data-slot="basic-tool-tool-info-structured">
        <div data-slot="basic-tool-tool-info-main">
          <span data-slot="basic-tool-tool-title" class="capitalize agent-title">
            {titleContent()}
          </span>
        </div>
      </div>
    )

    return <BasicTool icon="models" status={props.status} trigger={trigger()} hideDetails />
  },
})
