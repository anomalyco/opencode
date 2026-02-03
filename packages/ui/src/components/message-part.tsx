import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
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
  QuestionRequest,
  QuestionAnswer,
  QuestionInfo,
} from "@opencode-ai/sdk/v2"
import { createStore } from "solid-js/store"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"
import { useCodeComponent } from "../context/code"
import { useDialog } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { BasicTool } from "./basic-tool"
import { GenericTool } from "./basic-tool"
import { Button } from "./button"
import { Card } from "./card"
import { Icon } from "./icon"
import { Checkbox } from "./checkbox"
import { DiffChanges } from "./diff-changes"
import { Markdown } from "./markdown"
import { ImagePreview } from "./image-preview"
import { findLast } from "@opencode-ai/util/array"
import { getDirectory as _getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { Tooltip } from "./tooltip"
import { IconButton } from "./icon-button"
import { createAutoScroll } from "../hooks"
import { createResizeObserver } from "@solid-primitives/resize-observer"

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
}

export interface MessagePartProps {
  part: PartType
  message: MessageType
  hideDetails?: boolean
  defaultOpen?: boolean
}

export type PartComponent = Component<MessagePartProps>

export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

const TEXT_RENDER_THROTTLE_MS = 100

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

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

function relativizeProjectPaths(text: string, directory?: string) {
  if (!text) return ""
  if (!directory) return text
  return text.split(directory).join("")
}

function getDirectory(path: string | undefined) {
  const data = useData()
  return relativizeProjectPaths(_getDirectory(path), data.directory)
}

export function getSessionToolParts(store: ReturnType<typeof useData>["store"], sessionId: string): ToolPart[] {
  const messages = store.message[sessionId]?.filter((m) => m.role === "assistant")
  if (!messages) return []

  const parts: ToolPart[] = []
  for (const m of messages) {
    const msgParts = store.part[m.id]
    if (msgParts) {
      for (const p of msgParts) {
        if (p && p.type === "tool") parts.push(p as ToolPart)
      }
    }
  }
  return parts
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
    default:
      return {
        icon: "mcp",
        title: tool,
      }
  }
}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

export function Message(props: MessageProps) {
  return (
    <Switch>
      <Match when={props.message.role === "user" && props.message}>
        {(userMessage) => <UserMessageDisplay message={userMessage() as UserMessage} parts={props.parts} />}
      </Match>
      <Match when={props.message.role === "assistant" && props.message}>
        {(assistantMessage) => (
          <AssistantMessageDisplay message={assistantMessage() as AssistantMessage} parts={props.parts} />
        )}
      </Match>
    </Switch>
  )
}

export function AssistantMessageDisplay(props: { message: AssistantMessage; parts: PartType[] }) {
  const emptyParts: PartType[] = []
  const filteredParts = createMemo(
    () =>
      props.parts.filter((x) => {
        return x.type !== "tool" || (x as ToolPart).tool !== "todoread"
      }),
    emptyParts,
    { equals: same },
  )
  return <For each={filteredParts()}>{(part) => <Part part={part} message={props.message} />}</For>
}

export function UserMessageDisplay(props: { message: UserMessage; parts: PartType[] }) {
  const dialog = useDialog()
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const [canExpand, setCanExpand] = createSignal(false)
  let textRef: HTMLDivElement | undefined

  const updateCanExpand = () => {
    const el = textRef
    if (!el) return
    if (expanded()) return
    setCanExpand(el.scrollHeight > el.clientHeight + 2)
  }

  createResizeObserver(
    () => textRef,
    () => {
      updateCanExpand()
    },
  )

  const textPart = createMemo(
    () => props.parts?.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined,
  )

  const text = createMemo(() => textPart()?.text || "")

  createEffect(() => {
    text()
    updateCanExpand()
  })

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

  const toggleExpanded = () => {
    if (!canExpand()) return
    setExpanded((value) => !value)
  }

  return (
    <div data-component="user-message" data-expanded={expanded()} data-can-expand={canExpand()}>
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
        <div data-slot="user-message-text" ref={(el) => (textRef = el)} onClick={toggleExpanded}>
          <HighlightedText text={text()} references={inlineFiles()} agents={agents()} />
          <button
            data-slot="user-message-expand"
            type="button"
            aria-label={expanded() ? i18n.t("ui.message.collapse") : i18n.t("ui.message.expand")}
            onClick={(event) => {
              event.stopPropagation()
              toggleExpanded()
            }}
          >
            <Icon name="chevron-down" size="small" />
          </button>
          <div data-slot="user-message-copy-wrapper">
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              placement="top"
              gutter={8}
            >
              <IconButton
                icon={copied() ? "check" : "copy"}
                variant="secondary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation()
                  handleCopy()
                }}
                aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              />
            </Tooltip>
          </div>
        </div>
      </Show>
    </div>
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

PART_MAPPING["tool"] = function ToolPartDisplay(props) {
  const data = useData()
  const i18n = useI18n()
  const part = props.part as ToolPart

  const permission = createMemo(() => {
    const next = data.store.permission?.[props.message.sessionID]?.[0]
    if (!next || !next.tool) return undefined
    if (next.tool!.callID !== part.callID) return undefined
    return next
  })

  const questionRequest = createMemo(() => {
    const next = data.store.question?.[props.message.sessionID]?.[0]
    if (!next || !next.tool) return undefined
    if (next.tool!.callID !== part.callID) return undefined
    return next
  })

  const [showPermission, setShowPermission] = createSignal(false)
  const [showQuestion, setShowQuestion] = createSignal(false)

  createEffect(() => {
    const perm = permission()
    if (perm) {
      const timeout = setTimeout(() => setShowPermission(true), 50)
      onCleanup(() => clearTimeout(timeout))
    } else {
      setShowPermission(false)
    }
  })

  createEffect(() => {
    const question = questionRequest()
    if (question) {
      const timeout = setTimeout(() => setShowQuestion(true), 50)
      onCleanup(() => clearTimeout(timeout))
    } else {
      setShowQuestion(false)
    }
  })

  const [forceOpen, setForceOpen] = createSignal(false)
  createEffect(() => {
    if (permission() || questionRequest()) setForceOpen(true)
  })

  const respond = (response: "once" | "always" | "reject") => {
    const perm = permission()
    if (!perm || !data.respondToPermission) return
    data.respondToPermission({
      sessionID: perm.sessionID,
      permissionID: perm.id,
      response,
    })
  }

  const emptyInput: Record<string, any> = {}
  const emptyMetadata: Record<string, any> = {}

  const input = () => part.state?.input ?? emptyInput
  // @ts-expect-error
  const partMetadata = () => part.state?.metadata ?? emptyMetadata
  const metadata = () => {
    const perm = permission()
    if (perm?.metadata) return { ...perm.metadata, ...partMetadata() }
    return partMetadata()
  }

  const render = ToolRegistry.render(part.tool) ?? GenericTool

  return (
    <div data-component="tool-part-wrapper" data-permission={showPermission()} data-question={showQuestion()}>
      <Switch>
        <Match when={part.state.status === "error" && part.state.error}>
          {(error) => {
            const cleaned = error().replace("Error: ", "")
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
            metadata={metadata()}
            // @ts-expect-error
            output={part.state.output}
            status={part.state.status}
            hideDetails={props.hideDetails}
            forceOpen={forceOpen()}
            locked={showPermission() || showQuestion()}
            defaultOpen={props.defaultOpen}
          />
        </Match>
      </Switch>
      <Show when={showPermission() && permission()}>
        <div data-component="permission-prompt">
          <div data-slot="permission-actions">
            <Button variant="ghost" size="small" onClick={() => respond("reject")}>
              {i18n.t("ui.permission.deny")}
            </Button>
            <Button variant="secondary" size="small" onClick={() => respond("always")}>
              {i18n.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="small" onClick={() => respond("once")}>
              {i18n.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </div>
      </Show>
      <Show when={showQuestion() && questionRequest()}>{(request) => <QuestionPrompt request={request()} />}</Show>
    </div>
  )
}

PART_MAPPING["text"] = function TextPartDisplay(props) {
  const data = useData()
  const i18n = useI18n()
  const part = props.part as TextPart
  const displayText = () => relativizeProjectPaths((part.text ?? "").trim(), data.directory)
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
          <div data-slot="text-part-copy-wrapper">
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              placement="top"
              gutter={8}
            >
              <IconButton
                icon={copied() ? "check" : "copy"}
                variant="secondary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopy}
                aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </Show>
  )
}

PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
  const part = props.part as ReasoningPart
  const text = () => part.text.trim()
  const throttledText = createThrottledValue(text)

  return (
    <Show when={throttledText()}>
      <div data-component="reasoning-part">
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
    return (
      <>
        <BasicTool
          {...props}
          icon="glasses"
          trigger={{
            title: i18n.t("ui.tool.read"),
            subtitle: props.input.filePath ? getFilename(props.input.filePath) : "",
            args,
          }}
        />
        <For each={loaded()}>
          {(filepath) => (
            <div data-component="tool-loaded-file">
              <Icon name="enter" size="small" />
              <span>
                {i18n.t("ui.tool.loaded")} {relativizeProjectPaths(filepath, data.directory)}
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
    return (
      <BasicTool
        {...props}
        icon="bullet-list"
        trigger={{ title: i18n.t("ui.tool.list"), subtitle: getDirectory(props.input.path || "/") }}
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
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.glob"),
          subtitle: getDirectory(props.input.path || "/"),
          args: props.input.pattern ? ["pattern=" + props.input.pattern] : [],
        }}
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
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.grep"),
          subtitle: getDirectory(props.input.path || "/"),
          args,
        }}
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
  name: "webfetch",
  render(props) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="window-cursor"
        trigger={{
          title: i18n.t("ui.tool.webfetch"),
          subtitle: props.input.url || "",
          args: props.input.format ? ["format=" + props.input.format] : [],
          action: (
            <div data-component="tool-action">
              <Icon name="square-arrow-top-right" size="small" />
            </div>
          ),
        }}
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
  name: "task",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const summary = () =>
      (props.metadata.summary ?? []) as { id: string; tool: string; state: { status: string; title?: string } }[]

    const autoScroll = createAutoScroll({
      working: () => true,
      overflowAnchor: "auto",
    })

    const childSessionId = () => props.metadata.sessionId as string | undefined

    const childPermission = createMemo(() => {
      const sessionId = childSessionId()
      if (!sessionId) return undefined
      const permissions = data.store.permission?.[sessionId] ?? []
      return permissions[0]
    })

    const childToolPart = createMemo(() => {
      const perm = childPermission()
      if (!perm || !perm.tool) return undefined
      const sessionId = childSessionId()
      if (!sessionId) return undefined
      // Find the tool part that matches the permission's callID
      const messages = data.store.message[sessionId] ?? []
      const message = findLast(messages, (m) => m.id === perm.tool!.messageID)
      if (!message) return undefined
      const parts = data.store.part[message.id] ?? []
      for (const part of parts) {
        if (part.type === "tool" && (part as ToolPart).callID === perm.tool!.callID) {
          return { part: part as ToolPart, message }
        }
      }

      return undefined
    })

    const respond = (response: "once" | "always" | "reject") => {
      const perm = childPermission()
      if (!perm || !data.respondToPermission) return
      data.respondToPermission({
        sessionID: perm.sessionID,
        permissionID: perm.id,
        response,
      })
    }

    const handleSubtitleClick = () => {
      const sessionId = childSessionId()
      if (sessionId && data.navigateToSession) {
        data.navigateToSession(sessionId)
      }
    }

    const renderChildToolPart = () => {
      const toolData = childToolPart()
      if (!toolData) return null
      const { part } = toolData
      const render = ToolRegistry.render(part.tool) ?? GenericTool
      // @ts-expect-error
      const metadata = part.state?.metadata ?? {}
      const input = part.state?.input ?? {}
      return (
        <Dynamic
          component={render}
          input={input}
          tool={part.tool}
          metadata={metadata}
          // @ts-expect-error
          output={part.state.output}
          status={part.state.status}
          defaultOpen={true}
        />
      )
    }

    return (
      <div data-component="tool-part-wrapper" data-permission={!!childPermission()}>
        <Switch>
          <Match when={childPermission()}>
            <>
              <Show
                when={childToolPart()}
                fallback={
                  <BasicTool
                    icon="task"
                    defaultOpen={true}
                    trigger={{
                      title: i18n.t("ui.tool.agent", { type: props.input.subagent_type || props.tool }),
                      titleClass: "capitalize",
                      subtitle: props.input.description,
                    }}
                    onSubtitleClick={handleSubtitleClick}
                  />
                }
              >
                {renderChildToolPart()}
              </Show>
              <div data-component="permission-prompt">
                <div data-slot="permission-actions">
                  <Button variant="ghost" size="small" onClick={() => respond("reject")}>
                    {i18n.t("ui.permission.deny")}
                  </Button>
                  <Button variant="secondary" size="small" onClick={() => respond("always")}>
                    {i18n.t("ui.permission.allowAlways")}
                  </Button>
                  <Button variant="primary" size="small" onClick={() => respond("once")}>
                    {i18n.t("ui.permission.allowOnce")}
                  </Button>
                </div>
              </div>
            </>
          </Match>
          <Match when={true}>
            <BasicTool
              icon="task"
              defaultOpen={true}
              trigger={{
                title: i18n.t("ui.tool.agent", { type: props.input.subagent_type || props.tool }),
                titleClass: "capitalize",
                subtitle: props.input.description,
              }}
              onSubtitleClick={handleSubtitleClick}
            >
              <div
                ref={autoScroll.scrollRef}
                onScroll={autoScroll.handleScroll}
                data-component="tool-output"
                data-scrollable
              >
                <div ref={autoScroll.contentRef} data-component="task-tools">
                  <For each={summary()}>
                    {(item) => {
                      const info = getToolInfo(item.tool)
                      return (
                        <div data-slot="task-tool-item">
                          <Icon name={info.icon} size="small" />
                          <span data-slot="task-tool-title">{info.title}</span>
                          <Show when={item.state.title}>
                            <span data-slot="task-tool-subtitle">{item.state.title}</span>
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            </BasicTool>
          </Match>
        </Switch>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "bash",
  render(props) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="console"
        trigger={{
          title: i18n.t("ui.tool.shell"),
          subtitle: props.input.description,
        }}
      >
        <div data-component="tool-output" data-scrollable>
          <Markdown
            text={`\`\`\`command\n$ ${props.input.command ?? props.metadata.command ?? ""}${props.output || props.metadata.output ? "\n\n" + stripAnsi(props.output || props.metadata.output) : ""}\n\`\`\``}
          />
        </div>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "edit",
  render(props) {
    const i18n = useI18n()
    const diffComponent = useDiffComponent()
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, props.input.filePath))
    const filename = () => getFilename(props.input.filePath ?? "")
    return (
      <BasicTool
        {...props}
        icon="code-lines"
        trigger={
          <div data-component="edit-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text">{i18n.t("ui.messagePart.title.edit")}</span>
                <span data-slot="message-part-title-filename">{filename()}</span>
              </div>
              <Show when={props.input.filePath?.includes("/")}>
                <div data-slot="message-part-path">
                  <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                </div>
              </Show>
            </div>
            <div data-slot="message-part-actions">
              <Show when={props.metadata.filediff}>
                <DiffChanges changes={props.metadata.filediff} />
              </Show>
            </div>
          </div>
        }
      >
        <Show when={props.metadata.filediff?.path || props.input.filePath}>
          <div data-component="edit-content">
            <Dynamic
              component={diffComponent}
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
        </Show>
        <DiagnosticsDisplay diagnostics={diagnostics()} />
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "write",
  render(props) {
    const i18n = useI18n()
    const codeComponent = useCodeComponent()
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, props.input.filePath))
    const filename = () => getFilename(props.input.filePath ?? "")
    return (
      <BasicTool
        {...props}
        icon="code-lines"
        trigger={
          <div data-component="write-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text">{i18n.t("ui.messagePart.title.write")}</span>
                <span data-slot="message-part-title-filename">{filename()}</span>
              </div>
              <Show when={props.input.filePath?.includes("/")}>
                <div data-slot="message-part-path">
                  <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                </div>
              </Show>
            </div>
            <div data-slot="message-part-actions">{/* <DiffChanges diff={diff} /> */}</div>
          </div>
        }
      >
        <Show when={props.input.content}>
          <div data-component="write-content">
            <Dynamic
              component={codeComponent}
              file={{
                name: props.input.filePath,
                contents: props.input.content,
                cacheKey: checksum(props.input.content),
              }}
              overflow="scroll"
            />
          </div>
        </Show>
        <DiagnosticsDisplay diagnostics={diagnostics()} />
      </BasicTool>
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
    const diffComponent = useDiffComponent()
    const files = createMemo(() => (props.metadata.files ?? []) as ApplyPatchFile[])

    const subtitle = createMemo(() => {
      const count = files().length
      if (count === 0) return ""
      return `${count} ${i18n.t(count > 1 ? "ui.common.file.other" : "ui.common.file.one")}`
    })

    return (
      <BasicTool
        {...props}
        icon="code-lines"
        trigger={{
          title: i18n.t("ui.tool.patch"),
          subtitle: subtitle(),
        }}
      >
        <Show when={files().length > 0}>
          <div data-component="apply-patch-files">
            <For each={files()}>
              {(file) => (
                <div data-component="apply-patch-file">
                  <div data-slot="apply-patch-file-header">
                    <Switch>
                      <Match when={file.type === "delete"}>
                        <span data-slot="apply-patch-file-action" data-type="delete">
                          {i18n.t("ui.patch.action.deleted")}
                        </span>
                      </Match>
                      <Match when={file.type === "add"}>
                        <span data-slot="apply-patch-file-action" data-type="add">
                          {i18n.t("ui.patch.action.created")}
                        </span>
                      </Match>
                      <Match when={file.type === "move"}>
                        <span data-slot="apply-patch-file-action" data-type="move">
                          {i18n.t("ui.patch.action.moved")}
                        </span>
                      </Match>
                      <Match when={file.type === "update"}>
                        <span data-slot="apply-patch-file-action" data-type="update">
                          {i18n.t("ui.patch.action.patched")}
                        </span>
                      </Match>
                    </Switch>
                    <span data-slot="apply-patch-file-path">{file.relativePath}</span>
                    <Show when={file.type !== "delete"}>
                      <DiffChanges changes={{ additions: file.additions, deletions: file.deletions }} />
                    </Show>
                    <Show when={file.type === "delete"}>
                      <span data-slot="apply-patch-deletion-count">-{file.deletions}</span>
                    </Show>
                  </div>
                  <Show when={file.type !== "delete"}>
                    <div data-component="apply-patch-file-diff">
                      <Dynamic
                        component={diffComponent}
                        before={{ name: file.filePath, contents: file.before }}
                        after={{ name: file.filePath, contents: file.after }}
                      />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </BasicTool>
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
          subtitle: subtitle(),
        }}
      >
        <Show when={todos().length}>
          <div data-component="todos">
            <For each={todos()}>
              {(todo: Todo) => (
                <Checkbox readOnly checked={todo.status === "completed"}>
                  <div data-slot="message-part-todo-content" data-completed={todo.status === "completed"}>
                    {todo.content}
                  </div>
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

function QuestionPrompt(props: { request: QuestionRequest }) {
  const data = useData()
  const i18n = useI18n()
  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)

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
          <div data-slot="question-text">
            {question()?.question}
            {multi() ? " " + i18n.t("ui.question.multiHint") : ""}
          </div>
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
                <input
                  ref={(el) => setTimeout(() => el.focus(), 0)}
                  type="text"
                  data-slot="custom-input"
                  placeholder={i18n.t("ui.question.custom.placeholder")}
                  value={input()}
                  onInput={(e) => {
                    const inputs = [...store.custom]
                    inputs[store.tab] = e.currentTarget.value
                    setStore("custom", inputs)
                  }}
                />
                <Button type="submit" variant="primary" size="small">
                  {multi() ? i18n.t("ui.common.add") : i18n.t("ui.common.submit")}
                </Button>
                <Button type="button" variant="ghost" size="small" onClick={() => setStore("editing", false)}>
                  {i18n.t("ui.common.cancel")}
                </Button>
              </form>
            </Show>
          </div>
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
}
