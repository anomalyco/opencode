// Current Session tool presentation grouped by visual family.
import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
  Index,
  type JSX,
} from "solid-js"
import stripAnsi from "strip-ansi"
import { Dynamic } from "solid-js/web"
import { type SessionSummary, useData } from "../context"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { type UiI18n, useI18n } from "@opencode-ai/ui/context/i18n"
import { BasicTool, GenericTool } from "../components/basic-tool"
import { Accordion } from "@opencode-ai/ui/accordion"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { ToolErrorCard } from "../components/tool-error-card"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Markdown } from "../components/markdown"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { AnimatedCountList } from "../components/tool-count-summary"
import { ToolStatusTitle } from "../components/tool-status-title"
import { patchFileGroups } from "../components/apply-patch-file"
import { animate } from "motion"
import { SessionProgressIndicatorV2 } from "../v2/components/session-progress-indicator-v2"
import type { SessionMessageAssistantTool, SessionMessageShell } from "@opencode-ai/client/promise"
import { currentToolInput, currentToolMetadata } from "../message/current-tool-state"
import { writeClipboard } from "../message/message-content"

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
    <span data-component="shell-submessage" dir="ltr">
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

type QuestionInfo = { question: string }
type QuestionAnswer = string[]

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function questionInfo(value: unknown): value is QuestionInfo {
  return record(value) && typeof value.question === "string"
}

function questionAnswer(value: unknown): value is QuestionAnswer {
  return Array.isArray(value) && value.every((answer) => typeof answer === "string")
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!value || typeof value !== "object") return false
  if (!("message" in value) || typeof value.message !== "string") return false
  if (!("range" in value) || !value.range || typeof value.range !== "object") return false
  return "start" in value.range && !!value.range.start && typeof value.range.start === "object"
}

function getDiagnostics(diagnosticsByFile: unknown, filePath: string | undefined): Diagnostic[] {
  if (!record(diagnosticsByFile) || !filePath) return []
  const diagnostics = diagnosticsByFile[filePath]
  if (!Array.isArray(diagnostics)) return []
  return diagnostics
    .filter(isDiagnostic)
    .filter((diagnostic) => diagnostic.severity === 1)
    .slice(0, 3)
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

function displayDirectory(path: string | undefined) {
  const data = useData()
  return relativizeProjectPath(getDirectory(path), data.directory)
}

import { resolveFileDiff } from "../components/session-diff"

export type ToolInfo = {
  icon: IconProps["name"]
  title: string
  subtitle?: string
}

function agentTitle(i18n: UiI18n, type?: string) {
  if (!type) return i18n.t("ui.tool.agent.default")
  return i18n.t("ui.tool.agent", { type })
}

const agentTones: Record<string, string> = {
  ask: "var(--icon-agent-ask-base)",
  build: "var(--icon-agent-build-base)",
  docs: "var(--icon-agent-docs-base)",
  plan: "var(--icon-agent-plan-base)",
}

const v2AgentTones: Record<string, string> = {
  build: "var(--v2-agent-build-solid)",
  explore: "var(--v2-agent-explore-solid)",
  plan: "var(--v2-agent-plan-solid)",
  review: "var(--v2-agent-review-solid)",
  writer: "var(--v2-agent-writer-solid)",
}

const agentThemeColors: Record<string, string> = {
  primary: "var(--text-interactive-base)",
  secondary: "var(--text-base)",
  accent: "var(--icon-info-base)",
  success: "var(--icon-success-base)",
  warning: "var(--icon-warning-base)",
  error: "var(--icon-critical-base)",
  info: "var(--icon-info-base)",
}

const v2AgentThemeColors: Record<string, string> = {
  primary: "var(--v2-text-text-accent)",
  secondary: "var(--v2-text-text-muted)",
  accent: "var(--v2-icon-icon-accent)",
  success: "var(--v2-state-fg-success)",
  warning: "var(--v2-state-fg-warning)",
  error: "var(--v2-state-fg-danger)",
  info: "var(--v2-state-fg-info)",
}

const agentPalette = [
  "var(--icon-agent-ask-base)",
  "var(--icon-agent-build-base)",
  "var(--icon-agent-docs-base)",
  "var(--icon-agent-plan-base)",
  "var(--syntax-info)",
  "var(--syntax-success)",
  "var(--syntax-warning)",
  "var(--syntax-property)",
  "var(--syntax-constant)",
  "var(--text-diff-add-base)",
  "var(--text-diff-delete-base)",
  "var(--icon-warning-base)",
]

function tone(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return agentPalette[hash % agentPalette.length]
}

function taskAgent(
  raw: unknown,
  list?: readonly { name: string; color?: string }[],
): { name?: string; color?: string; v2Color?: string } {
  if (typeof raw !== "string" || !raw) return {}
  const key = raw.toLowerCase()
  const item = list?.find((entry) => entry.name === raw || entry.name.toLowerCase() === key)
  const v2Tone = item?.color ? undefined : v2AgentTones[key]
  const color = agentColor(item?.color, agentThemeColors) ?? agentTones[key] ?? tone(key)
  const v2Color = agentColor(item?.color, v2AgentThemeColors) ?? v2Tone ?? color
  return {
    name: item?.name ?? `${raw[0].toUpperCase()}${raw.slice(1)}`,
    color,
    v2Color,
  }
}

function agentColor(value: string | undefined, themeColors: Record<string, string>) {
  if (!value) return undefined
  return themeColors[value] ?? value
}

function webSearchProviderLabel(provider: unknown, i18n: ReturnType<typeof useI18n>) {
  const name =
    provider === "parallel"
      ? "Parallel"
      : provider === "exa"
        ? "Exa"
        : provider === "firecrawl"
          ? "Firecrawl"
          : provider === "tavily"
            ? "Tavily"
            : undefined
  if (name) return i18n.t("ui.tool.websearch.provider", { provider: name })
  return i18n.t("ui.tool.websearch")
}

function readToolPath(input: Record<string, unknown>) {
  if (typeof input.path === "string") return input.path
  return undefined
}

function skillToolName(input: Record<string, unknown>, metadata?: Record<string, unknown>) {
  if (typeof metadata?.name === "string") return metadata.name
  if (typeof input.id === "string") return input.id
  if (typeof input.name === "string") return input.name
  return undefined
}

export function getToolInfo(
  tool: string,
  input: Record<string, unknown> = {},
  metadata: Record<string, unknown> | undefined = {},
): ToolInfo {
  const i18n = useI18n()
  switch (tool) {
    case "read": {
      const path = readToolPath(input)
      return {
        icon: "glasses",
        title: i18n.t("ui.tool.read"),
        subtitle: path ? getFilename(path) : undefined,
      }
    }
    case "list":
      return {
        icon: "bullet-list",
        title: i18n.t("ui.tool.list"),
        subtitle: typeof input.path === "string" ? getFilename(input.path) : undefined,
      }
    case "glob":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.glob"),
        subtitle: typeof input.pattern === "string" ? input.pattern : undefined,
      }
    case "grep":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.grep"),
        subtitle: typeof input.pattern === "string" ? input.pattern : undefined,
      }
    case "webfetch":
      return {
        icon: "window-cursor",
        title: i18n.t("ui.tool.webfetch"),
        subtitle: typeof input.url === "string" ? input.url : undefined,
      }
    case "websearch":
      return {
        icon: "window-cursor",
        title: webSearchProviderLabel(metadata?.provider, i18n),
        subtitle: typeof input.query === "string" ? input.query : undefined,
      }
    case "subagent": {
      const raw = input.agent
      const type = typeof raw === "string" && raw ? raw[0].toUpperCase() + raw.slice(1) : undefined
      return {
        icon: "task",
        title: agentTitle(i18n, type),
        subtitle: typeof input.description === "string" ? input.description : undefined,
      }
    }
    case "shell":
      return {
        icon: "console",
        title: i18n.t("ui.tool.shell"),
        subtitle: typeof input.command === "string" ? input.command : undefined,
      }
    case "execute":
      return {
        icon: "console",
        title: i18n.t("ui.tool.execute"),
        subtitle: typeof input.code === "string" ? input.code : undefined,
      }
    case "edit":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.edit"),
        subtitle: typeof input.path === "string" ? getFilename(input.path) : undefined,
      }
    case "write":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.write"),
        subtitle: typeof input.path === "string" ? getFilename(input.path) : undefined,
      }
    case "patch":
      return {
        icon: "code-lines",
        title: i18n.t("ui.tool.patch"),
        subtitle:
          Array.isArray(input.files) && input.files.length
            ? `${input.files.length} ${i18n.plural("ui.common.file", input.files.length)}`
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
        title: skillToolName(input, metadata) || i18n.t("ui.tool.skill"),
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

function sessionLink(id: string | undefined, href?: (id: string) => string | undefined) {
  if (!id) return undefined
  return href?.(id)
}

function taskSession(
  input: Record<string, unknown>,
  parentID: string | undefined,
  sessions: SessionSummary[] | undefined,
) {
  if (!parentID) return undefined
  const description = typeof input.description === "string" ? input.description : ""
  return (sessions ?? [])
    .filter((session) => session.parentID === parentID && !session.time?.archived)
    .filter((session) => (description ? session.title?.startsWith(description) : true))
    .sort((a, b) => (b.time.created ?? 0) - (a.time.created ?? 0))[0]?.id
}

function ExaOutput(props: { output?: string }) {
  const i18n = useI18n()
  const [showAll, setShowAll] = createSignal(false)
  let firstRevealedRef: HTMLAnchorElement | undefined
  const links = createMemo(() => urls(props.output))
  const visibleLinks = createMemo(() => {
    const all = links()
    if (showAll() || all.length <= 10) return all
    return all.slice(0, 10)
  })
  const remaining = createMemo(() => Math.max(0, links().length - 10))

  const expand = (event: MouseEvent) => {
    event.stopPropagation()
    setShowAll(true)
    requestAnimationFrame(() => {
      firstRevealedRef?.focus()
    })
  }

  return (
    <Show when={links().length > 0}>
      <div data-component="exa-tool-output">
        <div data-slot="exa-tool-links">
          <For each={visibleLinks()}>
            {(url, index) => (
              <a
                ref={(el) => {
                  if (index() === 10) firstRevealedRef = el
                }}
                data-slot="exa-tool-link"
                class="webfetch-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <span data-slot="webfetch-link-text">{url}</span>
                <Icon name="outline-square-arrow" class="webfetch-link-icon" />
              </a>
            )}
          </For>
          <Show when={!showAll() && remaining() > 0}>
            <button type="button" data-slot="exa-tool-more" onClick={expand}>
              {i18n.plural("ui.common.moreCount", remaining())}
            </button>
          </Show>
        </div>
      </div>
    </Show>
  )
}

export function CurrentContextToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  busy: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSizeChange?: () => void
}) {
  const i18n = useI18n()
  const pending = createMemo(
    () =>
      props.busy || props.tools.some((tool) => tool.state.status === "streaming" || tool.state.status === "running"),
  )
  const summary = createMemo(() => ({
    read: props.tools.filter((tool) => tool.name === "read").length,
    search: props.tools.filter((tool) => tool.name === "glob" || tool.name === "grep").length,
    list: props.tools.filter((tool) => tool.name === "list").length,
  }))
  const change = (open: boolean) => {
    props.onOpenChange(open)
    props.onSizeChange?.()
  }

  return (
    <Collapsible
      open={props.open}
      onOpenChange={change}
      variant="ghost"
      class="tool-collapsible"
      data-timeline-part-ids={props.tools.map((tool) => tool.id).join(",")}
    >
      <Collapsible.Trigger>
        <div data-component="context-tool-group-trigger">
          <span
            data-slot="context-tool-group-title"
            class="min-w-0 flex items-center gap-2 text-text-strong"
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
              class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-base"
            >
              <AnimatedCountList
                items={[
                  { key: "ui.messagePart.context.read", count: summary().read },
                  { key: "ui.messagePart.context.search", count: summary().search },
                  { key: "ui.messagePart.context.list", count: summary().list },
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
          <Index each={props.tools}>
            {(tool) => {
              const trigger = createMemo(() => currentContextToolTrigger(tool(), i18n))
              const running = () => tool().state.status === "streaming" || tool().state.status === "running"
              return (
                <div data-slot="context-tool-group-item">
                  <div data-component="tool-trigger">
                    <div data-slot="basic-tool-tool-trigger-content">
                      <div data-slot="basic-tool-tool-info">
                        <div data-slot="basic-tool-tool-info-structured">
                          <div data-slot="basic-tool-tool-info-main">
                            <span data-slot="basic-tool-tool-title">
                              <TextShimmer text={trigger().title} active={running()} />
                            </span>
                            <Show when={trigger().subtitle}>
                              <span data-slot="basic-tool-tool-subtitle">{trigger().subtitle}</span>
                            </Show>
                            <For each={trigger().args}>
                              {(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}
                            </For>
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

export function CurrentFileToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  fileOpen: (path: string) => boolean | undefined
  onFileOpenChange: (path: string, open: boolean) => void
  onSizeChange?: () => void
}) {
  const files = createMemo((previous: { key: string; value: unknown }[]) => {
    const next = props.tools.flatMap((tool) => {
      const files = currentToolMetadata(tool).files
      if (!Array.isArray(files)) return []
      return files.map((value, index) => ({ key: `${tool.id}:${index}`, value }))
    })
    const updates = new Map(next.map((entry) => [entry.key, entry.value]))
    const existing = new Set(previous.map((entry) => entry.key))
    const result = [
      ...previous.map((entry) => {
        if (!updates.has(entry.key)) return entry
        const value = updates.get(entry.key)
        return samePatchFile(value, entry.value) ? entry : { key: entry.key, value }
      }),
      ...next.filter((entry) => !existing.has(entry.key)),
    ]
    return result.length === previous.length && result.every((entry, index) => entry === previous[index])
      ? previous
      : result
  }, [])
  const metadata = createMemo(() => ({
    files: files().map((entry) => entry.value),
  }))
  const pending = createMemo(() =>
    props.tools.some((tool) => tool.state.status === "streaming" || tool.state.status === "running"),
  )
  const render = ToolRegistry.render("patch") ?? GenericTool
  const tool = createMemo(() => (props.tools[0]?.name === "edit" ? "edit" : "patch"))

  return (
    <div
      data-component="tool-part-wrapper"
      data-timeline-part-id={props.tools.length === 1 ? props.tools[0]?.id : undefined}
      data-timeline-part-ids={props.tools.length > 1 ? props.tools.map((tool) => tool.id).join(",") : undefined}
    >
      <Dynamic
        component={render}
        tool={tool()}
        input={{}}
        metadata={metadata()}
        status={pending() ? "running" : "completed"}
        fileOpen={props.fileOpen}
        onFileOpenChange={props.onFileOpenChange}
        deferContent
        virtualizeDiff={false}
        onContentRendered={props.onSizeChange}
      />
    </div>
  )
}

function samePatchFile(a: unknown, b: unknown) {
  if (a === b) return true
  if (!record(a) || !record(b)) return false
  return (
    a.file === b.file &&
    a.patch === b.patch &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.status === b.status
  )
}

function currentContextToolTrigger(tool: SessionMessageAssistantTool, i18n: ReturnType<typeof useI18n>) {
  const input = currentToolInput(tool)
  const metadata = currentToolMetadata(tool)
  const path = typeof input.path === "string" ? input.path : "/"
  const pattern = typeof input.pattern === "string" ? input.pattern : undefined
  const include = typeof input.include === "string" ? input.include : undefined
  const count = tool.name === "glob" ? metadata.count : tool.name === "grep" ? metadata.matches : undefined
  const matches =
    typeof count === "number" && Number.isFinite(count) && count !== 0
      ? i18n.plural("ui.messagePart.context.match", count)
      : undefined
  if (tool.name === "read") {
    const args = [
      ...(typeof input.offset === "number" ? [`offset=${input.offset}`] : []),
      ...(typeof input.limit === "number" ? [`limit=${input.limit}`] : []),
    ]
    return { title: i18n.t("ui.tool.read"), subtitle: getFilename(path), args }
  }
  if (tool.name === "list") return { title: i18n.t("ui.tool.list"), subtitle: displayDirectory(path), args: [] }
  if (tool.name === "glob")
    return {
      title: i18n.t("ui.tool.glob"),
      subtitle: displayDirectory(path),
      args: [...(pattern ? [`pattern=${pattern}`] : []), ...(matches ? [matches] : [])],
    }
  return {
    title: i18n.t("ui.tool.grep"),
    subtitle: displayDirectory(path),
    args: [
      ...(pattern ? [`pattern=${pattern}`] : []),
      ...(include ? [`include=${include}`] : []),
      ...(matches ? [matches] : []),
    ],
  }
}

export interface ToolProps {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  sessionID?: string
  output?: string
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  deferContent?: boolean
  virtualizeDiff?: boolean
  onContentRendered?: () => void
  forceOpen?: boolean
  locked?: boolean
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

function ToolFileAccordion(props: {
  path: string
  actions?: JSX.Element
  children: JSX.Element
  defaultOpen?: boolean
}) {
  const value = createMemo(() => props.path || "tool-file")

  return (
    <Accordion
      multiple
      data-scope="apply-patch"
      style={{ "--sticky-accordion-offset": "calc(28px + var(--tool-content-gap))" }}
      defaultValue={props.defaultOpen === false ? [] : [value()]}
    >
      <Accordion.Item value={value()}>
        <StickyAccordionHeader>
          <Accordion.Trigger>
            <div data-slot="apply-patch-trigger-content">
              <div data-slot="apply-patch-file-info">
                <FileIcon node={{ path: props.path, type: "file" }} />
                <div data-slot="apply-patch-file-name-container">
                  <Show when={props.path.includes("/")}>
                    <span data-slot="apply-patch-directory">{`\u202A${displayDirectory(props.path)}\u202C`}</span>
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

export function ToolDisplay(
  props: ToolProps & {
    id: string
    error?: string
  },
) {
  const data = useData()
  const i18n = useI18n()
  if (props.tool === "todowrite") return null
  const hideQuestion = () => props.tool === "question" && (props.status === "streaming" || props.status === "running")
  const taskId = createMemo(() => {
    if (props.tool !== "subagent") return undefined
    const value = props.metadata.sessionID
    if (typeof value === "string" && value) return value
    return undefined
  })
  const taskHref = createMemo(() => sessionLink(taskId(), data.sessionHref))
  const taskSubtitle = createMemo(() => {
    if (props.tool !== "subagent") return undefined
    const value = props.input.description
    if (typeof value === "string" && value) return value
    return taskId()
  })
  const error = createMemo(() => toolDisplayError(props, i18n.t("ui.toolErrorCard.failed")))
  const render = createMemo(() => ToolRegistry.render(props.tool) ?? GenericTool)

  return (
    <Show when={!hideQuestion()}>
      <div data-component="tool-part-wrapper" data-timeline-part-id={props.id}>
        <Switch>
          <Match when={error()}>
            {(error) => {
              const cleaned = error().replace("Error: ", "")
              if (props.tool === "question" && cleaned.includes("dismissed this question")) {
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
                  tool={props.tool}
                  error={error()}
                  title={props.tool === "websearch" ? webSearchProviderLabel(props.metadata.provider, i18n) : undefined}
                  defaultOpen={props.defaultOpen}
                  open={props.open}
                  onOpenChange={props.onOpenChange}
                  subtitle={taskSubtitle()}
                  href={taskHref()}
                  onSubtitleClick={(event) => {
                    if (!data.navigateToSession) return
                    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
                    const id = taskId()
                    if (!id) return
                    event.preventDefault()
                    data.navigateToSession(id)
                  }}
                />
              )
            }}
          </Match>
          <Match when={true}>
            <Dynamic component={render()} {...props} />
          </Match>
        </Switch>
      </div>
    </Show>
  )
}

function toolDisplayError(props: ToolProps & { error?: string }, fallback: string) {
  if (props.status === "error") return props.error
  if (props.tool !== "execute") return undefined
  const calls = props.metadata.toolCalls
  const failed =
    props.metadata.error === true ||
    (Array.isArray(calls) &&
      calls.some(
        (call) =>
          call !== null &&
          typeof call === "object" &&
          !Array.isArray(call) &&
          "status" in call &&
          call.status === "error",
      ))
  if (!failed) return undefined
  if (typeof props.output === "string" && props.output) return props.output
  return fallback
}

ToolRegistry.register({
  name: "read",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const args: string[] = []
    if (typeof props.input.offset === "number") args.push("offset=" + props.input.offset)
    if (typeof props.input.limit === "number") args.push("limit=" + props.input.limit)
    const loaded = createMemo(() => {
      if (props.status !== "completed") return []
      const value = props.metadata.loaded
      if (!value || !Array.isArray(value)) return []
      return value.filter((p): p is string => typeof p === "string")
    })
    return (
      <>
        <BasicTool
          {...props}
          icon="glasses"
          trigger={{
            title: i18n.t("ui.tool.read"),
            subtitle: getFilename(readToolPath(props.input) ?? ""),
            args,
          }}
        />
        <For each={loaded()}>
          {(filepath) => {
            const relative = relativizeProjectPath(filepath, data.directory)
            const path = relative === filepath ? relative : relative.replace(/^[/\\]/, "")
            const marker = "__OPENCODE_LOADED_PATH__"
            const parts = i18n.t("ui.tool.loadedFile", { path: marker }).split(marker)
            return (
              <div data-component="tool-loaded-item" aria-label={i18n.t("ui.tool.loadedFile", { path })}>
                <span data-slot="tool-loaded-label" aria-hidden="true">
                  {parts[0].trim()}
                </span>
                <span data-slot="tool-loaded-value" aria-hidden="true">
                  {path}
                </span>
                <Show when={parts[1]?.trim()}>
                  {(suffix) => (
                    <span data-slot="tool-loaded-kind" aria-hidden="true">
                      {suffix()}
                    </span>
                  )}
                </Show>
              </div>
            )
          }}
        </For>
      </>
    )
  },
})

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
          subtitle: displayDirectory(typeof props.input.path === "string" ? props.input.path : "/"),
        }}
      >
        <Show when={props.output}>
          <div
            data-component="tool-output"
            data-scrollable
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.scrollView.ariaLabel")}
          >
            <Markdown text={props.output!} />
          </div>
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
          subtitle: displayDirectory(typeof props.input.path === "string" ? props.input.path : "/"),
          args: typeof props.input.pattern === "string" ? ["pattern=" + props.input.pattern] : [],
        }}
      >
        <Show when={props.output}>
          <div
            data-component="tool-output"
            data-scrollable
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.scrollView.ariaLabel")}
          >
            <Markdown text={props.output!} />
          </div>
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
    if (typeof props.input.pattern === "string") args.push("pattern=" + props.input.pattern)
    if (typeof props.input.include === "string") args.push("include=" + props.input.include)
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.grep"),
          subtitle: displayDirectory(typeof props.input.path === "string" ? props.input.path : "/"),
          args,
        }}
      >
        <Show when={props.output}>
          <div
            data-component="tool-output"
            data-scrollable
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.scrollView.ariaLabel")}
          >
            <Markdown text={props.output!} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "webfetch",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => props.status === "streaming" || props.status === "running")
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
              <Show when={!pending() && url()}>
                <a
                  data-slot="basic-tool-tool-subtitle"
                  class="webfetch-link"
                  href={url()}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span data-slot="webfetch-link-text">{url()}</span>
                  <Icon name="outline-square-arrow" class="webfetch-link-icon" />
                </a>
              </Show>
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
    const title = createMemo(() => webSearchProviderLabel(props.metadata.provider, i18n))

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
  name: "subagent",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const delegating = () => props.status === "streaming"
    const childSessionId = createMemo(() => {
      const value = props.metadata.sessionID
      if (typeof value === "string" && value) return value
      return taskSession(props.input, data.sessionID, data.store.session)
    })
    const agent = createMemo(() => taskAgent(props.input.agent, data.store.agent))
    const title = createMemo(() => agent().name ?? i18n.t("ui.tool.agent.default"))
    const tone = createMemo(() => agent().color)
    const v2Tone = createMemo(() => agent().v2Color)
    const background = createMemo(() => {
      return props.metadata.background === true || (props.status === "completed" && props.metadata.status === "running")
    })
    const subtitle = createMemo(() => {
      const value =
        typeof props.input.description === "string" && props.input.description
          ? props.input.description
          : childSessionId()
      if (!value) return value
      if (background()) return `${value} (background)`
      return value
    })
    const running = createMemo(() => {
      if (props.status === "streaming" || props.status === "running") return true
      const id = childSessionId()
      if (!id) return false
      return (data.store.session_status[id]?.type ?? "idle") !== "idle"
    })

    const href = createMemo(() => sessionLink(childSessionId(), data.sessionHref))
    const clickable = createMemo(() => !!(childSessionId() && (data.navigateToSession || href())))

    const open = () => {
      const id = childSessionId()
      if (!id) return
      data.navigateToSession?.(id)
    }

    const navigate = (event: MouseEvent) => {
      if (!data.navigateToSession) return
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      open()
    }
    const navigateKey = (event: KeyboardEvent) => {
      if (!clickable() || href()) return
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      open()
    }

    const trigger = () => (
      <div
        data-component="task-tool-card"
        style={{
          "--task-agent-color": v2Tone(),
          "--task-agent-color-fallback": tone(),
        }}
      >
        <div data-component="task-tool-surface">
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <Show
                when={running()}
                fallback={
                  <span data-component="task-tool-icon">
                    <Icon name="subagent" size="small" />
                  </span>
                }
              >
                <span data-component="task-tool-spinner" style={{ color: tone() ?? "var(--icon-interactive-base)" }}>
                  <SessionProgressIndicatorV2
                    style={{ color: v2Tone() ?? "light-dark(var(--v2-text-text-base), #ffffff)" }}
                  />
                </span>
              </Show>
              <span data-component="task-tool-title">{title()}</span>
              <Show when={subtitle()}>
                <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>
              </Show>
            </div>
          </div>
        </div>
        <Show when={clickable()}>
          <div data-component="task-tool-action">
            <Icon name="square-arrow-top-right" size="small" />
          </div>
        </Show>
      </div>
    )

    return (
      <Show
        when={delegating()}
        fallback={
          <BasicTool
            icon="task"
            status={props.status}
            trigger={trigger()}
            hideDetails
            triggerAsLink
            triggerHref={href()}
            clickable={clickable()}
            onTriggerClick={navigate}
            onTriggerKeyDown={navigateKey}
          />
        }
      >
        <div
          data-component="task-tool-delegating"
          class="flex h-9 w-fit max-w-full items-center gap-2 rounded-[8px] bg-v2-background-bg-layer-01 p-2.5"
        >
          <Icon name="subagent" size="small" class="shrink-0 text-v2-icon-icon-faint" />
          <TextShimmer
            text={i18n.t("ui.tool.agent.delegating")}
            class="min-w-0 truncate text-[13px] font-[530] leading-none tracking-[-0.04px]"
          />
        </div>
      </Show>
    )
  },
})

function ConsoleOutput(props: { copy: string; children: JSX.Element }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)

  const copy = async () => {
    if (!props.copy) return
    if (!(await writeClipboard(props.copy))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div data-component="bash-output" dir="ltr">
      <div data-slot="bash-copy">
        <Tooltip value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")} placement="top">
          <IconButton
            icon={<Icon name={copied() ? "check" : "outline-copy"} size="small" />}
            size="normal"
            variant="ghost-muted"
            onMouseDown={(event) => event.preventDefault()}
            onClick={copy}
            aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
          />
        </Tooltip>
      </div>
      <div
        data-slot="bash-scroll"
        data-scrollable
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
      >
        <pre data-slot="bash-pre">
          <code>{props.children}</code>
        </pre>
      </div>
    </div>
  )
}

ToolRegistry.register({
  name: "execute",
  render(props) {
    const i18n = useI18n()
    const pending = () => props.status === "streaming" || props.status === "running"
    const code = createMemo(() => (typeof props.input.code === "string" ? props.input.code : ""))
    const text = createMemo(() => {
      const output = stripAnsi(props.output ?? "").replace(/\r\n?/g, "\n")
      return `${code()}${output ? "\n\n" + output : ""}`
    })
    const sawPending = pending()
    return (
      <BasicTool
        {...props}
        icon="console"
        rail={false}
        allowOpenWhilePending
        trigger={(open) => (
          <div data-slot="basic-tool-tool-info-structured">
            <span data-slot="basic-tool-tool-indicator">
              <Icon name="console" size="small" />
            </span>
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.execute")} active={pending()} />
              </span>
              <Show when={!open() && code()}>
                <ShellSubmessage text={code()} animate={sawPending} />
              </Show>
            </div>
          </div>
        )}
      >
        <ConsoleOutput copy={text()}>{text()}</ConsoleOutput>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "shell",
  render(props) {
    const i18n = useI18n()
    const streaming = () => props.status === "streaming"
    const pending = () => streaming() || props.status === "running" || props.metadata.status === "running"
    const sawStreaming = streaming()
    const command = () => {
      if (typeof props.input.command === "string") return props.input.command
      if (typeof props.metadata.command === "string") return props.metadata.command
      return ""
    }
    const text = createMemo(() => {
      const out = stripAnsi(props.output ?? "").replace(/\r\n?/g, "\n")
      return `${command()}${out ? "\n\n" + out : ""}`
    })
    return (
      <BasicTool
        {...props}
        icon="console"
        rail={false}
        allowOpenWhilePending
        trigger={(open) => (
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer
                  text={i18n.t("ui.tool.shell")}
                  active={pending()}
                />
              </span>
              <Show when={!open()}>
                <Show
                  when={command()}
                  fallback={
                    <Show when={streaming()}>
                      <span data-slot="basic-tool-tool-subtitle">{i18n.t("ui.tool.shell.writingCommand")}</span>
                    </Show>
                  }
                >
                  {(command) => <ShellSubmessage text={command()} animate={sawStreaming} />}
                </Show>
              </Show>
            </div>
          </div>
        )}
      >
        <ConsoleOutput copy={command()}>
          <span data-slot="bash-prompt" aria-hidden="true">
            {"$ "}
          </span>
          {text()}
        </ConsoleOutput>
      </BasicTool>
    )
  },
})

export function SessionShellMessage(props: {
  message: SessionMessageShell
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const render = ToolRegistry.render("shell") ?? GenericTool
  return (
    <div data-component="session-shell-message" data-timeline-part-id={props.message.id}>
      <Dynamic
        component={render}
        tool="shell"
        input={{ command: props.message.command }}
        metadata={{
          status: props.message.status,
          exit: props.message.exit,
          truncated: props.message.output?.truncated,
        }}
        output={props.message.output?.output}
        status={props.message.status === "running" ? "running" : "completed"}
        defaultOpen={props.defaultOpen}
        open={props.open}
        onOpenChange={props.onOpenChange}
      />
    </div>
  )
}

ToolRegistry.register({
  name: "edit",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const inputPath = () => (typeof props.input.path === "string" ? props.input.path : "")
    const diff = createMemo(() => {
      const files = props.metadata.files
      if (!Array.isArray(files)) return undefined
      const value = files.find(
        (file) => !!file && typeof file === "object" && "file" in file && typeof file.file === "string",
      )
      if (!value || typeof value !== "object") return undefined
      return value
    })
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, inputPath()))
    const path = createMemo(() => {
      const value = diff()
      return typeof value?.file === "string" ? value.file : inputPath()
    })
    const filename = () => getFilename(inputPath())
    const pending = () => props.status === "streaming" || props.status === "running"
    const diffSource = createMemo(
      () => {
        const source = diff()
        if (!source) return undefined
        return {
          file: typeof source.file === "string" ? source.file : inputPath(),
          patch: typeof source.patch === "string" ? source.patch : undefined,
        }
      },
      undefined,
      {
        equals: (a, b) => a?.file === b?.file && a?.patch === b?.patch,
      },
    )

    const fileCompProps = createMemo(() => {
      try {
        const source = diffSource()
        if (source) {
          const fileDiff = resolveFileDiff(source)
          if (fileDiff) return { fileDiff, hunkSeparators: fileDiff.isPartial ? "simple" : "line-info-basic" }
        }
      } catch {}

      return {
        before: {
          name: path(),
          contents: typeof props.input.oldString === "string" ? props.input.oldString : "",
        },
        after: {
          name: path(),
          contents: typeof props.input.newString === "string" ? props.input.newString : "",
        },
      }
    })

    return (
      <div data-component="edit-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          rail={false}
          defer={props.deferContent !== false}
          trigger={
            <div data-component="edit-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.edit")} active={pending()} />
                  </span>
                  <Show when={!pending()}>
                    <span data-slot="message-part-title-filename">{filename()}</span>
                  </Show>
                </div>
                <Show when={!pending() && inputPath().includes("/")}>
                  <div data-slot="message-part-path">
                    <span data-slot="message-part-directory">{displayDirectory(inputPath())}</span>
                  </div>
                </Show>
              </div>
              <div data-slot="message-part-actions">
                <Show when={!pending() ? diff() : undefined}>
                  {(diff) => <DiffChanges appearance="standard" changes={diff()} />}
                </Show>
              </div>
            </div>
          }
        >
          <Show when={path()}>
            <ToolFileAccordion
              path={path()}
              actions={
                <Show when={!pending() ? diff() : undefined}>
                  {(diff) => <DiffChanges appearance="standard" changes={diff()} />}
                </Show>
              }
            >
              <div data-component="edit-content">
                <Dynamic
                  component={fileComponent}
                  mode="diff"
                  virtualize={props.virtualizeDiff}
                  onRendered={props.onContentRendered}
                  {...fileCompProps()}
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
    const path = createMemo(() => (typeof props.input.path === "string" ? props.input.path : ""))
    const content = createMemo(() => (typeof props.input.content === "string" ? props.input.content : ""))
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, path()))
    const filename = () => getFilename(path())
    const pending = () => props.status === "streaming" || props.status === "running"
    return (
      <div data-component="write-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          rail={false}
          defer={props.deferContent !== false}
          trigger={
            <div data-component="write-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.write")} active={pending()} />
                  </span>
                  <Show when={!pending()}>
                    <span data-slot="message-part-title-filename">{filename()}</span>
                  </Show>
                </div>
                <Show when={!pending() && path().includes("/")}>
                  <div data-slot="message-part-path">
                    <span data-slot="message-part-directory">{displayDirectory(path())}</span>
                  </div>
                </Show>
              </div>
              <div data-slot="message-part-actions">{/* <DiffChanges diff={diff} /> */}</div>
            </div>
          }
        >
          <Show when={content() && path()}>
            <ToolFileAccordion path={path()}>
              <div data-component="write-content">
                <Dynamic
                  component={fileComponent}
                  mode="text"
                  file={{
                    name: path(),
                    contents: content(),
                    cacheKey: checksum(content()),
                  }}
                  overflow="scroll"
                  onRendered={props.onContentRendered}
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
  name: "patch",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const files = createMemo(() => patchFileGroups(props.metadata.files))
    const [expanded, setExpanded] = createSignal<string[]>([])
    const title = createMemo(() =>
      props.tool === "edit" ? i18n.t("ui.messagePart.title.edit") : i18n.t("ui.tool.patch"),
    )
    const open = createMemo(() => {
      if (!props.fileOpen) return expanded()
      return files().flatMap((file) => (props.fileOpen?.(file.path) === true ? [file.path] : []))
    })
    const change = (value: string | string[]) => {
      const next = Array.isArray(value) ? value : value ? [value] : []
      if (!props.onFileOpenChange) {
        setExpanded(next)
        return
      }
      files().forEach((file) => props.onFileOpenChange?.(file.path, next.includes(file.path)))
    }

    const subtitle = createMemo(() => {
      const count = files().length
      if (count === 0) return ""
      return `${count} ${i18n.plural("ui.common.file", count)}`
    })

    return (
      <div data-component="apply-patch-tool">
        <BasicTool
          {...props}
          open
          onOpenChange={undefined}
          locked
          icon="code-lines"
          defer={false}
          rail={false}
          trigger={{
            title: title(),
            subtitle: subtitle(),
          }}
        >
          <Show when={files().length > 0}>
            <Accordion
              multiple
              data-scope="apply-patch"
              style={{ "--sticky-accordion-offset": "calc(28px + var(--tool-content-gap))" }}
              value={open()}
              onChange={change}
            >
              <Index each={files()}>
                {(file) => {
                  const value = () => file().path
                  const active = createMemo(() => open().includes(value()))
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
                    <Accordion.Item value={value()} data-type={file().type}>
                      <StickyAccordionHeader>
                        <Accordion.Trigger>
                          <div data-slot="apply-patch-trigger-content">
                            <div data-slot="apply-patch-file-info">
                              <FileIcon node={{ path: file().path, type: "file" }} />
                              <div data-slot="apply-patch-file-name-container">
                                <Show when={file().path.includes("/")}>
                                  <span data-slot="apply-patch-directory">{`\u202A${displayDirectory(file().path)}\u202C`}</span>
                                </Show>
                                <span data-slot="apply-patch-filename">{getFilename(file().path)}</span>
                              </div>
                            </div>
                            <div data-slot="apply-patch-trigger-actions">
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
                                <Match when={true}>
                                  <DiffChanges
                                    appearance="standard"
                                    changes={{ additions: file().additions, deletions: file().deletions }}
                                  />
                                </Match>
                              </Switch>
                              <Icon name="chevron-grabber-vertical" size="small" />
                            </div>
                          </div>
                        </Accordion.Trigger>
                      </StickyAccordionHeader>
                      <Accordion.Content>
                        <Show when={props.deferContent === false || visible()}>
                          <For each={file().views}>
                            {(view) => (
                              <div data-component="apply-patch-file-diff">
                                <Dynamic
                                  component={fileComponent}
                                  mode="diff"
                                  virtualize={props.virtualizeDiff}
                                  fileDiff={view.fileDiff}
                                  hunkSeparators={view.fileDiff.isPartial ? "simple" : "line-info-basic"}
                                  onRendered={props.onContentRendered}
                                />
                              </div>
                            )}
                          </For>
                        </Show>
                      </Accordion.Content>
                    </Accordion.Item>
                  )
                }}
              </Index>
            </Accordion>
          </Show>
        </BasicTool>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "question",
  render(props) {
    const i18n = useI18n()
    const questions = createMemo(() =>
      Array.isArray(props.input.questions) ? props.input.questions.filter(questionInfo) : [],
    )
    const answers = createMemo(() =>
      Array.isArray(props.metadata.answers) ? props.metadata.answers.filter(questionAnswer) : [],
    )
    const completed = createMemo(() => answers().length > 0)

    const subtitle = createMemo(() => {
      const count = questions().length
      if (count === 0) return ""
      if (completed()) return i18n.t("ui.question.subtitle.answered", { count })
      return `${count} ${i18n.plural("ui.common.question", count)}`
    })

    return (
      <BasicTool
        {...props}
        defaultOpen={completed()}
        icon="bubble-5"
        trigger={{
          title: i18n.t("ui.tool.questions"),
          subtitle: subtitle(),
        }}
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
    const i18n = useI18n()
    const name = createMemo(() => skillToolName(props.input, props.metadata))
    const running = createMemo(() => props.status === "streaming" || props.status === "running")
    const marker = "__OPENCODE_LOADED_SKILL__"
    const parts = createMemo(() => i18n.t("ui.tool.loadedSkill", { name: marker }).split(marker))

    return (
      <Show when={name()} fallback={<TextShimmer text={i18n.t("ui.tool.skill")} active={running()} />}>
        {(name) => (
          <div data-component="tool-loaded-item" aria-label={i18n.t("ui.tool.loadedSkill", { name: name() })}>
            <span data-slot="tool-loaded-label" aria-hidden="true">
              {parts()[0].trim()}
            </span>
            <span data-slot="tool-loaded-value" aria-hidden="true">
              <TextShimmer as="span" text={name()} active={running()} />
            </span>
            <Show when={parts()[1]?.trim()}>
              {(suffix) => (
                <span data-slot="tool-loaded-kind" aria-hidden="true">
                  {suffix()}
                </span>
              )}
            </Show>
          </div>
        )}
      </Show>
    )
  },
})
