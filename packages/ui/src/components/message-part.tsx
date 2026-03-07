import { Component, createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js"
import stripAnsi from "strip-ansi"
import { createStore } from "solid-js/store"
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
import { GenericTool, ToolCall } from "./basic-tool"
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
import { list } from "./text-utils"
import { GrowBox } from "./grow-box"
import { COLLAPSIBLE_SPRING } from "./motion"
import { busy, hold, createThrottledValue, useToolFade, useContextToolPending } from "./tool-utils"
import { ContextToolGroupHeader, ContextToolExpandedList, ContextToolRollingResults } from "./context-tool-results"
import { ShellRollingResults } from "./shell-rolling-results"

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

export interface MessagePartProps {
  part: PartType
  message: MessageType
  hideDetails?: boolean
  defaultOpen?: boolean
  showAssistantCopyPartID?: string | null
  showTurnDiffSummary?: boolean
  turnDiffSummary?: () => JSX.Element
  animate?: boolean
  working?: boolean
}

export type PartComponent = Component<MessagePartProps>

export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

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
    case "task":
      return {
        icon: "task",
        title: i18n.t("ui.tool.agent"),
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
        title: i18n.t("ui.tool.skill"),
        subtitle: typeof input.name === "string" ? input.name : undefined,
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

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"])

import { pageVisible } from "../hooks/use-page-visible"

function createGroupOpenState() {
  const [state, setState] = createStore<Record<string, boolean>>({})
  const read = (key?: string, collapse?: boolean) => {
    if (!key) return true
    const value = state[key]
    if (value !== undefined) return value
    return !collapse
  }
  const controlled = (key?: string) => {
    if (!key) return false
    return state[key] !== undefined
  }
  const write = (key: string, value: boolean) => {
    setState(key, value)
  }
  return { read, controlled, write }
}

function shouldCollapseGroup(
  statuses: (string | undefined)[],
  opts: { afterTool?: boolean; groupTail?: boolean; working?: boolean },
) {
  if (opts.afterTool) return true
  if (opts.groupTail === false) return true
  if (!pageVisible()) return false
  if (opts.working) return false
  if (!statuses.length) return false
  return !statuses.some((s) => busy(s))
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
  if (tool === "edit" || tool === "write") return edit
  if (tool === "apply_patch") return false
}

function partDefaultOpen(part: PartType, shell = false, edit = false) {
  if (part.type !== "tool") return
  return toolDefaultOpen(part.tool, shell, edit)
}

function PartGrow(props: {
  children: JSX.Element
  animate?: boolean
  animateToggle?: boolean
  gap?: number
  fade?: boolean
  edge?: boolean
  edgeHeight?: number
  edgeOpacity?: number
  edgeIdle?: number
  edgeFade?: number
  edgeRise?: number
  grow?: boolean
  watch?: boolean
  open?: boolean
  spring?: import("./motion").SpringConfig
  toggleSpring?: import("./motion").SpringConfig
}) {
  return (
    <GrowBox
      animate={props.animate !== false}
      animateToggle={props.animateToggle}
      fade={props.fade}
      edge={props.edge}
      edgeHeight={props.edgeHeight}
      edgeOpacity={props.edgeOpacity}
      edgeIdle={props.edgeIdle}
      edgeFade={props.edgeFade}
      edgeRise={props.edgeRise}
      gap={props.gap}
      grow={props.grow}
      watch={props.watch}
      open={props.open}
      spring={props.spring}
      toggleSpring={props.toggleSpring}
      slot="assistant-part-grow"
    >
      {props.children}
    </GrowBox>
  )
}

export function AssistantParts(props: {
  messages: AssistantMessage[]
  showAssistantCopyPartID?: string | null
  showTurnDiffSummary?: boolean
  turnDiffSummary?: () => JSX.Element
  working?: boolean
  showReasoningSummaries?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  animate?: boolean
}) {
  const data = useData()
  const emptyParts: PartType[] = []
  const groupState = createGroupOpenState()
  const grouped = createMemo(() => {
    const keys: string[] = []
    const items: Record<
      string,
      | {
          type: "part"
          part: PartType
          message: AssistantMessage
          context?: boolean
          groupKey?: string
          afterTool?: boolean
          groupTail?: boolean
          groupParts?: { part: ToolPart; message: AssistantMessage }[]
        }
      | {
          type: "context"
          groupKey: string
          parts: { part: ToolPart; message: AssistantMessage }[]
          tail: boolean
          afterTool: boolean
        }
    > = {}
    const push = (key: string, item: (typeof items)[string]) => {
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

    const flush = (end: number, tail: boolean, afterTool: boolean) => {
      if (start < 0) return
      const group = parts
        .slice(start, end + 1)
        .filter((entry): entry is { part: ToolPart; message: AssistantMessage } => isContextGroupTool(entry.part))
      if (!group.length) {
        start = -1
        return
      }
      const groupKey = `context:${group[0].message.id}:${id(group[0].part)}`
      push(groupKey, {
        type: "context",
        groupKey,
        parts: group,
        tail,
        afterTool,
      })
      group.forEach((entry) => {
        push(`part:${entry.message.id}:${id(entry.part)}`, {
          type: "part",
          part: entry.part,
          message: entry.message,
          context: true,
          groupKey,
          afterTool,
          groupTail: tail,
          groupParts: group,
        })
      })
      start = -1
    }
    parts.forEach((item, index) => {
      if (isContextGroupTool(item.part)) {
        if (start < 0) start = index
        return
      }

      flush(index - 1, false, (item as { part: PartType }).part.type === "tool")
      push(`part:${item.message.id}:${id(item.part)}`, { type: "part", part: item.part, message: item.message })
    })

    flush(parts.length - 1, true, false)
    return { keys, items }
  })

  const last = createMemo(() => grouped().keys.at(-1))

  return (
    <div data-component="assistant-parts">
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
          const tail = createMemo(() => last() === key)
          const tool = createMemo(() => {
            const value = part()
            if (!value) return false
            return value.part.type === "tool"
          })
          const context = createMemo(() => !!part()?.context)
          const contextSpring = createMemo(() => {
            const entry = part()
            if (!entry?.context) return undefined
            if (!groupState.controlled(entry.groupKey)) return undefined
            return COLLAPSIBLE_SPRING
          })
          const contextOpen = createMemo(() => {
            const collapse = (
              afterTool?: boolean,
              groupTail?: boolean,
              group?: { part: ToolPart; message: AssistantMessage }[],
            ) =>
              shouldCollapseGroup(group?.map((item) => item.part.state.status) ?? [], {
                afterTool,
                groupTail,
                working: props.working,
              })
            const value = ctx()
            if (value) return groupState.read(value.groupKey, collapse(value.afterTool, value.tail, value.parts))
            const entry = part()
            return groupState.read(entry?.groupKey, collapse(entry?.afterTool, entry?.groupTail, entry?.groupParts))
          })
          const visible = createMemo(() => {
            if (!context()) return true
            if (ctx()) return true
            return false
          })

          const turnSummary = createMemo(() => {
            const value = part()
            if (!value) return false
            if (value.part.type !== "text") return false
            if (!props.showTurnDiffSummary) return false
            return props.showAssistantCopyPartID === value.part.id
          })
          const fade = createMemo(() => {
            if (ctx()) return true
            return tool()
          })
          const edge = createMemo(() => {
            const entry = part()
            if (!entry) return false
            if (entry.part.type !== "text") return false
            if (!props.working) return false
            return tail()
          })
          const watch = createMemo(() => !context() && !tool() && tail() && !turnSummary())
          const ctxPartsCache = new Map<string, ToolPart>()
          let ctxPartsPrev: ToolPart[] = []
          const ctxParts = createMemo(() => {
            const parts = ctx()?.parts ?? []
            if (parts.length === 0 && ctxPartsPrev.length > 0) return ctxPartsPrev
            const result: ToolPart[] = []
            for (const item of parts) {
              const k = item.part.callID || item.part.id
              const cached = ctxPartsCache.get(k)
              if (cached) {
                result.push(cached)
              } else {
                ctxPartsCache.set(k, item.part)
                result.push(item.part)
              }
            }
            ctxPartsPrev = result
            return result
          })
          const ctxPendingRaw = useContextToolPending(ctxParts, () => !!(props.working && ctx()?.tail))
          const ctxPending = ctxPendingRaw
          const ctxHoldOpen = hold(ctxPendingRaw)
          const shell = createMemo(() => {
            const value = part()
            if (!value) return
            if (value.part.type !== "tool") return
            if (value.part.tool !== "bash") return
            return value.part
          })
          const kind = createMemo(() => {
            if (ctx()) return "context"
            if (shell()) return "shell"
            const value = part()
            if (!value) return "part"
            return value.part.type
          })
          const shown = createMemo(() => {
            if (ctx()) return true
            if (shell()) return true
            const entry = part()
            if (!entry) return false
            return !entry.context
          })
          const partGrowProps = () => ({
            animate: props.animate,
            gap: 0,
            fade: fade(),
            edge: edge(),
            edgeHeight: 20,
            edgeOpacity: 0.95,
            edgeIdle: 100,
            edgeFade: 0.6,
            edgeRise: 0.1,
            grow: true,
            watch: watch(),
            animateToggle: true,
            open: visible(),
            toggleSpring: contextSpring(),
          })
          return (
            <Show when={shown()}>
              <div data-component="assistant-part-item" data-kind={kind()} data-last={tail() ? "true" : "false"}>
                <Show when={ctx()}>
                  {(entry) => (
                    <>
                      <PartGrow {...partGrowProps()}>
                        <ContextToolGroupHeader
                          parts={ctxParts()}
                          pending={ctxPending()}
                          open={contextOpen()}
                          onOpenChange={(value: boolean) => groupState.write(entry().groupKey, value)}
                        />
                      </PartGrow>
                      <ContextToolExpandedList parts={ctxParts()} expanded={!ctxPending() && contextOpen()} />
                      <ContextToolRollingResults parts={ctxParts()} pending={ctxHoldOpen()} />
                    </>
                  )}
                </Show>
                <Show when={shell()}>{(value) => <ShellRollingResults part={value()} animate={props.animate} />}</Show>
                <Show when={!shell() ? part() : undefined}>
                  {(entry) => (
                    <Show when={!entry().context}>
                      <PartGrow {...partGrowProps()}>
                        <div>
                          <Part
                            part={entry().part}
                            message={entry().message}
                            showAssistantCopyPartID={props.showAssistantCopyPartID}
                            showTurnDiffSummary={props.showTurnDiffSummary}
                            turnDiffSummary={props.turnDiffSummary}
                            defaultOpen={partDefaultOpen(
                              entry().part,
                              props.shellToolDefaultOpen,
                              props.editToolDefaultOpen,
                            )}
                            hideDetails={false}
                            animate={props.animate}
                            working={props.working}
                          />
                        </div>
                      </PartGrow>
                    </Show>
                  )}
                </Show>
              </div>
            </Show>
          )
        }}
      </For>
    </div>
  )
}

function isContextGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(part.tool)
}

function ExaOutput(props: { output?: string }) {
  const links = createMemo(() => urls(props.output))

  return (
    <Show when={links().length > 0}>
      <div data-component="exa-tool-output">
        <div data-slot="exa-tool-links">
          <For each={links()}>
            {(url) => (
              <a
                data-slot="exa-tool-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {url}
              </a>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

export function UserMessageDisplay(props: {
  message: UserMessage
  parts: PartType[]
  interrupted?: boolean
  animate?: boolean
  queued?: boolean
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

  const userMeta = createMemo(() => {
    const agent = props.message.agent
    const items = [agent ? agent[0]?.toUpperCase() + agent.slice(1) : "", model(), stamp()]
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
                    data-queued={props.queued ? "" : undefined}
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
                <div data-slot="user-message-text" data-queued={props.queued ? "" : undefined}>
                  <HighlightedText text={text()} references={inlineFiles()} agents={agents()} />
                </div>
                <GrowBox animate={!!props.animate} open={!!props.queued}>
                  <div data-slot="user-message-queued-indicator">
                    <TextShimmer text={i18n.t("ui.message.queued")} />
                  </div>
                </GrowBox>
              </div>
              <div data-slot="user-message-copy-wrapper" data-interrupted={props.interrupted ? "" : undefined}>
                <Show when={userMeta()}>
                  <span data-slot="user-message-meta" class="text-12-regular text-text-weak cursor-default">
                    {userMeta()}
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
        showTurnDiffSummary={props.showTurnDiffSummary}
        turnDiffSummary={props.turnDiffSummary}
        animate={props.animate}
        working={props.working}
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
      style={{ "--sticky-accordion-offset": "37px" }}
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
  const hideQuestion = createMemo(() => part.tool === "question" && busy(part.state.status))

  const emptyInput: Record<string, any> = {}
  const emptyMetadata: Record<string, any> = {}

  const input = () => part.state?.input ?? emptyInput
  // @ts-expect-error
  const partMetadata = () => part.state?.metadata ?? emptyMetadata

  const render = createMemo(() => ToolRegistry.render(part.tool) ?? GenericTool)

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
              component={render()}
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
  const part = () => props.part as TextPart

  const displayText = () => (part().text ?? "").trim()
  const throttledText = createThrottledValue(displayText)
  const summary = createMemo(() => {
    if (props.message.role !== "assistant") return
    if (!props.showTurnDiffSummary) return
    if (props.showAssistantCopyPartID !== part().id) return
    return props.turnDiffSummary
  })

  return (
    <Show when={throttledText()}>
      <div data-component="text-part">
        <div data-slot="text-part-body">
          <Markdown text={throttledText()} cacheKey={part().id} />
        </div>
        <Show when={summary()}>
          {(render) => (
            <GrowBox animate={!!props.animate} fade gap={4} class="w-full min-w-0">
              <div data-slot="text-part-turn-summary">{render()()}</div>
            </GrowBox>
          )}
        </Show>
      </div>
    </Show>
  )
}

PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
  const part = () => props.part as ReasoningPart
  const text = () => part().text.trim()
  const throttledText = createThrottledValue(text)

  return (
    <Show when={throttledText()}>
      <div data-component="reasoning-part">
        <Markdown text={throttledText()} cacheKey={part().id} />
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
      const value = props.metadata.loaded
      if (!value || !Array.isArray(value)) return []
      return value.filter((p): p is string => typeof p === "string")
    })
    const pending = createMemo(() => busy(props.status))
    return (
      <>
        <ToolCall
          variant="row"
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
            <ToolLoadedFile
              text={`${i18n.t("ui.tool.loaded")} ${relativizeProjectPath(filepath, data.directory)}`}
              animate={props.reveal}
            />
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
    const pending = createMemo(() => busy(props.status))
    return (
      <ToolCall
        variant="panel"
        {...props}
        icon="bullet-list"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.list")}
            pending={pending()}
            subtitle={getDirectory(props.input.path)}
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
      </ToolCall>
    )
  },
})

ToolRegistry.register({
  name: "glob",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => busy(props.status))
    return (
      <ToolCall
        variant="panel"
        {...props}
        icon="magnifying-glass-menu"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.glob")}
            pending={pending()}
            subtitle={getDirectory(props.input.path)}
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
      </ToolCall>
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
    const pending = createMemo(() => busy(props.status))
    return (
      <ToolCall
        variant="panel"
        {...props}
        icon="magnifying-glass-menu"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.grep")}
            pending={pending()}
            subtitle={getDirectory(props.input.path)}
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
      </ToolCall>
    )
  },
})

function useToolReveal(pending: () => boolean, animate?: () => boolean) {
  const enabled = () => animate?.() ?? true
  const [live, setLive] = createSignal(pending() || enabled())
  createEffect(() => {
    if (pending()) setLive(true)
  })
  return () => enabled() && live()
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

function ToolLoadedFile(props: { text: string; animate?: boolean }) {
  let ref: HTMLDivElement | undefined
  useToolFade(() => ref, { delay: 0.02, wipe: true, animate: props.animate })

  return (
    <GrowBox animate={props.animate !== false} fade={false} class="w-full min-w-0">
      <div ref={ref} data-component="tool-loaded-file">
        <Icon name="enter" size="small" />
        <span>{props.text}</span>
      </div>
    </GrowBox>
  )
}

function ToolTriggerRow(props: {
  title: string
  pending: boolean
  subtitle?: string
  args?: string[]
  action?: JSX.Element
  animate?: boolean
  revealOnMount?: boolean
}) {
  const reveal = useToolReveal(
    () => props.pending,
    () => props.animate !== false,
  )
  const detail = createMemo(() => [props.subtitle, ...(props.args ?? [])].filter((x): x is string => !!x).join(" "))
  const detailAnimate = createMemo(() => {
    if (props.animate === false) return false
    if (props.revealOnMount) return true
    if (!props.pending && !reveal()) return true
    return reveal()
  })

  return (
    <div data-slot="basic-tool-tool-info-structured">
      <div data-slot="basic-tool-tool-info-main">
        <span data-slot="basic-tool-tool-title">
          <TextShimmer text={props.title} active={props.pending} />
        </span>
        <Show when={detail()}>{(text) => <ToolText text={text()} animate={detailAnimate()} />}</Show>
      </div>
      <Show when={props.action}>{props.action}</Show>
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
  soft?: boolean
}) {
  let ref: HTMLSpanElement | undefined
  useToolFade(() => ref, { delay: props.delay ?? 0.02, wipe: true, animate: props.animate })

  return (
    <span
      ref={ref}
      data-slot={props.soft ? "basic-tool-tool-subtitle" : "message-part-meta-line"}
      classList={{
        "message-part-meta-line": !!props.soft,
        soft: !!props.soft,
      }}
    >
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
    const pending = createMemo(() => busy(props.status))
    const reveal = useToolReveal(pending, () => props.reveal !== false)
    const url = createMemo(() => {
      const value = props.input.url
      if (typeof value !== "string") return ""
      return value
    })
    return (
      <ToolCall
        variant="row"
        {...props}
        icon="window-cursor"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.webfetch")} active={pending()} />
              </span>
              <Show when={url()}>{(value) => <WebfetchMeta url={value()} animate={reveal()} />}</Show>
            </div>
          </div>
        }
      />
    )
  },
})

ToolRegistry.register({
  name: "websearch",
  render(props) {
    const i18n = useI18n()
    const query = createMemo(() => {
      const value = props.input.query
      if (typeof value !== "string") return ""
      return value
    })

    return (
      <ToolCall
        variant="panel"
        {...props}
        icon="window-cursor"
        trigger={{
          title: i18n.t("ui.tool.websearch"),
          subtitle: query(),
          subtitleClass: "exa-tool-query",
        }}
      >
        <ExaOutput output={props.output} />
      </ToolCall>
    )
  },
})

ToolRegistry.register({
  name: "codesearch",
  render(props) {
    const i18n = useI18n()
    const query = createMemo(() => {
      const value = props.input.query
      if (typeof value !== "string") return ""
      return value
    })

    return (
      <ToolCall
        variant="panel"
        {...props}
        icon="code"
        trigger={{
          title: i18n.t("ui.tool.codesearch"),
          subtitle: query(),
          subtitleClass: "exa-tool-query",
        }}
      >
        <ExaOutput output={props.output} />
      </ToolCall>
    )
  },
})

ToolRegistry.register({
  name: "task",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const childSessionId = () => props.metadata.sessionId as string | undefined
    const agentType = createMemo(() => {
      const raw = props.input.subagent_type
      if (typeof raw !== "string" || !raw) return undefined
      return raw[0]!.toUpperCase() + raw.slice(1)
    })
    const description = createMemo(() => {
      const value = props.input.description
      if (typeof value === "string") return value
      return undefined
    })
    const running = createMemo(() => busy(props.status))
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

    const trigger = () => (
      <div data-slot="basic-tool-tool-info-structured">
        <div data-slot="basic-tool-tool-info-main">
          <span data-slot="basic-tool-tool-title">
            <TextShimmer text={i18n.t("ui.tool.agent")} active={running()} />
          </span>
          <Show when={agentType()}>{(type) => <ToolText text={type()} animate={reveal()} />}</Show>
          <Show when={description()}>
            <Switch>
              <Match when={href()}>
                {(url) => (
                  <TaskLink href={url()} text={description() ?? ""} onClick={handleLinkClick} animate={reveal()} />
                )}
              </Match>
              <Match when={true}>
                <ToolText text={description() ?? ""} delay={0.02} animate={reveal()} />
              </Match>
            </Switch>
          </Show>
        </div>
      </div>
    )

    return <ToolCall variant="row" icon="task" status={props.status} trigger={trigger()} animate />
  },
})

ToolRegistry.register({
  name: "bash",
  render(props) {
    const i18n = useI18n()
    const pending = () => busy(props.status)
    const reveal = useToolReveal(pending, () => props.reveal !== false)
    const subtitle = () => props.input.description ?? props.metadata.description
    const cmd = createMemo(() => {
      const value = props.input.command ?? props.metadata.command
      if (typeof value === "string") return value
      return ""
    })
    const output = createMemo(() => {
      if (typeof props.output === "string") return props.output
      if (typeof props.metadata.output === "string") return props.metadata.output
      return ""
    })
    const command = createMemo(() => `$ ${cmd()}`)
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
      <ToolCall
        variant="panel"
        {...props}
        icon="console"
        animate
        springContent
        defaultOpen={false}
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
      </ToolCall>
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
    const pending = () => busy(props.status)
    const reveal = useToolReveal(pending, () => props.reveal !== false)
    return (
      <div data-component="edit-tool">
        <ToolCall
          variant="panel"
          {...props}
          icon="code-lines"
          defer
          trigger={
            <div data-component="edit-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.edit")} active={pending()} />
                  </span>
                  <Show when={filename()}>
                    {(name) => (
                      <ToolMetaLine
                        filename={name()}
                        path={props.input.filePath?.includes("/") ? getDirectory(props.input.filePath!) : undefined}
                        changes={props.metadata.filediff}
                        animate={reveal()}
                      />
                    )}
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
        </ToolCall>
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
    const pending = () => busy(props.status)
    const reveal = useToolReveal(pending, () => props.reveal !== false)
    return (
      <div data-component="write-tool">
        <ToolCall
          variant="panel"
          {...props}
          icon="code-lines"
          defer
          trigger={
            <div data-component="write-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.write")} active={pending()} />
                  </span>
                  <Show when={filename()}>
                    {(name) => (
                      <ToolMetaLine
                        filename={name()}
                        path={props.input.filePath?.includes("/") ? getDirectory(props.input.filePath!) : undefined}
                        animate={reveal()}
                      />
                    )}
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
        </ToolCall>
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
    const pending = createMemo(() => busy(props.status))
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
      <div data-component="apply-patch-tool">
        <ToolCall
          variant="panel"
          {...props}
          icon="code-lines"
          defer
          trigger={
            <div data-component={single() ? "edit-trigger" : "write-trigger"}>
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.tool.patch")} active={pending()} />
                  </span>
                  <Show when={single()}>
                    {(file) => (
                      <ToolMetaLine
                        filename={getFilename(file().relativePath)}
                        path={file().relativePath.includes("/") ? getDirectory(file().relativePath) : undefined}
                        changes={{ additions: file().additions, deletions: file().deletions }}
                        animate={reveal()}
                        soft
                      />
                    )}
                  </Show>
                  <Show when={!single() && subtitle()}>{(text) => <ToolText text={text()} animate={reveal()} />}</Show>
                </div>
              </div>
            </div>
          }
        >
          <Show
            when={single()}
            fallback={
              <Show when={files().length > 0}>
                <Accordion
                  multiple
                  data-scope="apply-patch"
                  style={{ "--sticky-accordion-offset": "37px" }}
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
            }
          >
            {(file) => (
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
            )}
          </Show>
        </ToolCall>
      </div>
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
    const pending = createMemo(() => busy(props.status))

    const subtitle = createMemo(() => {
      const list = todos()
      if (list.length === 0) return ""
      return `${list.filter((t: Todo) => t.status === "completed").length}/${list.length}`
    })

    return (
      <ToolCall
        variant="panel"
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
      </ToolCall>
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
    const pending = createMemo(() => busy(props.status))

    const subtitle = createMemo(() => {
      const count = questions().length
      if (count === 0) return ""
      if (completed()) return i18n.t("ui.question.subtitle.answered", { count })
      return `${count} ${i18n.t(count > 1 ? "ui.common.question.other" : "ui.common.question.one")}`
    })

    return (
      <ToolCall
        variant="panel"
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
      </ToolCall>
    )
  },
})

ToolRegistry.register({
  name: "skill",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => busy(props.status))
    const name = createMemo(() => {
      const value = props.input.name || props.metadata.name
      if (typeof value === "string") return value
    })
    return (
      <ToolCall
        variant="row"
        icon="brain"
        status={props.status}
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.skill")}
            pending={pending()}
            subtitle={name()}
            animate={props.reveal}
            revealOnMount
          />
        }
        animate
      />
    )
  },
})
