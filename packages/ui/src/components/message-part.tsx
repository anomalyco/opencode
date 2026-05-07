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
  onCleanup,
  Index,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import stripAnsi from "strip-ansi"
import { Dynamic } from "solid-js/web"
import {
  AssistantMessage,
  FilePart,
  Message as MessageType,
  Part as PartType,
  ReasoningPart,
  Session,
  TextPart,
  ToolPart,
  UserMessage,
  Todo,
  QuestionAnswer,
  QuestionInfo,
} from "@opencode-ai/sdk/v2"
import { createStore } from "solid-js/store"
import { useData } from "../context"
import { useFileComponent } from "../context/file"
import { useDialog } from "../context/dialog"
import { type UiI18n, useI18n } from "../context/i18n"
import { BasicTool, GenericTool } from "./basic-tool"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { Collapsible } from "./collapsible"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { ToolErrorCard } from "./tool-error-card"
import { Checkbox } from "./checkbox"
import { Collapsible } from "./collapsible"
import { DiffChanges } from "./diff-changes"
import { Markdown } from "./markdown"
import type { MarkdownStage } from "./markdown"
import { ImagePreview } from "./image-preview"
import { getDirectory as _getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { checksum } from "@opencode-ai/core/util/encode"
import { Tooltip } from "./tooltip"
import { IconButton } from "./icon-button"
import { Spinner } from "./spinner"
import { TextShimmer } from "./text-shimmer"
import { AnimatedCountList } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"
import { Spinner } from "./spinner"
import { animate } from "motion"
import { useLocation } from "@solidjs/router"
import { attached, inline, kind } from "./message-file"
import { skillText } from "./message-skill"
import { hookName, isCustomHookTool, normalizeTool } from "./tool-meta"

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
  deferToolContent?: boolean
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

const TEXT_RENDER_THROTTLE_MS = 100

function step(size: number) {
  if (size <= 12) return 2
  if (size <= 48) return 4
  if (size <= 96) return 8
  return Math.min(24, Math.ceil(size / 8))
}

function next(text: string, start: number) {
  const end = Math.min(text.length, start + step(text.length - start))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? "")) return i + 1
  }
  return end
}

function createPacedValue(getValue: () => string, live?: () => boolean) {
  const [value, setValue] = createSignal(getValue())
  let shown = getValue()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let rafId: number | undefined
  let last = 0
  let pending: string | undefined

  const flush = () => {
    if (pending === undefined) return
    const next = pending
    pending = undefined
    last = Date.now()
    // Gate on rAF so we only commit values when the browser is ready to paint
    rafId = requestAnimationFrame(() => {
      rafId = undefined
      setValue(next)
    })
  }

  const clear = () => {
    if (!timeout) return
    clearTimeout(timeout)
    timeout = undefined
  }

    pending = next

    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last)
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      flush()
      return
    }
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      timeout = undefined
      flush()
    }, remaining)
  })

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
    if (rafId !== undefined) cancelAnimationFrame(rafId)
  })

  return value
}

function createLiveText(getValue: () => string, active: () => boolean) {
  const [value, setValue] = createSignal(getValue())
  const throttled = createThrottledValue(getValue)

  createEffect(() => {
    if (active()) {
      setValue(throttled())
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
import { normalize } from "./session-diff"

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
        title: webSearchProviderLabel(metadata?.provider),
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

function currentSession(path: string) {
  return path.match(/\/session\/([^/?#]+)/)?.[1]
}

function taskSession(
  input: Record<string, any>,
  path: string,
  sessions: Session[] | undefined,
  agents?: readonly { name: string; color?: string }[],
) {
  const parentID = currentSession(path)
  if (!parentID) return
  const description = typeof input.description === "string" ? input.description : ""
  const agent = taskAgent(input.subagent_type, agents).name
  return (sessions ?? [])
    .filter((session) => session.parentID === parentID && !session.time?.archived)
    .filter((session) => (description ? session.title.startsWith(description) : true))
    .filter((session) => (agent ? session.title.includes(`@${agent}`) : true))
    .sort((a, b) => (b.time.created ?? 0) - (a.time.created ?? 0))[0]?.id
}

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"])
function toolName(part: { tool: string }) {
  return normalizeTool(part.tool)
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

function renderable(part: PartType, showReasoningSummaries = true, showCustomHookParts = true) {
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

export function partDefaultOpen(part: PartType, shell = false, edit = false) {
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
  const emptyTools: ToolPart[] = []
  const msgs = createMemo(() => index(props.messages))
  const part = createMemo(
    () =>
      new Map(
        props.messages.map((message) => [message.id, index(list(data.store.part?.[message.id], emptyParts))] as const),
      ),
  )

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
      for (const part of list(data.store.part?.[message.id], emptyParts)) {
        if (!renderable(part, props.showReasoningSummaries ?? true, props.showCustomHookParts ?? true)) continue
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
    </Index>
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

function contextToolSummary(parts: ToolPart[]) {
  const read = parts.filter((part) => toolName(part) === "read").length
  const search = parts.filter((part) => toolName(part) === "glob" || toolName(part) === "grep").length
  const list = parts.filter((part) => toolName(part) === "list").length
  return [
    read ? `${read} ${read === 1 ? "read" : "reads"}` : undefined,
    search ? `${search} ${search === 1 ? "search" : "searches"}` : undefined,
    list ? `${list} ${list === 1 ? "list" : "lists"}` : undefined,
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

    const parts = props.parts
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
      if (!renderable(part, props.showReasoningSummaries ?? true, props.showCustomHookParts ?? true)) return

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
    </Index>
  )
}

export function ContextToolGroup(props: { parts: ToolPart[]; busy?: boolean }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const pending = createMemo(
    () =>
      !!props.busy || props.parts.some((part) => part.state.status === "pending" || part.state.status === "running"),
  )
  const summary = createMemo(() => contextToolSummary(props.parts))

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
            <span data-slot="context-tool-group-label" class="shrink-0">
              <ToolStatusTitle
                active={pending()}
                activeText={i18n.t("ui.sessionTurn.status.gatheringContext")}
                doneText={i18n.t("ui.sessionTurn.status.gatheredContext")}
                split={false}
              />
            </span>
            <span
              data-slot="context-tool-group-summary"
              class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-text-base"
            >
              <AnimatedCountList
                items={[
                  {
                    key: "read",
                    count: summary().read,
                    one: i18n.t("ui.messagePart.context.read.one"),
                    other: i18n.t("ui.messagePart.context.read.other"),
                  },
                  {
                    key: "search",
                    count: summary().search,
                    one: i18n.t("ui.messagePart.context.search.one"),
                    other: i18n.t("ui.messagePart.context.search.other"),
                  },
                  {
                    key: "list",
                    count: summary().list,
                    one: i18n.t("ui.messagePart.context.list.one"),
                    other: i18n.t("ui.messagePart.context.list.other"),
                  },
                ]}
                fallback=""
              />
            </span>
          </span>
          <Collapsible.Arrow />
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div data-component="context-tool-group-list">
          <Index each={props.parts}>
            {(partAccessor) => {
              const trigger = createMemo(() => contextToolTrigger(partAccessor(), i18n))
              const running = createMemo(
                () => partAccessor().state.status === "pending" || partAccessor().state.status === "running",
              )
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
                            <Show when={!running() && trigger().subtitle}>
                              <span data-slot="basic-tool-tool-subtitle">{trigger().subtitle}</span>
                            </Show>
                            <Show when={!running() && trigger().args?.length}>
                              <For each={trigger().args}>
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
          </Index>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}

export function UserMessageDisplay(props: {
  message: UserMessage
  parts: PartType[]
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
  const [copied, setCopied] = createSignal(false)

  const textPart = createMemo(
    () => props.parts?.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined,
  )

  const text = createMemo(() => textPart()?.text || "")

  const skillTemplatePart = createMemo(() => skillText(props.parts))

  const files = createMemo(() => (props.parts?.filter((p) => p.type === "file") as FilePart[]) ?? [])

  const attachments = createMemo(() => files().filter(attached))

  const inlineFiles = createMemo(() =>
    files().filter((f) => {
      const mime = f.mime
      return !mime.startsWith("image/") && mime !== "application/pdf" && f.source?.text?.start !== undefined
    }),
  )

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
    const match = data.store.provider?.all?.find((p) => p.id === providerID)
    return match?.models?.[modelID]?.name ?? modelID
  })

  const provider = createMemo(() => {
    const providerID = props.message.model?.providerID
    if (!providerID) return ""
    const match = data.store.provider?.all?.find((p) => p.id === providerID)
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
    const date = new Date(created)
    const hours = date.getHours()
    const hour12 = hours % 12 || 12
    const minute = String(date.getMinutes()).padStart(2, "0")
    return `${hour12}:${minute} ${hours < 12 ? "AM" : "PM"}`
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
    if (await writeClipboard(content)) {
      setState("copied", true)
      setTimeout(() => setState("copied", false), 2000)
    }
  }

  const revert = () => {
    const act = props.actions?.revert
    if (!act || busy()) return
    setState("busy", true)
    void Promise.resolve()
      .then(() =>
        act({
          sessionID: props.message.sessionID,
          messageID: props.message.id,
        }),
      )
      .finally(() => setState("busy", false))
  }

  return (
    <div data-component="user-message" data-interrupted={props.interrupted ? "" : undefined}>
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
                <Tooltip value={i18n.t("ui.message.forkMessage")} placement="top" gutter={4}>
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
                <Tooltip value={i18n.t("ui.message.revertMessage")} placement="top" gutter={4}>
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
      <Show when={isSkillCommand() && skillTemplatePart()}>
        <BasicTool
          icon="console"
          trigger={{
            title: `Skill: /${props.message.command!.name}`,
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
        deferToolContent={props.deferToolContent}
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
  sessionID?: string
  output?: string
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  deferContent?: boolean
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
  const part = props.part as ToolPart
  const tool = toolName(part)
  if (tool === "todowrite" || tool === "todoread") return null

  const hideQuestion = createMemo(() => tool === "question" && part.state.status === "pending")

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
    return sessionLink(taskId(), useLocation().pathname, data.sessionHref)
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
      <div data-component="tool-part-wrapper" data-timeline-part-id={part().id}>
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
              component={render()}
              input={input()}
              tool={tool}
              metadata={metadata()}
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
  const part = () => props.part as TextPart
  const interrupted = createMemo(
    () =>
      props.message.role === "assistant" && (props.message as AssistantMessage).error?.name === "MessageAbortedError",
  )

  const model = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const message = props.message as AssistantMessage
    const match = data.store.provider?.all?.get(message.providerID)
    return match?.models?.[message.modelID]?.name ?? message.modelID
  })

  const provider = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const message = props.message as AssistantMessage
    const match = data.store.provider?.all?.find((p) => p.id === message.providerID)
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
    return last?.id === part().id
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
      console.warn("[text-part] text rollback", {
        msg: props.message.id,
        part: part.id,
        prev,
        next: len,
        tail,
      })
    }

    const nextLast = isLastTextPart()
    const nextLive = streaming()
    if (nextLast !== last || nextLive !== live) {
      console.debug("[text-part] stream mode", {
        msg: props.message.id,
        part: part.id,
        len,
        last: nextLast,
        streaming: nextLive,
        tail,
      })
    }

    prev = len
    last = nextLast
    live = nextLive
  })

  const body = createMemo(() => renderText())
  const plain = createMemo(() => streaming() && isLastTextPart() && end())
  const showCopy = createMemo(() => {
    if (props.message.role !== "assistant") return isLastTextPart()
    if (props.showAssistantCopyPartID === null) return false
    if (typeof props.showAssistantCopyPartID === "string") return props.showAssistantCopyPartID === part().id
    return isLastTextPart()
  })
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const content = text()
    if (!content) return
    if (await writeClipboard(content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Show when={body()}>
      <div data-component="text-part">
        <div data-slot="text-part-body">
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
        </div>
        <Show when={showCopy()}>
          <div data-slot="text-part-copy-wrapper" data-interrupted={interrupted() ? "" : undefined}>
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
              placement="top"
              gutter={4}
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
            <Markdown
              text={previewText()}
              cacheKey={`${part.id}:preview`}
              stage={props.markdownStage}
              onStage={props.onMarkdownStage}
              plain={true}
            />
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
      forceOpen={running() && !!body()}
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
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              placement="top"
              gutter={4}
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
  name: "websearch",
  render(props) {
    const query = createMemo(() => {
      const value = props.input.query
      if (typeof value !== "string") return ""
      return value
    })
    const title = createMemo(() => webSearchProviderLabel(props.metadata.provider))

    return (
      <BasicTool
        {...props}
        icon="window-cursor"
        trigger={{
          title: title(),
          subtitle: query(),
          subtitleClass: "exa-tool-query",
        }}
      >
        <ExaOutput output={props.output} />
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "task",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const childSessionId = () => props.metadata.sessionId as string | undefined
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    const type = createMemo(() => props.input.subagent_type || props.metadata.subagent_type || props.tool)
    const title = createMemo(() => i18n.t("ui.tool.agent", { type: type() }))
    const description = createMemo(() => {
      const value = props.input.description
      if (typeof value === "string") return value
      const meta = props.metadata.title
      if (typeof meta === "string") return meta
      return undefined
    })

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

    return (
      <BasicTool
        {...props}
        hideDetails
        icon="task"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title" class="capitalize agent-title">
                <Show when={pending()} fallback={title()}>
                  <TextShimmer text={title()} />
                </Show>
              </span>
              <Show when={description()}>
                <Switch>
                  <Match when={href()}>
                    {(url) => (
                      <a
                        data-slot="basic-tool-tool-subtitle"
                        class="clickable subagent-link"
                        href={url()}
                        onClick={handleLinkClick}
                      >
                        {description()}
                      </a>
                    )}
                  </Match>
                  <Match when={true}>
                    <span data-slot="basic-tool-tool-subtitle">{description()}</span>
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
        }
      />
    )
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

    const fileCompProps = createMemo(() => {
      try {
        if (props.metadata?.filediff) {
          const diff = normalize({
            ...props.metadata?.filediff,
            status: "modified",
          })
          const fileDiff = diff.fileDiff
          if (fileDiff) return { fileDiff, hunkSeparators: fileDiff.isPartial ? "simple" : "line-info-basic" }
        }
      } catch {}

      return {
        before: {
          name: props.metadata?.filediff?.file || props.input.filePath,
          contents: props.metadata?.filediff?.before || props.input.oldString || "",
        },
        after: {
          name: props.metadata?.filediff?.file || props.input.filePath,
          contents: props.metadata?.filediff?.after || props.input.newString || "",
        },
      }
    })

    return (
      <BasicTool
        {...props}
        icon="code-lines"
        defer
        trigger={
          <div data-component="edit-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text" class="tool-edit">
                  <Show when={pending()} fallback={i18n.t("ui.messagePart.title.edit")}>
                    <TextShimmer text={i18n.t("ui.messagePart.title.edit")} />
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
                <Show when={!pending() && props.metadata.filediff}>
                  <DiffChanges changes={props.metadata.filediff!} />
                </Show>
              }
            >
              <div data-component="edit-content">
                <Dynamic component={fileComponent} mode="diff" {...fileCompProps()} />
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
      <BasicTool
        {...props}
        icon="code-lines"
        defer
        trigger={
          <div data-component="write-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text" class="tool-edit">
                  <Show when={pending()} fallback={i18n.t("ui.messagePart.title.write")}>
                    <TextShimmer text={i18n.t("ui.messagePart.title.write")} />
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

ToolRegistry.register({
  name: "apply_patch",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const files = createMemo(() => patchFiles(props.metadata.files))
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
                    <Accordion.Header>
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
                    </Accordion.Header>
                    <Accordion.Content>
                      <Show when={visible()}>
                        <div data-component="apply-patch-file-diff">
                          <Dynamic
                            component={diffComponent}
                            before={{ name: file.filePath, contents: file.before }}
                            after={{ name: file.movePath ?? file.filePath, contents: file.after }}
                          />
                        </div>
                      </Show>
                    </Accordion.Content>
                  </Accordion.Item>
                )
              }}
            >
              <Show when={files().length > 0}>
                <Accordion
                  multiple
                  data-scope="apply-patch"
                  style={{ "--sticky-accordion-offset": "calc(32px + var(--tool-content-gap))" }}
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
                            <Show when={props.deferContent === false || visible()}>
                              <div data-component="apply-patch-file-diff">
                                <Dynamic
                                  component={fileComponent}
                                  mode="diff"
                                  fileDiff={file.view.fileDiff}
                                  hunkSeparators={file.view.fileDiff.isPartial ? "simple" : "line-info-basic"}
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
        <div data-component="apply-patch-tool">
          <BasicTool
            {...props}
            icon="code-lines"
            defer={props.deferContent !== false}
            trigger={
              <div data-component="edit-trigger">
                <div data-slot="message-part-title-area">
                  <div data-slot="message-part-title">
                    <span data-slot="message-part-title-text">
                      <TextShimmer text={i18n.t("ui.tool.patch")} active={pending()} />
                    </span>
                    <Show when={!pending()}>
                      <span data-slot="message-part-title-filename">{getFilename(single()!.relativePath)}</span>
                    </Show>
                  </div>
                  <Show when={!pending() && single()!.relativePath.includes("/")}>
                    <div data-slot="message-part-path">
                      <span data-slot="message-part-directory">{getDirectory(single()!.relativePath)}</span>
                    </div>
                  </Show>
                </div>
                <div data-slot="message-part-actions">
                  <Show when={!pending()}>
                    <DiffChanges changes={{ additions: single()!.additions, deletions: single()!.deletions }} />
                  </Show>
                </div>
              </div>
            }
          >
            <ToolFileAccordion
              path={single()!.relativePath}
              actions={
                <Switch>
                  <Match when={single()!.type === "add"}>
                    <span data-slot="apply-patch-change" data-type="added">
                      {i18n.t("ui.patch.action.created")}
                    </span>
                  </Match>
                  <Match when={single()!.type === "delete"}>
                    <span data-slot="apply-patch-change" data-type="removed">
                      {i18n.t("ui.patch.action.deleted")}
                    </span>
                  </Match>
                  <Match when={single()!.type === "move"}>
                    <span data-slot="apply-patch-change" data-type="modified">
                      {i18n.t("ui.patch.action.moved")}
                    </span>
                  </Match>
                  <Match when={true}>
                    <DiffChanges changes={{ additions: single()!.additions, deletions: single()!.deletions }} />
                  </Match>
                </Switch>
              }
            >
              <div data-component="apply-patch-file-diff">
                <Dynamic component={fileComponent} mode="diff" fileDiff={single()!.view.fileDiff} />
              </div>
            </ToolFileAccordion>
          </BasicTool>
        </div>
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

  const [collapsed, setCollapsed] = createSignal(false)

  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    editing: false,
  })

  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    return store.answers[store.tab]?.includes(value) ?? false
  })

  function submit() {
    const answers = questions().map((_, i) => store.answers[i] ?? [])
    data.replyToQuestion?.({
      requestID: props.request.id,
      answers,
    })
  }

  function reject() {
    data.rejectQuestion?.({
      requestID: props.request.id,
    })
  }

  function pick(answer: string, custom: boolean = false) {
    const answers = [...store.answers]
    answers[store.tab] = [answer]
    setStore("answers", answers)
    if (custom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }
    if (single()) {
      data.replyToQuestion?.({
        requestID: props.request.id,
        answers: [[answer]],
      })
      return
    }
    setStore("tab", store.tab + 1)
  }

  function toggle(answer: string) {
    const existing = store.answers[store.tab] ?? []
    const next = [...existing]
    const index = next.indexOf(answer)
    if (index === -1) next.push(answer)
    if (index !== -1) next.splice(index, 1)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
  }

  function selectTab(index: number) {
    setStore("tab", index)
    setStore("editing", false)
  }

  function selectOption(optIndex: number) {
    if (optIndex === options().length) {
      setStore("editing", true)
      return
    }
    const opt = options()[optIndex]
    if (!opt) return
    if (multi()) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  function handleCustomSubmit(e: Event) {
    e.preventDefault()
    const value = input().trim()
    if (!value) {
      setStore("editing", false)
      return
    }
    if (multi()) {
      const existing = store.answers[store.tab] ?? []
      const next = [...existing]
      if (!next.includes(value)) next.push(value)
      const answers = [...store.answers]
      answers[store.tab] = next
      setStore("answers", answers)
      setStore("editing", false)
      return
    }
    pick(value, true)
    setStore("editing", false)
  }

  return (
    <Collapsible open={!collapsed()} onOpenChange={(open) => setCollapsed(!open)}>
      <div data-component="question-prompt">
        <Show when={!single()}>
          <div data-slot="question-tabs">
            <For each={questions()}>
              {(q, index) => {
                const active = () => index() === store.tab
                const answered = () => (store.answers[index()]?.length ?? 0) > 0
                return (
                  <button
                    data-slot="question-tab"
                    data-active={active()}
                    data-answered={answered()}
                    onClick={() => selectTab(index())}
                  >
                    {q.header}
                  </button>
                )
              }}
            </For>
            <button data-slot="question-tab" data-active={confirm()} onClick={() => selectTab(questions().length)}>
              {i18n.t("ui.common.confirm")}
            </button>
          </div>
        </Show>

        <Show when={!confirm()}>
          <div data-slot="question-content">
            <Collapsible.Trigger>
              <div data-slot="question-text" data-collapsible>
                <span data-slot="question-text-content">
                  {question()?.question}
                  {multi() ? " " + i18n.t("ui.question.multiHint") : ""}
                </span>
                <Collapsible.Arrow />
              </div>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div data-slot="question-options">
                <For each={options()}>
                  {(opt, i) => {
                    const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
                    return (
                      <button data-slot="question-option" data-picked={picked()} onClick={() => selectOption(i())}>
                        <span data-slot="option-label">{opt.label}</span>
                        <Show when={opt.description}>
                          <span data-slot="option-description">{opt.description}</span>
                        </Show>
                        <Show when={picked()}>
                          <Icon name="check-small" size="normal" />
                        </Show>
                      </button>
                    )
                  }}
                </For>
                <button
                  data-slot="question-option"
                  data-picked={customPicked()}
                  onClick={() => selectOption(options().length)}
                >
                  <span data-slot="option-label">{i18n.t("ui.messagePart.option.typeOwnAnswer")}</span>
                  <Show when={!store.editing && input()}>
                    <span data-slot="option-description">{input()}</span>
                  </Show>
                  <Show when={customPicked()}>
                    <Icon name="check-small" size="normal" />
                  </Show>
                </button>
                <Show when={store.editing}>
                  <form data-slot="custom-input-form" onSubmit={handleCustomSubmit}>
                    <textarea
                      ref={(el) => setTimeout(() => el.focus(), 0)}
                      data-slot="custom-input"
                      placeholder={i18n.t("ui.question.custom.placeholder")}
                      value={input()}
                      rows={3}
                      onInput={(e) => {
                        const inputs = [...store.custom]
                        inputs[store.tab] = e.currentTarget.value
                        setStore("custom", inputs)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          handleCustomSubmit(e)
                        }
                      }}
                    />
                    <div data-slot="button-group">
                      <Button type="button" variant="ghost" size="normal" onClick={() => setStore("editing", false)}>
                        {i18n.t("ui.common.cancel")}
                      </Button>
                      <Button type="submit" variant="primary" size="normal">
                        {multi() ? i18n.t("ui.common.add") : i18n.t("ui.common.submit")}
                      </Button>
                    </div>
                  </form>
                </Show>
              </div>
            </Collapsible.Content>
          </div>
        </Show>

        <Show when={confirm()}>
          <div data-slot="question-review">
            <div data-slot="review-title">{i18n.t("ui.messagePart.review.title")}</div>
            <For each={questions()}>
              {(q, index) => {
                const value = () => store.answers[index()]?.join(", ") ?? ""
                const answered = () => Boolean(value())
                return (
                  <div data-slot="review-item">
                    <span data-slot="review-label">{q.question}</span>
                    <span data-slot="review-value" data-answered={answered()}>
                      {answered() ? value() : i18n.t("ui.question.review.notAnswered")}
                    </span>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>

        <div data-slot="question-actions">
          <Button variant="ghost" size="small" onClick={reject}>
            {i18n.t("ui.common.dismiss")}
          </Button>
          <Show when={!single()}>
            <Show when={confirm()}>
              <Button variant="primary" size="small" onClick={submit}>
                {i18n.t("ui.common.submit")}
              </Button>
            </Show>
            <Show when={!confirm() && multi()}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => selectTab(store.tab + 1)}
                disabled={(store.answers[store.tab]?.length ?? 0) === 0}
              >
                {i18n.t("ui.common.next")}
              </Button>
            </Show>
          </Show>
        </div>
      </div>
    )

    return <BasicTool icon="models" status={props.status} trigger={trigger()} hideDetails />
  },
})
