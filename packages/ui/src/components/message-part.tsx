import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
  onCleanup,
  type JSX,
} from "solid-js"
import stripAnsi from "strip-ansi"
import { Dynamic } from "solid-js/web"
import {
  AgentPart,
  AssistantMessage,
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
import { useI18n } from "../context/i18n"
import { BasicTool } from "./basic-tool"
import { GenericTool } from "./basic-tool"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { Card } from "./card"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { Checkbox } from "./checkbox"
import { DiffChanges } from "./diff-changes"
import { Markdown } from "./markdown"
import { ImagePreview } from "./image-preview"
import { getDirectory as _getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { Tooltip } from "./tooltip"
import { IconButton } from "./icon-button"
import { TextShimmer } from "./text-shimmer"
import { AnimatedCountList } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"
import { GrowBox } from "./grow-box"
import { animate, type AnimationPlaybackControls, FADE_SPRING } from "./motion"

interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
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
  showAssistantCopyPartID?: string | null
  interrupted?: boolean
  animate?: boolean
  showReasoningSummaries?: boolean
}

export interface MessagePartProps {
  part: PartType
  message: MessageType
  hideDetails?: boolean
  defaultOpen?: boolean
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  animate?: boolean
}

export type PartComponent = Component<MessagePartProps>

export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

const TEXT_RENDER_THROTTLE_MS = 100

function createThrottledValue(getValue: () => string) {
  const [value, setValue] = createSignal(getValue())
  let timeout: ReturnType<typeof setTimeout> | undefined
  let last = 0

  createEffect(() => {
    const next = getValue()
    const now = Date.now()

    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last)
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      last = now
      setValue(next)
      return
    }
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      last = Date.now()
      setValue(next)
      timeout = undefined
    }, remaining)
  })

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
  })

  return value
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

export function getToolInfo(tool: string, input: any = {}): ToolInfo {
  const i18n = useI18n()
  switch (tool) {
    case "read":
      return {
        icon: "glasses",
        title: i18n.t("ui.tool.read"),
        subtitle: input.filePath ? getFilename(input.filePath) : undefined,
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
    case "task":
      return {
        icon: "task",
        title: i18n.t("ui.tool.agent", { type: input.subagent_type || "task" }),
        subtitle: input.description,
      }
    case "bash":
      return {
        icon: "console",
        title: i18n.t("ui.tool.shell"),
        subtitle: input.description,
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
    case "todoread":
      return {
        icon: "checklist",
        title: i18n.t("ui.tool.todos.read"),
      }
    case "question":
      return {
        icon: "bubble-5",
        title: i18n.t("ui.tool.questions"),
      }
    case "skill":
      return {
        icon: "brain",
        title: input.name || "skill",
      }
    default:
      return {
        icon: "mcp",
        title: tool,
      }
  }
}

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"])

function list<T>(value: T[] | undefined | null, fallback: T[]) {
  if (Array.isArray(value)) return value
  return fallback
}

function renderable(part: PartType, showReasoningSummaries = true) {
  if (part.type === "tool") {
    if (HIDDEN_TOOLS.has(part.tool)) return false
    if (part.tool === "question") return part.state.status !== "pending" && part.state.status !== "running"
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

function PartGrow(props: {
  children: JSX.Element
  animate?: boolean
  debugID?: string
  gap?: number
  fade?: boolean
  grow?: boolean
  watch?: boolean
}) {
  return (
    <GrowBox
      animate={props.animate !== false}
      fade={props.fade}
      gap={props.gap}
      grow={props.grow}
      watch={props.watch}
      slot="assistant-part-grow"
    >
      {props.children}
    </GrowBox>
  )
}

export function AssistantParts(props: {
  messages: AssistantMessage[]
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  working?: boolean
  showReasoningSummaries?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  animate?: boolean
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
    const id = (part: PartType) => {
      if (part.type === "tool") return part.callID || part.id
      return part.id
    }

    const parts = props.messages.flatMap((message) =>
      list(data.store.part?.[message.id], emptyParts)
        .filter((part) => renderable(part, props.showReasoningSummaries ?? true))
        .map((part) => ({ message, part })),
    )

    let start = -1

    const flush = (end: number) => {
      if (start < 0) return
      const first = parts[start]
      if (!first || !parts[end]) {
        start = -1
        return
      }
      push(`context:${first.message.id}:${id(first.part)}`, {
        type: "context",
        parts: parts
          .slice(start, end + 1)
          .map((x) => x.part)
          .filter((part): part is ToolPart => isContextGroupTool(part)),
      })
      start = -1
    }

    parts.forEach((item, index) => {
      if (isContextGroupTool(item.part)) {
        if (start < 0) start = index
        return
      }

      flush(index - 1)
      push(`part:${item.message.id}:${id(item.part)}`, { type: "part", part: item.part, message: item.message })
    })

    flush(parts.length - 1)

    return { keys, items }
  })

  const last = createMemo(() => grouped().keys.at(-1))

  return (
    <For each={grouped().keys}>
      {(key, idx) => {
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
        const tool = createMemo(() => {
          const value = part()
          if (!value) return false
          return value.part.type === "tool"
        })
        const fade = createMemo(() => {
          if (ctx()) return true
          return tool()
        })
        return (
          <PartGrow
            animate={props.animate}
            debugID={key}
            gap={idx() === 0 ? 0 : 6}
            fade={fade()}
            grow
            watch={!tool() && tail()}
          >
            <Show when={ctx()}>
              {(entry) => (
                <ContextToolGroup parts={entry().parts} busy={props.working && tail()} animate={props.animate} />
              )}
            </Show>
            <Show when={part()}>
              {(entry) => (
                <Part
                  part={entry().part}
                  message={entry().message}
                  showAssistantCopyPartID={props.showAssistantCopyPartID}
                  turnDurationMs={props.turnDurationMs}
                  defaultOpen={partDefaultOpen(entry().part, props.shellToolDefaultOpen, props.editToolDefaultOpen)}
                  animate={props.animate}
                />
              )}
            </Show>
          </PartGrow>
        )
      }}
    </For>
  )
}

function isContextGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(part.tool)
}

function contextToolDetail(part: ToolPart): string | undefined {
  const info = getToolInfo(part.tool, part.state.input ?? {})
  if (info.subtitle) return info.subtitle
  if (part.state.status === "error") return part.state.error
  if ((part.state.status === "running" || part.state.status === "completed") && part.state.title)
    return part.state.title
  const description = part.state.input?.description
  if (typeof description === "string") return description
  return undefined
}

function contextToolTrigger(part: ToolPart, i18n: ReturnType<typeof useI18n>) {
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const path = typeof input.path === "string" ? input.path : "/"
  const filePath = typeof input.filePath === "string" ? input.filePath : undefined
  const pattern = typeof input.pattern === "string" ? input.pattern : undefined
  const include = typeof input.include === "string" ? input.include : undefined
  const offset = typeof input.offset === "number" ? input.offset : undefined
  const limit = typeof input.limit === "number" ? input.limit : undefined

  switch (part.tool) {
    case "read": {
      const args: string[] = []
      if (offset !== undefined) args.push("offset=" + offset)
      if (limit !== undefined) args.push("limit=" + limit)
      return {
        title: i18n.t("ui.tool.read"),
        subtitle: filePath ? getFilename(filePath) : "",
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
      const info = getToolInfo(part.tool, input)
      return {
        title: info.title,
        subtitle: info.subtitle || contextToolDetail(part),
        args: [],
      }
    }
  }
}

function contextToolSummary(parts: ToolPart[]) {
  const read = parts.filter((part) => part.tool === "read").length
  const search = parts.filter((part) => part.tool === "glob" || part.tool === "grep").length
  const list = parts.filter((part) => part.tool === "list").length
  return { read, search, list }
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
            animate={props.animate}
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
      if (!renderable(part, props.showReasoningSummaries ?? true)) return

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
    <For each={grouped().keys}>
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
        return (
          <>
            <Show when={ctx()}>{(entry) => <ContextToolGroup parts={entry().parts} />}</Show>
            <Show when={part()}>
              {(entry) => (
                <Part
                  part={entry().part}
                  message={props.message}
                  showAssistantCopyPartID={props.showAssistantCopyPartID}
                />
              )}
            </Show>
          </>
        )
      }}
    </For>
  )
}

function ContextToolGroup(props: { parts: ToolPart[]; busy?: boolean; animate?: boolean }) {
  const i18n = useI18n()
  const anyRunning = createMemo(() =>
    props.parts.some((part) => part.state.status === "pending" || part.state.status === "running"),
  )
  // Once all parts are done and the group is no longer busy, latch into
  // "explored" permanently so brief status flickers can't jump it back.
  const [settled, setSettled] = createSignal(false)
  createEffect(() => {
    if (!anyRunning() && !props.busy) setSettled(true)
  })
  const pending = createMemo(() => !settled() && (!!props.busy || anyRunning()))
  const summary = createMemo(() => contextToolSummary(props.parts))

  return (
    <BasicTool
      icon="magnifying-glass-menu"
      animated
      animate
      trigger={
        <div data-component="context-tool-group-trigger">
          <span
            data-slot="context-tool-group-title"
            class="min-w-0 flex items-center gap-2 text-14-medium text-text-strong"
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
        </div>
      }
    >
      <div data-component="context-tool-group-list">
        <For each={props.parts}>
          {(part) => {
            const trigger = contextToolTrigger(part, i18n)
            const running = createMemo(() => part.state.status === "pending" || part.state.status === "running")
            const reveal = useToolReveal(running, () => props.animate !== false)
            return (
              <div data-slot="context-tool-group-item">
                <div data-component="tool-trigger">
                  <div data-slot="basic-tool-tool-trigger-content">
                    <div data-slot="basic-tool-tool-info">
                      <div data-slot="basic-tool-tool-info-structured">
                        <div data-slot="basic-tool-tool-info-main">
                          <span data-slot="basic-tool-tool-title">
                            <TextShimmer text={trigger.title} active={running()} />
                          </span>
                          <Show when={!running() && trigger.subtitle}>
                            {(text) => <ToolText text={text()} animate={reveal()} />}
                          </Show>
                          <Show when={!running() && trigger.args?.length}>
                            <For each={trigger.args}>
                              {(arg, idx) => <ToolArg text={arg} delay={0.02 * (idx() + 1)} animate={reveal()} />}
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
    </BasicTool>
  )
}

export function UserMessageDisplay(props: {
  message: UserMessage
  parts: PartType[]
  interrupted?: boolean
  animate?: boolean
}) {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)

  const textPart = createMemo(
    () => props.parts?.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined,
  )

  const text = createMemo(() => textPart()?.text || "")

  const files = createMemo(() => (props.parts?.filter((p) => p.type === "file") as FilePart[]) ?? [])

  const attachments = createMemo(() =>
    files()?.filter((f) => {
      const mime = f.mime
      return mime.startsWith("image/") || mime === "application/pdf"
    }),
  )

  const inlineFiles = createMemo(() =>
    files().filter((f) => {
      const mime = f.mime
      return !mime.startsWith("image/") && mime !== "application/pdf" && f.source?.text?.start !== undefined
    }),
  )

  const agents = createMemo(() => (props.parts?.filter((p) => p.type === "agent") as AgentPart[]) ?? [])

  const model = createMemo(() => {
    const providerID = props.message.model?.providerID
    const modelID = props.message.model?.modelID
    if (!providerID || !modelID) return ""
    const match = data.store.provider?.all?.find((p) => p.id === providerID)
    return match?.models?.[modelID]?.name ?? modelID
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

  const metaHead = createMemo(() => {
    const agent = props.message.agent
    const items = [agent ? agent[0]?.toUpperCase() + agent.slice(1) : "", model()]
    return items.filter((x) => !!x).join("\u00A0\u00B7\u00A0")
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
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <GrowBox animate={!!props.animate} fade class="w-full min-w-0 self-stretch max-w-full">
      <div data-component="user-message" data-interrupted={props.interrupted ? "" : undefined}>
        <div data-slot="user-message-inner">
          <Show when={attachments().length > 0}>
            <div data-slot="user-message-attachments">
              <For each={attachments()}>
                {(file) => (
                  <div
                    data-slot="user-message-attachment"
                    data-type={file.mime.startsWith("image/") ? "image" : "file"}
                    onClick={() => {
                      if (file.mime.startsWith("image/") && file.url) {
                        openImagePreview(file.url, file.filename)
                      }
                    }}
                  >
                    <Show
                      when={file.mime.startsWith("image/") && file.url}
                      fallback={
                        <div data-slot="user-message-attachment-icon">
                          <Icon name="folder" />
                        </div>
                      }
                    >
                      <img
                        data-slot="user-message-attachment-image"
                        src={file.url}
                        alt={file.filename ?? i18n.t("ui.message.attachment.alt")}
                      />
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={text()}>
            <>
              <div data-slot="user-message-body">
                <div data-slot="user-message-text">
                  <HighlightedText text={text()} references={inlineFiles()} agents={agents()} />
                </div>
              </div>
              <div data-slot="user-message-copy-wrapper" data-interrupted={props.interrupted ? "" : undefined}>
                <Show when={metaHead() || metaTail()}>
                  <span data-slot="user-message-meta-wrap">
                    <Show when={metaHead()}>
                      <span data-slot="user-message-meta" class="text-12-regular text-text-weak cursor-default">
                        {metaHead()}
                      </span>
                    </Show>
                    <Show when={metaHead() && metaTail()}>
                      <span data-slot="user-message-meta-sep" class="text-12-regular text-text-weak cursor-default">
                        {"\u00A0\u00B7\u00A0"}
                      </span>
                    </Show>
                    <Show when={metaTail()}>
                      <span data-slot="user-message-meta-tail" class="text-12-regular text-text-weak cursor-default">
                        {metaTail()}
                      </span>
                    </Show>
                  </span>
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
            </>
          </Show>
        </div>
      </div>
    </GrowBox>
  )
}

type HighlightSegment = { text: string; type?: "file" | "agent" }

function HighlightedText(props: { text: string; references: FilePart[]; agents: AgentPart[] }) {
  const segments = createMemo(() => {
    const text = props.text

    const allRefs: { start: number; end: number; type: "file" | "agent" }[] = [
      ...props.references
        .filter((r) => r.source?.text?.start !== undefined && r.source?.text?.end !== undefined)
        .map((r) => ({ start: r.source!.text!.start, end: r.source!.text!.end, type: "file" as const })),
      ...props.agents
        .filter((a) => a.source?.start !== undefined && a.source?.end !== undefined)
        .map((a) => ({ start: a.source!.start, end: a.source!.end, type: "agent" as const })),
    ].sort((a, b) => a.start - b.start)

    const result: HighlightSegment[] = []
    let lastIndex = 0

    for (const ref of allRefs) {
      if (ref.start < lastIndex) continue

      if (ref.start > lastIndex) {
        result.push({ text: text.slice(lastIndex, ref.start) })
      }

      result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
      lastIndex = ref.end
    }

    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex) })
    }

    return result
  })

  return <For each={segments()}>{(segment) => <span data-highlight={segment.type}>{segment.text}</span>}</For>
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
        animate={props.animate}
      />
    </Show>
  )
}

export interface ToolProps {
  input: Record<string, any>
  metadata: Record<string, any>
  tool: string
  partID?: string
  callID?: string
  output?: string
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  locked?: boolean
  animate?: boolean
  reveal?: boolean
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
    <Accordion
      multiple
      data-scope="apply-patch"
      style={{ "--sticky-accordion-offset": "40px" }}
      defaultValue={[value()]}
    >
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
  const i18n = useI18n()
  const part = props.part as ToolPart
  if (part.tool === "todowrite" || part.tool === "todoread") return null

  const hideQuestion = createMemo(
    () => part.tool === "question" && (part.state.status === "pending" || part.state.status === "running"),
  )

  const emptyInput: Record<string, any> = {}
  const emptyMetadata: Record<string, any> = {}

  const input = () => part.state?.input ?? emptyInput
  // @ts-expect-error
  const partMetadata = () => part.state?.metadata ?? emptyMetadata

  const render = ToolRegistry.render(part.tool) ?? GenericTool

  return (
    <Show when={!hideQuestion()}>
      <div data-component="tool-part-wrapper" data-tool={part.tool}>
        <Switch>
          <Match when={part.state.status === "error" && part.state.error}>
            {(error) => {
              const cleaned = error().replace("Error: ", "")
              if (part.tool === "question" && cleaned.includes("dismissed this question")) {
                return (
                  <div style="width: 100%; display: flex; justify-content: flex-end;">
                    <span class="text-13-regular text-text-weak cursor-default">
                      {i18n.t("ui.messagePart.questions.dismissed")}
                    </span>
                  </div>
                )
              }
              const [title, ...rest] = cleaned.split(": ")
              return (
                <Card variant="error">
                  <div data-component="tool-error">
                    <Icon name="circle-ban-sign" size="small" />
                    <Switch>
                      <Match when={title && title.length < 30}>
                        <div data-slot="message-part-tool-error-content">
                          <div data-slot="message-part-tool-error-title">{title}</div>
                          <span data-slot="message-part-tool-error-message">{rest.join(": ")}</span>
                        </div>
                      </Match>
                      <Match when={true}>
                        <span data-slot="message-part-tool-error-message">{cleaned}</span>
                      </Match>
                    </Switch>
                  </div>
                </Card>
              )
            }}
          </Match>
          <Match when={true}>
            <Dynamic
              component={render}
              input={input()}
              tool={part.tool}
              partID={part.id}
              callID={part.callID}
              metadata={partMetadata()}
              // @ts-expect-error
              output={part.state.output}
              status={part.state.status}
              hideDetails={props.hideDetails}
              defaultOpen={props.defaultOpen}
              animate
              reveal={props.animate}
            />
          </Match>
        </Switch>
      </div>
    </Show>
  )
}

PART_MAPPING["compaction"] = function CompactionPartDisplay() {
  const i18n = useI18n()
  return (
    <div data-component="compaction-part">
      <div data-slot="compaction-part-divider">
        <span data-slot="compaction-part-line" />
        <span data-slot="compaction-part-label" class="text-12-regular text-text-weak">
          {i18n.t("ui.messagePart.compaction")}
        </span>
        <span data-slot="compaction-part-line" />
      </div>
    </div>
  )
}

PART_MAPPING["text"] = function TextPartDisplay(props) {
  const data = useData()
  const i18n = useI18n()
  const part = props.part as TextPart
  const interrupted = createMemo(
    () =>
      props.message.role === "assistant" && (props.message as AssistantMessage).error?.name === "MessageAbortedError",
  )

  const model = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const message = props.message as AssistantMessage
    const match = data.store.provider?.all?.find((p) => p.id === message.providerID)
    return match?.models?.[message.modelID]?.name ?? message.modelID
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
    if (total < 60) return `${total}s`
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return `${minutes}m ${seconds}s`
  })

  const meta = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const agent = (props.message as AssistantMessage).agent
    const items = [
      agent ? agent[0]?.toUpperCase() + agent.slice(1) : "",
      model(),
      duration(),
      interrupted() ? i18n.t("ui.message.interrupted") : "",
    ]
    return items.filter((x) => !!x).join(" \u00B7 ")
  })

  const displayText = () => (part.text ?? "").trim()
  const throttledText = createThrottledValue(displayText)
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const content = displayText()
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Show when={throttledText()}>
      <div data-component="text-part">
        <div data-slot="text-part-body">
          <Markdown text={throttledText()} cacheKey={part.id} />
        </div>
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
      </div>
    </Show>
  )
}

PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
  const part = props.part as ReasoningPart
  const text = () => part.text.trim()
  const throttledText = createThrottledValue(text)
  let ref: HTMLDivElement | undefined
  useToolFade(() => ref, { animate: props.animate })

  return (
    <Show when={throttledText()}>
      <div ref={ref} data-component="reasoning-part">
        <Markdown text={throttledText()} cacheKey={part.id} />
      </div>
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
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    return (
      <>
        <BasicTool
          {...props}
          icon="glasses"
          trigger={
            <ToolTriggerRow
              title={i18n.t("ui.tool.read")}
              pending={pending()}
              subtitle={props.input.filePath ? getFilename(props.input.filePath) : ""}
              args={args}
              animate={props.reveal}
            />
          }
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

ToolRegistry.register({
  name: "list",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    return (
      <BasicTool
        {...props}
        icon="bullet-list"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.list")}
            pending={pending()}
            subtitle={getDirectory(props.input.path || "/")}
            animate={props.reveal}
          />
        }
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
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
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.glob")}
            pending={pending()}
            subtitle={getDirectory(props.input.path || "/")}
            args={props.input.pattern ? ["pattern=" + props.input.pattern] : []}
            animate={props.reveal}
          />
        }
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
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
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.grep")}
            pending={pending()}
            subtitle={getDirectory(props.input.path || "/")}
            args={args}
            animate={props.reveal}
          />
        }
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

const TOOL_WIPE_MASK =
  "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 60%, rgba(0,0,0,0) 100%)"

function useToolReveal(pending: () => boolean, animate?: () => boolean) {
  const [live, setLive] = createSignal(pending())

  createEffect(() => {
    if (pending()) setLive(true)
  })

  const enabled = () => animate?.() ?? true
  return () => enabled() && live()
}

function useToolFade(
  ref: () => HTMLElement | undefined,
  options?: { delay?: number; wipe?: boolean; animate?: boolean },
) {
  let anim: AnimationPlaybackControls | undefined
  let frame: number | undefined
  const delay = options?.delay ?? 0
  const wipe = options?.wipe ?? false
  const active = options?.animate !== false

  const clearMask = (el: HTMLElement) => {
    el.style.maskImage = ""
    el.style.webkitMaskImage = ""
    el.style.maskSize = ""
    el.style.webkitMaskSize = ""
    el.style.maskRepeat = ""
    el.style.webkitMaskRepeat = ""
    el.style.maskPosition = ""
    el.style.webkitMaskPosition = ""
  }

  onMount(() => {
    if (!active) return

    const el = ref()
    if (!el || typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const mask =
      wipe &&
      typeof CSS !== "undefined" &&
      (CSS.supports("mask-image", "linear-gradient(to right, black, transparent)") ||
        CSS.supports("-webkit-mask-image", "linear-gradient(to right, black, transparent)"))

    el.style.opacity = "0"
    el.style.filter = wipe ? "blur(3px)" : "blur(2px)"
    el.style.transform = wipe ? "translateX(-0.06em)" : "translateY(0.04em)"

    if (mask) {
      el.style.maskImage = TOOL_WIPE_MASK
      el.style.webkitMaskImage = TOOL_WIPE_MASK
      el.style.maskSize = "240% 100%"
      el.style.webkitMaskSize = "240% 100%"
      el.style.maskRepeat = "no-repeat"
      el.style.webkitMaskRepeat = "no-repeat"
      el.style.maskPosition = "100% 0%"
      el.style.webkitMaskPosition = "100% 0%"
    }

    frame = requestAnimationFrame(() => {
      frame = undefined
      const node = ref()
      if (!node) return

      anim = wipe
        ? mask
          ? animate(
              node,
              { opacity: 1, filter: "blur(0px)", transform: "translateX(0)", maskPosition: "0% 0%" },
              { ...FADE_SPRING, delay },
            )
          : animate(node, { opacity: 1, filter: "blur(0px)", transform: "translateX(0)" }, { ...FADE_SPRING, delay })
        : animate(node, { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" }, { ...FADE_SPRING, delay })

      anim?.finished.then(() => {
        const value = ref()
        if (!value) return
        value.style.opacity = ""
        value.style.filter = ""
        value.style.transform = ""
        if (mask) clearMask(value)
      })
    })
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    anim?.stop()
  })
}

function WebfetchMeta(props: { url: string; animate?: boolean }) {
  let ref: HTMLSpanElement | undefined
  useToolFade(() => ref, { wipe: true, animate: props.animate })

  return (
    <span ref={ref} data-slot="webfetch-meta">
      <a
        data-slot="basic-tool-tool-subtitle"
        class="clickable subagent-link"
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {props.url}
      </a>
      <div data-component="tool-action">
        <Icon name="square-arrow-top-right" size="small" />
      </div>
    </span>
  )
}

function TaskLink(props: { href: string; text: string; onClick: (e: MouseEvent) => void; animate?: boolean }) {
  let ref: HTMLAnchorElement | undefined
  useToolFade(() => ref, { wipe: true, animate: props.animate })

  return (
    <a
      ref={ref}
      data-slot="basic-tool-tool-subtitle"
      class="clickable subagent-link"
      href={props.href}
      onClick={props.onClick}
    >
      {props.text}
    </a>
  )
}

function ToolText(props: { text: string; delay?: number; animate?: boolean }) {
  let ref: HTMLSpanElement | undefined
  useToolFade(() => ref, { delay: props.delay, wipe: true, animate: props.animate })

  return (
    <span ref={ref} data-slot="basic-tool-tool-subtitle">
      {props.text}
    </span>
  )
}

function ToolArg(props: { text: string; delay?: number; animate?: boolean }) {
  let ref: HTMLSpanElement | undefined
  useToolFade(() => ref, { delay: props.delay, wipe: true, animate: props.animate })

  return (
    <span ref={ref} data-slot="basic-tool-tool-arg">
      {props.text}
    </span>
  )
}

function ToolTriggerRow(props: {
  title: string
  pending: boolean
  subtitle?: string
  args?: string[]
  action?: JSX.Element
  animate?: boolean
}) {
  const reveal = useToolReveal(
    () => props.pending,
    () => props.animate !== false,
  )

  return (
    <div data-slot="basic-tool-tool-info-structured">
      <div data-slot="basic-tool-tool-info-main">
        <span data-slot="basic-tool-tool-title">
          <TextShimmer text={props.title} active={props.pending} />
        </span>
        <Show when={!props.pending && props.subtitle}>{(text) => <ToolText text={text()} animate={reveal()} />}</Show>
        <Show when={!props.pending && props.args?.length}>
          <For each={props.args}>
            {(arg, idx) => <ToolArg text={arg} delay={0.02 * (idx() + 1)} animate={reveal()} />}
          </For>
        </Show>
      </div>
      <Show when={!props.pending && props.action}>{props.action}</Show>
    </div>
  )
}

type DiffValue = { additions: number; deletions: number } | { additions: number; deletions: number }[]

function ToolMetaLine(props: {
  filename: string
  path?: string
  changes?: DiffValue
  delay?: number
  animate?: boolean
}) {
  let ref: HTMLSpanElement | undefined
  useToolFade(() => ref, { delay: props.delay ?? 0.02, wipe: true, animate: props.animate })

  return (
    <span ref={ref} data-slot="message-part-meta-line">
      <span data-slot="message-part-title-filename">{props.filename}</span>
      <Show when={props.path}>
        <span data-slot="message-part-directory-inline">{props.path}</span>
      </Show>
      <Show when={props.changes}>{(changes) => <DiffChanges changes={changes()} />}</Show>
    </span>
  )
}

function ToolChanges(props: { changes: DiffValue; animate?: boolean }) {
  let ref: HTMLDivElement | undefined
  useToolFade(() => ref, { delay: 0.04, animate: props.animate })

  return (
    <div ref={ref}>
      <DiffChanges changes={props.changes} />
    </div>
  )
}

function ShellText(props: { text: string; animate?: boolean }) {
  let ref: HTMLSpanElement | undefined
  useToolFade(() => ref, { wipe: true, animate: props.animate })

  return (
    <span data-component="shell-submessage">
      <span data-slot="basic-tool-tool-subtitle">
        <span ref={ref} data-slot="shell-submessage-value">
          {props.text}
        </span>
      </span>
    </span>
  )
}

ToolRegistry.register({
  name: "webfetch",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    const reveal = useToolReveal(pending, () => props.reveal !== false)
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
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.webfetch")} active={pending()} />
              </span>
              <Show when={!pending() && url()}>{(value) => <WebfetchMeta url={value()} animate={reveal()} />}</Show>
            </div>
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
    const childSessionId = () => props.metadata.sessionId as string | undefined
    const title = createMemo(() => i18n.t("ui.tool.agent", { type: props.input.subagent_type || props.tool }))
    const description = createMemo(() => {
      const value = props.input.description
      if (typeof value === "string") return value
      return undefined
    })
    const running = createMemo(() => props.status === "pending" || props.status === "running")
    const reveal = useToolReveal(running, () => props.reveal !== false)

    const href = createMemo(() => {
      const sessionId = childSessionId()
      if (!sessionId) return

      const direct = data.sessionHref?.(sessionId)
      if (direct) return direct

      if (typeof window === "undefined") return
      const path = window.location.pathname
      const idx = path.indexOf("/session")
      if (idx === -1) return
      return `${path.slice(0, idx)}/session/${sessionId}`
    })

    const handleLinkClick = (e: MouseEvent) => {
      const sessionId = childSessionId()
      const url = href()
      if (!sessionId || !url) return

      e.stopPropagation()

      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const nav = data.navigateToSession
      if (!nav || typeof window === "undefined") return

      e.preventDefault()
      const before = window.location.pathname + window.location.search + window.location.hash
      nav(sessionId)
      setTimeout(() => {
        const after = window.location.pathname + window.location.search + window.location.hash
        if (after === before) window.location.assign(url)
      }, 50)
    }

    const titleContent = () => <TextShimmer text={title()} active={running()} />

    const trigger = () => (
      <div data-slot="basic-tool-tool-info-structured">
        <div data-slot="basic-tool-tool-info-main">
          <span data-slot="basic-tool-tool-title" class="capitalize agent-title">
            {titleContent()}
          </span>
          <Show when={description()}>
            <Switch>
              <Match when={href()}>
                {(url) => (
                  <TaskLink href={url()} text={description() ?? ""} onClick={handleLinkClick} animate={reveal()} />
                )}
              </Match>
              <Match when={true}>
                <ToolText text={description() ?? ""} animate={reveal()} />
              </Match>
            </Switch>
          </Show>
        </div>
      </div>
    )

    return <BasicTool icon="task" status={props.status} trigger={trigger()} hideDetails animate />
  },
})

ToolRegistry.register({
  name: "bash",
  render(props) {
    const i18n = useI18n()
    const pending = () => props.status === "pending" || props.status === "running"
    const reveal = useToolReveal(pending, () => props.reveal !== false)
    const subtitle = () => props.input.description ?? props.metadata.description
    const output = createMemo(() => {
      if (typeof props.output === "string") return props.output
      if (typeof props.metadata.output === "string") return props.metadata.output
      return ""
    })
    const command = createMemo(() => {
      const cmd = props.input.command ?? props.metadata.command ?? ""
      return `$ ${cmd}`
    })
    const result = createMemo(() => stripAnsi(output()))
    const text = createMemo(() => {
      const value = result()
      return `${command()}${value ? "\n\n" + value : ""}`
    })
    const hasOutput = createMemo(() => result().length > 0)
    const [copied, setCopied] = createSignal(false)

    const handleCopy = async () => {
      const content = text()
      if (!content) return
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    return (
      <BasicTool
        {...props}
        icon="console"
        animate
        animated
        defaultOpen={false}
        debugID={`bash:${props.callID ?? props.partID ?? "unknown"}`}
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.shell")} active={pending()} />
              </span>
              <Show when={subtitle()}>{(text) => <ShellText text={text()} animate={reveal()} />}</Show>
            </div>
          </div>
        }
      >
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
              <code>{text()}</code>
            </pre>
          </div>
        </div>
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
    const reveal = useToolReveal(pending, () => props.reveal !== false)
    return (
      <div data-component="edit-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          defer
          animated
          trigger={
            <div data-component="edit-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.edit")} active={pending()} />
                  </span>
                  <Show when={!pending()}>
                    <ToolMetaLine
                      filename={filename()}
                      path={props.input.filePath?.includes("/") ? getDirectory(props.input.filePath!) : undefined}
                      changes={props.metadata.filediff}
                      animate={reveal()}
                    />
                  </Show>
                </div>
              </div>
            </div>
          }
        >
          <Show when={path()}>
            <ToolFileAccordion
              path={path()}
              actions={
                <Show when={!pending() && props.metadata.filediff}>
                  {(diff) => <ToolChanges changes={diff()} animate={reveal()} />}
                </Show>
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
    const reveal = useToolReveal(pending, () => props.reveal !== false)
    return (
      <div data-component="write-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          defer
          animated
          trigger={
            <div data-component="write-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.write")} active={pending()} />
                  </span>
                  <Show when={!pending()}>
                    <ToolMetaLine
                      filename={filename()}
                      path={props.input.filePath?.includes("/") ? getDirectory(props.input.filePath!) : undefined}
                      animate={reveal()}
                    />
                  </Show>
                </div>
              </div>
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
    const reveal = useToolReveal(pending, () => props.reveal !== false)
    const single = createMemo(() => {
      const list = files()
      if (list.length !== 1) return
      return list[0]
    })
    const [expanded, setExpanded] = createSignal<string[]>([])
    let seeded = false

    createEffect(() => {
      const list = files()
      if (list.length === 0) return
      if (seeded) return
      seeded = true
      setExpanded(list.filter((f) => f.type !== "delete").map((f) => f.filePath))
    })

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
              animated
              trigger={
                <div data-component="write-trigger">
                  <div data-slot="message-part-title-area">
                    <div data-slot="message-part-title">
                      <span data-slot="message-part-title-text">
                        <TextShimmer text={i18n.t("ui.tool.patch")} active={pending()} />
                      </span>
                      <Show when={!pending() && subtitle()}>
                        {(text) => <ToolText text={text()} animate={reveal()} />}
                      </Show>
                    </div>
                  </div>
                </div>
              }
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
              animated
              trigger={
                <div data-component="edit-trigger">
                  <div data-slot="message-part-title-area">
                    <div data-slot="message-part-title">
                      <span data-slot="message-part-title-text">
                        <TextShimmer text={i18n.t("ui.tool.patch")} active={pending()} />
                      </span>
                      <Show when={!pending()}>
                        <ToolMetaLine
                          filename={getFilename(file().relativePath)}
                          path={file().relativePath.includes("/") ? getDirectory(file().relativePath) : undefined}
                          changes={{ additions: file().additions, deletions: file().deletions }}
                          animate={reveal()}
                        />
                      </Show>
                    </div>
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
                      <ToolChanges
                        changes={{ additions: file().additions, deletions: file().deletions }}
                        animate={reveal()}
                      />
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
    const pending = createMemo(() => props.status === "pending" || props.status === "running")

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
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.todos")}
            pending={pending()}
            subtitle={subtitle()}
            animate={props.reveal}
          />
        }
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
    const questions = createMemo(() => (props.input.questions ?? []) as QuestionInfo[])
    const answers = createMemo(() => (props.metadata.answers ?? []) as QuestionAnswer[])
    const completed = createMemo(() => answers().length > 0)
    const pending = createMemo(() => props.status === "pending" || props.status === "running")

    const subtitle = createMemo(() => {
      const count = questions().length
      if (count === 0) return ""
      if (completed()) return i18n.t("ui.question.subtitle.answered", { count })
      return `${count} ${i18n.t(count > 1 ? "ui.common.question.other" : "ui.common.question.one")}`
    })

    return (
      <BasicTool
        {...props}
        defaultOpen={false}
        icon="bubble-5"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.questions")}
            pending={pending()}
            subtitle={subtitle()}
            animate={props.reveal}
          />
        }
      >
        <Show when={completed()}>
          <div data-component="question-answers">
            <For each={questions()}>
              {(q, i) => {
                const answer = () => answers()[i()] ?? []
                return (
                  <div data-slot="question-answer-item">
                    <div data-slot="question-text">{q.question}</div>
                    <div data-slot="answer-text">{answer().join(", ") || i18n.t("ui.question.answer.none")}</div>
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
    const title = createMemo(() => props.input.name || "skill")
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

    return <BasicTool icon="brain" status={props.status} trigger={trigger()} hideDetails animate />
  },
})
