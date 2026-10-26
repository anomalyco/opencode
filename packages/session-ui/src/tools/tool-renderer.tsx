// Current Session tool presentation grouped by visual family.
import {
  Component,
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  Index,
  on,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Effect, Option, Schema } from "effect"
import { createTwoFilesPatch, diffLines } from "diff"
import { Dynamic } from "solid-js/web"
import { type SessionSummary, useData } from "../context"
import { useFileComponent } from "@opencode/ui/context/file"
import { type UiI18n, useI18n } from "@opencode/ui/context/i18n"
import { BasicTool, GenericTool } from "../components/basic-tool"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { ToolErrorCard } from "../components/tool-error-card"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { Markdown } from "../components/markdown"
import { createMarkdownImages } from "../components/markdown-image"
import { createImagePreview } from "../components/image-preview"
import { useMarkdown } from "../context/markdown"
import { getDirectory, getFilename } from "@opencode/util/path"
import { checksum } from "@opencode/util/encode"
import { Tooltip } from "@opencode/ui/tooltip"
import { IconButton } from "@opencode/ui/icon-button"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { AnimatedNumber } from "@opencode/ui/animated-number"
import { changedFileDiff, patchFileGroups } from "../components/apply-patch-file"
import { animate } from "@kitlangton/solid-motion"
import { SessionProgressIndicatorV2 } from "../v2/components/session-progress-indicator-v2"
import type {
  FileDiffInfo,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageShell,
} from "@opencode/client/promise"
import {
  currentToolError,
  currentToolGroupedRead,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
  executeToolFailed,
  readImagePath,
} from "../message/current-tool-state"
import { AssistantReasoningContent, writeClipboard } from "../message/message-content"
import { stripAnsi } from "./ansi"
import { followShellOutput } from "./shell-output"

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
        valueRef.animate?.(
          { opacity: [0, 1], filter: ["blur(2px)", "blur(0px)"] },
          { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        )
        valueRef.style.opacity = "1"
        valueRef.style.filter = "blur(0px)"
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

// Tool input and metadata are open records shared by every tool. Each field decodes on its own,
// so a malformed value drops only that field.
function optional<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const field = Schema.optional(schema)

  return Schema.catchDecoding<typeof field>(() => Effect.succeed(Option.none()))(field)
}

const toolInput = Schema.decodeUnknownSync(
  Schema.Struct({
    path: optional(Schema.String),
    pattern: optional(Schema.String),
    include: optional(Schema.String),
    offset: optional(Schema.Number),
    limit: optional(Schema.Number),
    url: optional(Schema.String),
    query: optional(Schema.String),
    agent: optional(Schema.String),
    description: optional(Schema.String),
    command: optional(Schema.String),
    code: optional(Schema.String),
    oldString: optional(Schema.String),
    newString: optional(Schema.String),
    content: optional(Schema.String),
    id: optional(Schema.String),
    name: optional(Schema.String),
    questions: optional(Schema.Array(Schema.Unknown)),
  }),
)

const toolMetadata = Schema.decodeUnknownSync(
  Schema.Struct({
    name: optional(Schema.String),
    provider: optional(Schema.String),
    sessionID: optional(Schema.String),
    command: optional(Schema.String),
    shellID: optional(Schema.String),
    status: optional(Schema.String),
    background: optional(Schema.Boolean),
    count: optional(Schema.Finite),
    matches: optional(Schema.Finite),
    files: optional(Schema.Array(Schema.Unknown)),
    loaded: optional(Schema.Array(Schema.Unknown)),
    answers: optional(Schema.Array(Schema.Unknown)),
    diagnostics: optional(Schema.Record(Schema.String, Schema.Array(Schema.Unknown))),
  }),
)

type ToolInput = ReturnType<typeof toolInput>

type ToolMetadata = ReturnType<typeof toolMetadata>

const decodeString = Schema.decodeUnknownOption(Schema.String)

const decodeQuestion = Schema.decodeUnknownOption(Schema.Struct({ question: Schema.String }))

const decodeAnswer = Schema.decodeUnknownOption(Schema.Array(Schema.String))

const decodeDiagnostic = Schema.decodeUnknownOption(
  Schema.Struct({
    range: Schema.Struct({ start: Schema.Struct({ line: Schema.Number, character: Schema.Number }) }),
    message: Schema.String,
    severity: Schema.optional(Schema.Number),
  }),
)

type Diagnostic = Option.Option.Value<ReturnType<typeof decodeDiagnostic>>

function questions(input: ToolInput) {
  return (input.questions ?? []).flatMap((question) => Option.toArray(decodeQuestion(question)))
}

function getDiagnostics(diagnosticsByFile: ToolMetadata["diagnostics"], filePath: string | undefined) {
  if (!filePath) return []

  return (diagnosticsByFile?.[filePath] ?? [])
    .flatMap((value) => Option.toArray(decodeDiagnostic(value)).filter((diagnostic) => diagnostic.severity === 1))
    .slice(0, 3)
}

function DiagnosticsDisplay(props: { diagnostics: readonly Diagnostic[] }): JSX.Element {
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

const agentTones = new Map([
  ["ask", "var(--icon-agent-ask-base)"],
  ["build", "var(--icon-agent-build-base)"],
  ["docs", "var(--icon-agent-docs-base)"],
  ["plan", "var(--icon-agent-plan-base)"],
])

const v2AgentTones = new Map([
  ["build", "var(--v2-agent-build-solid)"],
  ["explore", "var(--v2-agent-explore-solid)"],
  ["plan", "var(--v2-agent-plan-solid)"],
  ["review", "var(--v2-agent-review-solid)"],
  ["writer", "var(--v2-agent-writer-solid)"],
])

const agentThemeColors = new Map([
  ["primary", "var(--text-interactive-base)"],
  ["secondary", "var(--text-base)"],
  ["accent", "var(--icon-info-base)"],
  ["success", "var(--icon-success-base)"],
  ["warning", "var(--icon-warning-base)"],
  ["error", "var(--icon-critical-base)"],
  ["info", "var(--icon-info-base)"],
])

const v2AgentThemeColors = new Map([
  ["primary", "var(--v2-text-text-accent)"],
  ["secondary", "var(--v2-text-text-muted)"],
  ["accent", "var(--v2-icon-icon-accent)"],
  ["success", "var(--v2-state-fg-success)"],
  ["warning", "var(--v2-state-fg-warning)"],
  ["error", "var(--v2-state-fg-danger)"],
  ["info", "var(--v2-state-fg-info)"],
])

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

function taskAgent(raw: string | undefined, list?: readonly { name: string; color?: string }[]) {
  if (!raw) return {}
  const key = raw.toLowerCase()
  const item = list?.find((entry) => entry.name === raw || entry.name.toLowerCase() === key)
  const v2Tone = item?.color ? undefined : v2AgentTones.get(key)
  const color = agentColor(item?.color, agentThemeColors) ?? agentTones.get(key) ?? tone(key)
  const v2Color = agentColor(item?.color, v2AgentThemeColors) ?? v2Tone ?? color

  return {
    name: item?.name ?? `${raw[0].toUpperCase()}${raw.slice(1)}`,
    color,
    v2Color,
  }
}

function agentColor(value: string | undefined, themeColors: ReadonlyMap<string, string>) {
  if (!value) return undefined

  return themeColors.get(value) ?? value
}

const webSearchProviderNames = new Map([
  ["tinyfish", "TinyFish"],
  ["opencode", "OpenCode"],
])

function webSearchProviderLabel(provider: string | undefined, i18n: ReturnType<typeof useI18n>) {
  if (!provider) return i18n.t("ui.tool.websearch")
  const name = webSearchProviderNames.get(provider) ?? `${provider[0].toUpperCase()}${provider.slice(1)}`

  return i18n.t("ui.tool.websearch.provider", { provider: name })
}

function readArgs(input: ToolInput) {
  return [
    ...(input.offset === undefined ? [] : [`offset=${input.offset}`]),
    ...(input.limit === undefined ? [] : [`limit=${input.limit}`]),
  ]
}

function skillToolName(input: ToolInput, metadata: ToolMetadata) {
  return metadata.name ?? input.id ?? input.name
}

function currentSkillName(tool: SessionMessageAssistantTool) {
  return skillToolName(toolInput(currentToolInput(tool)), toolMetadata(currentToolMetadata(tool)))
}

// Context group labels name each tool once; detailed subtitles belong to the tool rows.
function toolTitle(tool: SessionMessageAssistantTool, i18n: UiI18n) {
  switch (tool.name) {
    case "read":
      return i18n.t("ui.tool.read")
    case "list":
      return i18n.t("ui.tool.list")
    case "glob":
      return i18n.t("ui.tool.glob")
    case "grep":
      return i18n.t("ui.tool.grep")
    case "browser":
      return i18n.t("ui.tool.browser")
    case "webfetch":
      return i18n.t("ui.tool.webfetch")
    case "websearch":
      return webSearchProviderLabel(toolMetadata(currentToolMetadata(tool)).provider, i18n)
    case "subagent":
      return i18n.t("ui.tool.agent.default")
    case "shell":
      return i18n.t("ui.tool.shell")
    case "execute":
      return i18n.t("ui.tool.execute")
    case "edit":
      return i18n.t("ui.messagePart.title.edit")
    case "write":
      return i18n.t("ui.messagePart.title.write")
    case "patch":
      return i18n.t("ui.tool.patch")
    case "question":
      return i18n.t("ui.tool.questions")
    case "skill":
      return i18n.t("ui.tool.skill")
    default:
      return tool.name
  }
}

function urls(text: string | undefined) {
  if (!text) return []

  return [
    ...new Set(Array.from(text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g), (item) => item[0].replace(/[),.;:!?]+$/g, ""))),
  ]
}

function sessionLink(id: string | undefined, href?: (id: string) => string | undefined) {
  if (!id) return undefined

  return href?.(id)
}

function taskSession(
  description: string | undefined,
  parentID: string | undefined,
  sessions: SessionSummary[] | undefined,
) {
  if (!parentID) return undefined

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

export type ContextGroupPart =
  | SessionMessageAssistantTool
  | (SessionMessageAssistantReasoning & { id: string; streaming?: boolean })
  | { type: "notice" | "shell"; id: string; render: () => JSX.Element }

export function CurrentContextToolGroup(props: {
  parts: ContextGroupPart[]
  busy: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSizeChange?: () => void
  reasoningDefaultOpen?: boolean
  reasoningOpen?: (id: string) => boolean | undefined
  onReasoningOpenChange?: (id: string, open: boolean) => void
  toolDefaultOpen?: (tool: SessionMessageAssistantTool) => boolean | undefined
  toolOpen?: (id: string) => boolean | undefined
  onToolOpenChange?: (id: string, open: boolean) => void
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  patchGroupKey?: (tools: SessionMessageAssistantTool[]) => string
}) {
  const i18n = useI18n()
  const tools = createMemo(() => props.parts.filter((part) => part.type === "tool"))

  const pending = createMemo(
    () => props.busy || tools().some((tool) => tool.state.status === "streaming" || tool.state.status === "running"),
  )

  const names = createMemo(() =>
    i18n.list([
      ...new Set(
        props.parts.flatMap((part) => {
          if (part.type !== "tool" && part.type !== "shell") return []

          return [part.type === "tool" ? toolTitle(part, i18n) : i18n.t("ui.tool.shell")]
        }),
      ),
    ]),
  )

  const label = createMemo(() => {
    const thoughts = props.parts.filter((part) => part.type === "reasoning").length

    if (!names() && !thoughts) {
      const text = i18n.t("ui.messagePart.context.updates")

      return { text, title: "", before: text, count: undefined, between: "", after: "" }
    }

    const title = names() || i18n.plural("ui.messagePart.context.thought", thoughts)
    const count = props.parts.filter((part) => part.type === "tool" || part.type === "shell").length || thoughts
    const text = i18n.plural("ui.messagePart.tools.used", count, { tools: title })
    const index = text.indexOf(title)
    const before = text.slice(0, index).trim()
    const countText = String(count)
    const countIndex = before.indexOf(countText)
    const after = text.slice(index + title.length).trim()

    if (countIndex === -1) return { text, title, before, count: undefined, between: "", after }

    return {
      text,
      title,
      before: before.slice(0, countIndex).trim(),
      count,
      between: before.slice(countIndex + countText.length).trim(),
      after,
    }
  })

  const items = createMemo(() =>
    (props.open ? props.parts : []).reduce<
      (SessionMessageAssistantTool[] | Exclude<ContextGroupPart, SessionMessageAssistantTool>)[]
    >((groups, tool) => {
      if (tool.type !== "tool") {
        groups.push(tool)

        return groups
      }

      const previous = groups.at(-1)

      if (isFileChangeTool(tool) && Array.isArray(previous) && previous[0] && isFileChangeTool(previous[0])) {
        previous.push(tool)

        return groups
      }

      if (
        currentToolGroupedRead(tool) &&
        Array.isArray(previous) &&
        previous[0] &&
        currentToolGroupedRead(previous[0])
      ) {
        previous.push(tool)

        return groups
      }

      if (
        tool.name === "skill" &&
        tool.state.status !== "error" &&
        currentSkillName(tool) &&
        Array.isArray(previous) &&
        previous?.[0]?.name === "skill" &&
        previous[0].state.status !== "error" &&
        currentSkillName(previous[0])
      ) {
        previous.push(tool)

        return groups
      }

      groups.push([tool])

      return groups
    }, []),
  )

  const patchKeys = createMemo(() => {
    const keys = new Map<SessionMessageAssistantTool, string>()
    items().forEach((item) => {
      if (!Array.isArray(item) || !item[0] || !isFileChangeTool(item[0])) return
      const key = props.patchGroupKey?.(item) ?? item[0].id
      item.forEach((tool) => keys.set(tool, key))
    })

    return keys
  })

  let root: HTMLDivElement | undefined

  const change = (open: boolean) => {
    // Collapsing from the stuck header would leave the viewport far below the group, so keep the header in place.
    // Scroll before collapsing because the shorter content would clamp the scroll position first.
    const trigger = root?.querySelector(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
    const stuck = !open && root && trigger ? trigger.getBoundingClientRect().top - root.getBoundingClientRect().top : 0

    if (stuck > 0 && root) scrollParent(root)?.scrollBy({ top: -stuck, behavior: "instant" })
    props.onOpenChange(open)
    props.onSizeChange?.()
  }

  return (
    <div
      ref={root}
      data-component="collapsed-tool-group"
      data-timeline-part-ids={props.parts.map((part) => part.id).join(",")}
    >
      <BasicTool
        icon="glasses"
        status={pending() ? "running" : "completed"}
        compact
        hasContent
        allowOpenWhilePending
        open={props.open}
        onOpenChange={change}
        trigger={
          <div data-component="context-tool-group-trigger" aria-label={label().text}>
            <span data-slot="context-tool-group-title">
              <Show when={label().before || label().count || label().between}>
                <span data-slot="context-tool-group-usage">
                  <Show when={label().before}>
                    {(before) => <span data-slot="context-tool-group-prefix">{before()}</span>}
                  </Show>
                  <Show when={label().count}>
                    {(count) => (
                      <span data-slot="context-tool-group-count">
                        <AnimatedNumber value={count()} />
                      </span>
                    )}
                  </Show>
                  <Show when={label().between}>
                    {(between) => <span data-slot="context-tool-group-prefix">{between()}</span>}
                  </Show>
                </span>
              </Show>
              <Show when={label().title}>{(title) => <span data-slot="basic-tool-tool-title">{title()}</span>}</Show>
              <Show when={label().after}>
                {(after) => <span data-slot="context-tool-group-prefix">{after()}</span>}
              </Show>
            </span>
          </div>
        }
      >
        <div data-component="context-tool-group-list">
          <Index each={items()}>
            {(item) => {
              const group = createMemo(() => {
                const value = item()

                return Array.isArray(value) ? value : undefined
              })

              const reasoning = createMemo(() => {
                const value = item()

                return !Array.isArray(value) && value.type === "reasoning" ? value : undefined
              })

              const callback = createMemo(() => {
                const value = item()

                return !Array.isArray(value) && (value.type === "notice" || value.type === "shell") ? value : undefined
              })

              return (
                <Show
                  when={group()}
                  fallback={
                    <Show
                      when={reasoning()}
                      fallback={
                        <Show when={callback()}>
                          {(part) => <div data-slot="context-tool-group-item">{part().render()}</div>}
                        </Show>
                      }
                    >
                      {(part) => (
                        <div data-slot="context-tool-group-item">
                          <AssistantReasoningContent
                            id={part().id}
                            content={part()}
                            streaming={part().streaming ?? false}
                            defaultOpen={props.reasoningDefaultOpen}
                            open={props.reasoningOpen?.(part().id)}
                            onOpenChange={(open) => props.onReasoningOpenChange?.(part().id, open)}
                            onContentRendered={props.onSizeChange}
                          />
                        </div>
                      )}
                    </Show>
                  }
                >
                  {(group) => {
                    const tool = createMemo(() => group()[0]!)
                    const trigger = createMemo(() => currentContextToolTrigger(tool(), i18n))

                    const skills = createMemo(() =>
                      group().flatMap((item) => {
                        const name = currentSkillName(item)

                        return name ? [name] : []
                      }),
                    )

                    const marker = "__OPENCODE_LOADED_SKILL__"

                    const loaded = createMemo(() =>
                      i18n.plural("ui.tool.loadedSkills", skills().length, { name: marker }),
                    )

                    return (
                      <div data-slot="context-tool-group-item">
                        <Show
                          when={!currentToolGroupedRead(tool())}
                          fallback={
                            <CurrentReadToolGroup
                              tools={group()}
                              open={props.toolOpen?.(tool().id)}
                              onOpenChange={(open) => props.onToolOpenChange?.(tool().id, open)}
                              onSizeChange={props.onSizeChange}
                            />
                          }
                        >
                          <Show
                            when={tool().state.status !== "error" && ["glob", "grep", "list"].includes(tool().name)}
                            fallback={
                              <Show
                                when={
                                  tool().name === "skill" && group().length > 1 && skills().length === group().length
                                }
                                fallback={
                                  <Show
                                    when={isFileChangeTool(tool())}
                                    fallback={
                                      <ToolDisplay
                                        id={tool().id}
                                        tool={tool().name}
                                        input={currentToolInput(tool())}
                                        metadata={currentToolMetadata(tool())}
                                        output={currentToolOutput(tool())}
                                        error={currentToolError(tool())}
                                        status={tool().state.status}
                                        defaultOpen={props.toolDefaultOpen?.(tool()) ?? false}
                                        open={props.toolOpen?.(tool().id) ?? props.toolDefaultOpen?.(tool())}
                                        onOpenChange={(open) => props.onToolOpenChange?.(tool().id, open)}
                                        deferContent
                                        virtualizeDiff={false}
                                        onContentRendered={props.onSizeChange}
                                      />
                                    }
                                  >
                                    <CurrentFileToolGroup
                                      tools={group()}
                                      fileOpen={
                                        props.fileOpen &&
                                        ((path) => props.fileOpen?.(`${patchKeys().get(tool())}:${path}`))
                                      }
                                      onFileOpenChange={
                                        props.onFileOpenChange &&
                                        ((path, open) =>
                                          props.onFileOpenChange?.(`${patchKeys().get(tool())}:${path}`, open))
                                      }
                                      onSizeChange={props.onSizeChange}
                                    />
                                  </Show>
                                }
                              >
                                <div
                                  data-component="tool-loaded-item"
                                  data-timeline-part-ids={group()
                                    .map((item) => item.id)
                                    .join(",")}
                                  aria-label={i18n.plural("ui.tool.loadedSkills", skills().length, {
                                    name: skills().join(", "),
                                  })}
                                >
                                  <span data-slot="tool-loaded-label" aria-hidden="true">
                                    {loaded().split(marker)[0]?.trim()}
                                  </span>
                                  <span data-slot="tool-loaded-value" aria-hidden="true">
                                    <For each={skills()}>
                                      {(name, index) => (
                                        <>
                                          <Show when={index() > 0}>, </Show>
                                          <TextShimmer
                                            as="span"
                                            text={name}
                                            active={["streaming", "running"].includes(group()[index()]!.state.status)}
                                          />
                                        </>
                                      )}
                                    </For>
                                  </span>
                                  <Show when={loaded().split(marker)[1]?.trim()}>
                                    {(suffix) => (
                                      <span data-slot="tool-loaded-kind" aria-hidden="true">
                                        {suffix()}
                                      </span>
                                    )}
                                  </Show>
                                </div>
                              </Show>
                            }
                          >
                            <div data-component="tool-trigger">
                              <div data-slot="basic-tool-tool-trigger-content">
                                <div data-slot="basic-tool-tool-info">
                                  <div data-slot="basic-tool-tool-info-structured">
                                    <div data-slot="basic-tool-tool-info-main">
                                      <span data-slot="basic-tool-tool-title">
                                        <TextShimmer
                                          text={trigger().title}
                                          active={
                                            tool().state.status === "streaming" || tool().state.status === "running"
                                          }
                                        />
                                      </span>
                                      <Show when={trigger().subtitle}>
                                        {(subtitle) => <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>}
                                      </Show>
                                      <For each={trigger().args}>
                                        {(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}
                                      </For>
                                    </div>
                                    <Show when={trigger().matches}>
                                      {(matches) => (
                                        <>
                                          <span data-slot="context-tool-group-dot" />
                                          <span data-slot="context-tool-group-matches">{matches()}</span>
                                        </>
                                      )}
                                    </Show>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </Show>
                        </Show>
                      </div>
                    )
                  }}
                </Show>
              )
            }}
          </Index>
        </div>
      </BasicTool>
    </div>
  )
}

export function CurrentReadToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSizeChange?: () => void
}) {
  const i18n = useI18n()
  const [state, setState] = createStore({ open: false, truncated: false })
  const open = () => props.open ?? state.open
  const expandable = () => open() || state.truncated

  const pending = createMemo(() =>
    props.tools.some((tool) => tool.state.status === "streaming" || tool.state.status === "running"),
  )

  const files = createMemo(() =>
    props.tools.flatMap((tool) => {
      const input = toolInput(currentToolInput(tool))
      const name = getFilename(input.path ?? "")

      return name ? [{ id: tool.id, name, args: readArgs(input) }] : []
    }),
  )

  let list: HTMLSpanElement | undefined

  const measure = () => {
    if (!list || open()) return
    setState("truncated", list.scrollWidth > list.clientWidth)
  }

  createResizeObserver(() => list, measure)
  createEffect(on(files, measure))

  const toggle = () => {
    if (!expandable()) return
    const next = !open()
    setState("open", next)
    props.onOpenChange?.(next)
    props.onSizeChange?.()
  }

  return (
    <div
      data-component="read-tool-group"
      data-timeline-part-ids={props.tools.map((tool) => tool.id).join(",")}
      data-expanded={open() ? "true" : undefined}
      role={expandable() ? "button" : undefined}
      tabIndex={expandable() ? 0 : undefined}
      aria-expanded={expandable() ? open() : undefined}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        toggle()
      }}
    >
      <div data-component="tool-trigger">
        <div data-slot="basic-tool-tool-trigger-content">
          <div data-slot="basic-tool-tool-info">
            <div data-slot="basic-tool-tool-info-structured">
              <div data-slot="basic-tool-tool-info-main">
                <span data-slot="basic-tool-tool-title">
                  <TextShimmer text={i18n.t("ui.tool.read")} active={pending()} />
                </span>
                <span ref={list} data-slot="basic-tool-tool-subtitle">
                  <Index each={files()}>
                    {(file, index) => (
                      <>
                        <Show when={index > 0}> </Show>
                        <span data-slot="read-tool-group-file" data-timeline-part-id={file().id}>
                          {file().name}
                          <For each={file().args}>
                            {(arg) => <span data-slot="basic-tool-tool-arg">{` ${arg}`}</span>}
                          </For>
                          <Show when={index < files().length - 1}>,</Show>
                        </span>
                      </>
                    )}
                  </Index>
                </span>
              </div>
            </div>
          </div>
        </div>
        <Show when={expandable()}>
          <span data-slot="read-tool-group-arrow" aria-hidden="true">
            <Icon name="fill-triangle-down" size="small" />
          </span>
        </Show>
      </div>
    </div>
  )
}

export function CurrentFileToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  onSizeChange?: () => void
}) {
  const files = createMemo((previous: { key: string; toolID: string; value: FileDiffInfo }[]) => {
    const next = props.tools.flatMap((tool) => {
      const files = toolMetadata(currentToolMetadata(tool)).files ?? []

      // Invalid entries render nothing, but metadata files still replace the input-derived preview.
      if (files.length > 0)
        return files.flatMap((value, index) =>
          changedFileDiff(value) ? [{ key: `${tool.id}:${index}`, toolID: tool.id, value }] : [],
        )
      const input = toolInput(currentToolInput(tool))

      if (input.path === undefined) return []

      if (tool.name === "edit" && input.oldString !== undefined && input.newString !== undefined) {
        const changes = diffLines(input.oldString, input.newString)

        const additions = changes
          .filter((change) => change.added)
          .reduce((total, change) => total + (change.count ?? 0), 0)

        const deletions = changes
          .filter((change) => change.removed)
          .reduce((total, change) => total + (change.count ?? 0), 0)

        if (additions === 0 && deletions === 0) return []

        return [
          {
            key: `${tool.id}:0`,
            toolID: tool.id,
            value: {
              file: input.path,
              patch: createTwoFilesPatch(input.path, input.path, input.oldString, input.newString),
              additions,
              deletions,
              status: "modified" as const,
            },
          },
        ]
      }

      if (tool.name !== "write" || !input.content) return []

      return [
        {
          key: `${tool.id}:0`,
          toolID: tool.id,
          value: {
            file: input.path,
            patch: createTwoFilesPatch(input.path, input.path, "", input.content),
            additions: input.content.split("\n").length - Number(input.content.endsWith("\n")),
            deletions: 0,
            status: "modified" as const,
          },
        },
      ]
    })

    const updates = new Map(next.map((entry) => [entry.key, entry.value]))
    const existing = new Set(previous.map((entry) => entry.key))
    const owners = new Set(props.tools.map((tool) => tool.id))

    const result = [
      ...previous.flatMap((entry) => {
        if (!owners.has(entry.toolID)) return []
        const value = updates.get(entry.key)

        if (!value || samePatchFile(value, entry.value)) return [entry]

        return [{ ...entry, value }]
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

  const tool = createMemo(() => {
    const name = props.tools[0]?.name

    return name === "edit" || name === "write" ? name : "patch"
  })

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

function scrollParent(element: HTMLElement): HTMLElement | undefined {
  const parent = element.parentElement

  if (!parent) return

  if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent

  return scrollParent(parent)
}

function isFileChangeTool(tool: SessionMessageAssistantTool) {
  return tool.state.status !== "error" && (tool.name === "edit" || tool.name === "write" || tool.name === "patch")
}

function samePatchFile(a: FileDiffInfo, b: FileDiffInfo) {
  return (
    a === b ||
    (a.file === b.file &&
      a.patch === b.patch &&
      a.additions === b.additions &&
      a.deletions === b.deletions &&
      a.status === b.status)
  )
}

function currentContextToolTrigger(tool: SessionMessageAssistantTool, i18n: ReturnType<typeof useI18n>) {
  const input = toolInput(currentToolInput(tool))
  const metadata = toolMetadata(currentToolMetadata(tool))
  const subtitle = displayDirectory(input.path ?? "/")

  const matches = (count: number | undefined) =>
    count ? i18n.plural("ui.messagePart.context.match", count) : undefined

  if (tool.name === "list") return { title: i18n.t("ui.tool.list"), subtitle, args: [], matches: undefined }

  if (tool.name === "glob")
    return {
      title: i18n.t("ui.tool.glob"),
      subtitle,
      args: input.pattern ? [`pattern=${input.pattern}`] : [],
      matches: matches(metadata.count),
    }

  return {
    title: i18n.t("ui.tool.grep"),
    subtitle,
    args: [
      ...(input.pattern ? [`pattern=${input.pattern}`] : []),
      ...(input.include ? [`include=${input.include}`] : []),
    ],
    matches: matches(metadata.matches),
  }
}

// SAFETY: tool input and metadata are open per-tool records. GenericTool shows arbitrary input keys, and
// renderers decode the fields they read with `toolInput` and `toolMetadata`.
export interface ToolProps {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- see SAFETY above
  input: Record<string, unknown>
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- see SAFETY above
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
  /** Paths the patch view lists, without change counts or diffs, instead of `metadata.files`. */
  pendingFiles?: readonly string[]
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

function FileTool(props: ToolProps & { title: string; count: number; children?: JSX.Element }) {
  const i18n = useI18n()

  return (
    <BasicTool
      {...props}
      open
      onOpenChange={undefined}
      locked
      icon="code-lines"
      hasContent
      defer={false}
      rail={false}
      trigger={{
        title: props.title,
        subtitle: props.count > 0 ? `${props.count} ${i18n.plural("ui.common.file", props.count)}` : "",
      }}
    >
      {props.children}
    </BasicTool>
  )
}

function FileAccordionGroup(props: { children: JSX.Element }) {
  return (
    <div
      data-component="accordion"
      data-scope="apply-patch"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return

        if (!(event.target instanceof HTMLButtonElement) || event.target.dataset.slot !== "accordion-trigger") return

        if (event.target.closest('[data-component="accordion"]') !== event.currentTarget) return

        const triggers = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            ':scope > [data-slot="accordion-item"] > [data-slot="accordion-header"] > [data-slot="accordion-trigger"]',
          ),
        ]

        const index = triggers.indexOf(event.target)

        if (index < 0) return
        event.preventDefault()

        if (event.key === "Home") return triggers[0]?.focus()

        if (event.key === "End") return triggers.at(-1)?.focus()
        triggers[(index + (event.key === "ArrowDown" ? 1 : -1) + triggers.length) % triggers.length]?.focus()
      }}
    >
      {props.children}
    </div>
  )
}

function FileAccordionItem(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type?: string
  header: JSX.Element
  children: JSX.Element
}) {
  const id = createUniqueId()

  return (
    <div
      data-slot="accordion-item"
      data-type={props.type}
      data-expanded={props.open ? "" : undefined}
      data-closed={!props.open ? "" : undefined}
    >
      <h3
        data-slot="accordion-header"
        data-component="sticky-accordion-header"
        data-expanded={props.open ? "" : undefined}
        data-closed={!props.open ? "" : undefined}
      >
        <button
          type="button"
          id={`${id}-trigger`}
          data-slot="accordion-trigger"
          data-expanded={props.open ? "" : undefined}
          data-closed={!props.open ? "" : undefined}
          aria-expanded={props.open}
          aria-controls={props.open ? `${id}-content` : undefined}
          onClick={() => batch(() => props.onOpenChange(!props.open))}
        >
          {props.header}
        </button>
      </h3>
      <Show when={props.open}>
        <div
          id={`${id}-content`}
          role="region"
          aria-labelledby={`${id}-trigger`}
          data-slot="accordion-content"
          data-expanded=""
        >
          {props.children}
        </div>
      </Show>
    </div>
  )
}

function ToolFileAccordion(props: {
  path: string
  actions?: JSX.Element
  children: JSX.Element
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  forceOpen?: boolean
  defer?: boolean
}) {
  const [expanded, setExpanded] = createSignal(props.defaultOpen ?? false)
  const [visible, setVisible] = createSignal(false)
  const open = () => props.open ?? expanded()

  const change = (value: boolean) => {
    if (props.open === undefined) setExpanded(value)
    props.onOpenChange?.(value)
  }

  createEffect(() => {
    if (props.forceOpen && !open()) change(true)
  })

  createEffect(() => {
    if (!open()) {
      setVisible(false)

      return
    }

    const frame = requestAnimationFrame(() => setVisible(true))
    onCleanup(() => cancelAnimationFrame(frame))
  })

  return (
    <FileAccordionGroup>
      <FileAccordionItem
        open={open()}
        onOpenChange={change}
        header={
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
        }
      >
        <Show when={!props.defer || visible()}>{props.children}</Show>
      </FileAccordionItem>
    </FileAccordionGroup>
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

    return toolMetadata(props.metadata).sessionID || undefined
  })

  const taskHref = createMemo(() => sessionLink(taskId(), data.sessionHref))

  const taskSubtitle = createMemo(() => {
    if (props.tool !== "subagent") return undefined

    return toolInput(props.input).description || taskId()
  })

  const errorSubtitle = createMemo(() => toolErrorSubtitle(props, i18n))
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
                  title={
                    props.tool === "websearch"
                      ? webSearchProviderLabel(toolMetadata(props.metadata).provider, i18n)
                      : undefined
                  }
                  defaultOpen={props.defaultOpen}
                  open={props.open}
                  onOpenChange={props.onOpenChange}
                  subtitle={taskSubtitle() ?? errorSubtitle()}
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

// Each branch must stay in sync with its tool trigger's subtitle expression so
// failed rows read like their non-error counterparts ("Shell sleep 30").
function toolErrorSubtitle(props: ToolProps, i18n: UiI18n) {
  const input = toolInput(props.input)
  const metadata = toolMetadata(props.metadata)

  if (props.tool === "shell") return input.command || metadata.command || undefined

  if (props.tool === "execute") return input.code || undefined

  if (props.tool === "read" || props.tool === "edit" || props.tool === "write") return getFilename(input.path ?? "")

  if (props.tool === "list" || props.tool === "glob" || props.tool === "grep")
    return displayDirectory(input.path || "/")

  if (props.tool === "webfetch") return input.url || undefined

  if (props.tool === "websearch") return input.query || undefined

  if (props.tool === "skill") return skillToolName(input, metadata)

  if (props.tool === "patch") {
    const count = new Set((metadata.files ?? []).flatMap((file) => (changedFileDiff(file) ? [file.file] : []))).size

    if (count === 0) return undefined

    return `${count} ${i18n.plural("ui.common.file", count)}`
  }

  if (props.tool === "question") {
    const count = questions(input).length

    if (count === 0) return undefined

    return `${count} ${i18n.plural("ui.common.question", count)}`
  }

  return undefined
}

function toolDisplayError(props: ToolProps & { error?: string }, fallback: string) {
  if (props.status === "error") return props.error

  if (props.tool !== "execute") return undefined

  if (!executeToolFailed(props.metadata)) return undefined

  return props.output || fallback
}

ToolRegistry.register({
  name: "read",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const image = createMemo(() => (props.status === "completed" ? readImagePath(props.input) : undefined))

    const loaded = createMemo(() => {
      if (props.status !== "completed") return []

      return (toolMetadata(props.metadata).loaded ?? []).flatMap((path) => Option.toArray(decodeString(path)))
    })

    const paths = createMemo(() =>
      loaded().map((filepath) => {
        const relative = relativizeProjectPath(filepath, data.directory)

        return relative === filepath ? relative : relative.replace(/^[/\\]/, "")
      }),
    )

    const marker = "__OPENCODE_LOADED_PATH__"
    const parts = createMemo(() => i18n.t("ui.tool.loadedFile", { path: marker }).split(marker))

    return (
      <>
        <BasicTool
          {...props}
          icon="glasses"
          hasContent={!!image()}
          defer
          onOpenChange={(open) => {
            props.onOpenChange?.(open)
            props.onContentRendered?.()
          }}
          trigger={{
            title: i18n.t("ui.tool.read"),
            subtitle: getFilename(toolInput(props.input).path ?? ""),
            args: readArgs(toolInput(props.input)),
          }}
        >
          <Show when={image()} keyed>
            {(path) => <ReadImage path={path} onContentRendered={props.onContentRendered} />}
          </Show>
        </BasicTool>
        <Show when={paths().length > 0}>
          <div
            data-component="tool-loaded-item"
            aria-label={i18n.t("ui.tool.loadedFile", { path: paths().join(", ") })}
          >
            <span data-slot="tool-loaded-label" aria-hidden="true">
              {parts()[0]?.trim()}
            </span>
            <span data-slot="tool-loaded-value" aria-hidden="true">
              {paths().join(", ")}
            </span>
            <Show when={parts()[1]?.trim()}>
              {(suffix) => (
                <span data-slot="tool-loaded-kind" aria-hidden="true">
                  {suffix()}
                </span>
              )}
            </Show>
          </div>
        </Show>
      </>
    )
  },
})

function ReadImage(props: { path: string; onContentRendered?: () => void }) {
  const markdown = useMarkdown()
  const previewImages = createImagePreview()
  let root!: HTMLDivElement
  createEffect(() => {
    previewImages(root)

    if (!markdown?.readImage) return
    const images = createMarkdownImages(markdown.readImage)
    images.update(root)
    onCleanup(() => images.dispose())
  })
  onMount(() => props.onContentRendered?.())

  return (
    <div ref={root} data-component="read-image">
      <img
        data-local-image={props.path}
        alt={getFilename(props.path)}
        onLoad={() => props.onContentRendered?.()}
        onError={() => props.onContentRendered?.()}
      />
    </div>
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
        hasContent={!!props.output}
        trigger={{
          title: i18n.t("ui.tool.list"),
          subtitle: displayDirectory(toolInput(props.input).path ?? "/"),
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
    const input = createMemo(() => toolInput(props.input))

    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        hasContent={!!props.output}
        trigger={{
          title: i18n.t("ui.tool.glob"),
          subtitle: displayDirectory(input().path ?? "/"),
          args: input().pattern === undefined ? [] : ["pattern=" + input().pattern],
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
    const input = createMemo(() => toolInput(props.input))

    const args = () => [
      ...(input().pattern === undefined ? [] : ["pattern=" + input().pattern]),
      ...(input().include === undefined ? [] : ["include=" + input().include]),
    ]

    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        hasContent={!!props.output}
        trigger={{
          title: i18n.t("ui.tool.grep"),
          subtitle: displayDirectory(input().path ?? "/"),
          args: args(),
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

    const url = createMemo(() => toolInput(props.input).url ?? "")

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
              <Show when={props.status !== "streaming" && url()}>
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

    const query = createMemo(() => toolInput(props.input).query ?? "")

    const title = createMemo(() => webSearchProviderLabel(toolMetadata(props.metadata).provider, i18n))

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

    const input = createMemo(() => toolInput(props.input))
    const metadata = createMemo(() => toolMetadata(props.metadata))

    const childSessionId = createMemo(
      () => metadata().sessionID || taskSession(input().description, data.sessionID, data.store.session),
    )

    const agent = createMemo(() => taskAgent(input().agent, data.store.agent))
    const title = createMemo(() => agent().name ?? i18n.t("ui.tool.agent.default"))
    const tone = createMemo(() => agent().color)
    const v2Tone = createMemo(() => agent().v2Color)

    const background = createMemo(() => {
      return metadata().background === true || (props.status === "completed" && metadata().status === "running")
    })

    const subtitle = createMemo(() => {
      const value = input().description || childSessionId()

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
                    <Icon name="subagent" size="normal" />
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
            <Show when={clickable()}>
              <div data-component="task-tool-action">
                <Icon name="chevron-right" size="normal" />
              </div>
            </Show>
          </div>
        </div>
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
          class="flex h-9 w-fit max-w-full items-center gap-2 rounded-[8px] bg-v2-background-bg-layer-02 p-2.5 text-[13px] font-[530] leading-text-compact tracking-[-0.04px]"
        >
          <Icon name="subagent" size="normal" class="shrink-0 text-v2-icon-icon-faint" />
          <TextShimmer text={i18n.t("ui.tool.agent.delegating")} class="min-w-0 truncate" />
        </div>
      </Show>
    )
  },
})

function ConsoleOutput(props: { command: string; output: string }) {
  const i18n = useI18n()

  return (
    <div data-component="bash-output" data-variant="shell" dir="ltr">
      <div
        data-slot="bash-scroll"
        data-scrollable
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
      >
        <div data-slot="bash-command">
          <ConsoleCopy text={props.command} label={i18n.t("ui.message.copy")} />
          <pre data-slot="bash-pre">
            <code>{props.command}</code>
          </pre>
        </div>
        <Show when={props.output}>
          {(output) => (
            <div data-slot="bash-result">
              <ConsoleCopy text={output()} label={i18n.t("ui.message.copyOutput")} />
              <pre data-slot="bash-pre">
                <code>{output()}</code>
              </pre>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

// The button sits beside its section's <pre>, not inside it, so selecting and copying text never picks it up.
function ConsoleCopy(props: { text: string; label: string }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  const label = () => (copied() ? i18n.t("ui.message.copied") : props.label)

  const copy = async () => {
    if (!props.text) return

    if (!(await writeClipboard(props.text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div data-slot="bash-copy">
      <Tooltip value={label()} placement="top">
        <IconButton
          icon={<Icon name={copied() ? "check" : "outline-copy"} size="small" />}
          size="normal"
          variant="ghost-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={copy}
          aria-label={label()}
        />
      </Tooltip>
    </div>
  )
}

ToolRegistry.register({
  name: "execute",
  render(props) {
    const i18n = useI18n()
    const pending = () => props.status === "streaming" || props.status === "running"
    const code = createMemo(() => toolInput(props.input).code ?? "")
    const output = () => stripAnsi(props.output ?? "").replace(/\r\n?/g, "\n")
    const sawPending = pending()

    return (
      <BasicTool
        {...props}
        icon="console"
        rail={false}
        hasContent
        compact
        allowOpenWhilePending
        trigger={(open) => (
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.execute")} active={pending()} />
              </span>
              <Show when={!open() && code()}>
                <ShellSubmessage text={code().split("\n", 1)[0]} animate={sawPending} />
              </Show>
            </div>
          </div>
        )}
      >
        <ConsoleOutput command={code()} output={output()} />
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "shell",
  render(props) {
    const i18n = useI18n()
    const data = useData()
    const streaming = () => props.status === "streaming"
    const metadata = createMemo(() => toolMetadata(props.metadata))

    const pending = () => {
      const id = metadata().shellID

      return streaming() || props.status === "running" || (id !== undefined && data.shellRunning?.(id) === true)
    }

    const sawStreaming = streaming()
    const command = createMemo(() => toolInput(props.input).command ?? metadata().command ?? "")

    function Output() {
      const [streamed, setStreamed] = createSignal("")

      // Direct-user terminal snapshots are authoritative; agent results can describe background shells.
      const saved = createMemo(() =>
        metadata().status === "exited" || metadata().status === "timeout" || metadata().status === "killed"
          ? props.output
          : undefined,
      )

      createEffect(() => {
        if (saved() !== undefined) return
        const id = metadata().shellID
        const load = data.shellOutput

        if (id === undefined || !load) return
        onCleanup(followShellOutput({ id, directory: data.directory, running: pending(), load, onOutput: setStreamed }))
      })

      const output = createMemo(() =>
        stripAnsi(saved() ?? ((metadata().shellID !== undefined && streamed()) || props.output || "")).replace(
          /\r\n?/g,
          "\n",
        ),
      )

      return <ConsoleOutput command={command()} output={output()} />
    }

    return (
      <BasicTool
        {...props}
        icon="console"
        rail={false}
        hasContent
        compact
        allowOpenWhilePending
        trigger={(open) => (
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.shell")} active={pending()} />
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
        <Output />
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
  const i18n = useI18n()
  const render = ToolRegistry.render("shell") ?? GenericTool

  const error = createMemo(() => {
    const message = props.message

    if (message.status === "timeout") return i18n.t("ui.tool.shell.timeout")

    if (message.status === "killed") return i18n.t("ui.tool.shell.cancelled")

    if (message.status !== "exited" || message.exit === undefined || message.exit === 0) return

    return i18n.t("ui.tool.shell.exit", { code: message.exit })
  })

  return (
    <div data-component="session-shell-message" data-timeline-part-id={props.message.id}>
      <Dynamic
        component={render}
        tool="shell"
        input={{ command: props.message.command }}
        metadata={{
          shellID: props.message.shellID,
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
      <Show when={error()}>
        {(error) => <ToolErrorCard tool="shell" error={error()} subtitle={props.message.command} />}
      </Show>
    </div>
  )
}

ToolRegistry.register({
  name: "edit",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const input = createMemo(() => toolInput(props.input))
    const metadata = createMemo(() => toolMetadata(props.metadata))
    const inputPath = () => input().path ?? ""
    const diff = createMemo(() => metadata().files?.find(changedFileDiff))
    const diagnostics = createMemo(() => getDiagnostics(metadata().diagnostics, inputPath()))
    const path = createMemo(() => diff()?.file ?? inputPath())

    const pending = () => props.status === "streaming" || props.status === "running"

    const diffSource = createMemo(
      () => {
        const source = diff()

        if (!source) return undefined

        return { file: source.file, patch: source.patch }
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
          contents: input().oldString ?? "",
        },
        after: {
          name: path(),
          contents: input().newString ?? "",
        },
      }
    })

    return (
      <div data-component="edit-tool">
        <FileTool {...props} title={i18n.t("ui.messagePart.title.edit")} count={path() ? 1 : 0}>
          <Show when={path()}>
            <ToolFileAccordion
              path={path()}
              defaultOpen={props.defaultOpen}
              open={props.open}
              onOpenChange={props.onOpenChange}
              forceOpen={props.forceOpen}
              defer={props.deferContent !== false}
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
        </FileTool>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "write",
  render(props) {
    const fileComponent = useFileComponent()
    const path = createMemo(() => toolInput(props.input).path ?? "")
    const content = createMemo(() => toolInput(props.input).content ?? "")
    const diagnostics = createMemo(() => getDiagnostics(toolMetadata(props.metadata).diagnostics, path()))

    return (
      <div data-component="write-tool">
        <Show when={content() && path()}>
          <ToolFileAccordion
            path={path()}
            defaultOpen={props.defaultOpen}
            open={props.open}
            onOpenChange={props.onOpenChange}
            forceOpen={props.forceOpen}
            defer={props.deferContent !== false}
          >
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
      </div>
    )
  },
})

ToolRegistry.register({
  name: "patch",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()

    const files = createMemo(
      () =>
        props.pendingFiles?.map((path) => ({
          path,
          type: "update" as const,
          additions: 0,
          deletions: 0,
          views: [],
        })) ?? patchFileGroups(props.metadata.files),
    )

    const [expanded, setExpanded] = createSignal<string[]>([])

    const title = createMemo(() => {
      if (props.tool === "edit") return i18n.t("ui.messagePart.title.edit")

      if (props.tool === "write") return i18n.t("ui.messagePart.title.write")

      return i18n.t("ui.tool.patch")
    })

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

    return (
      <div data-component="apply-patch-tool">
        <Show when={files().length > 0} fallback={<FileTool {...props} title={title()} count={0} />}>
          <FileAccordionGroup>
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
                  <FileAccordionItem
                    open={active()}
                    onOpenChange={(expanded) =>
                      change(expanded ? [...open(), value()] : open().filter((path) => path !== value()))
                    }
                    type={file().type}
                    header={
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
                    }
                  >
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
                  </FileAccordionItem>
                )
              }}
            </Index>
          </FileAccordionGroup>
        </Show>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "question",
  render(props) {
    const i18n = useI18n()

    const items = createMemo(() => questions(toolInput(props.input)))

    const answers = createMemo(() =>
      (toolMetadata(props.metadata).answers ?? []).flatMap((answer) => Option.toArray(decodeAnswer(answer))),
    )

    const completed = createMemo(() => answers().length > 0)

    const subtitle = createMemo(() => {
      const count = items().length

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
            <For each={items()}>
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
    const name = createMemo(() => skillToolName(toolInput(props.input), toolMetadata(props.metadata)))
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
