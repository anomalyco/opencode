import "./team-tools.css"

import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { useLocation } from "@solidjs/router"
import { BasicTool, type BasicToolProps } from "../../../ui/src/components/basic-tool"
import { Collapsible } from "../../../ui/src/components/collapsible"
import { Icon } from "../../../ui/src/components/icon"
import { Markdown } from "../../../ui/src/components/markdown"
import { Spinner } from "../../../ui/src/components/spinner"
import { TextShimmer } from "../../../ui/src/components/text-shimmer"
import { useData } from "../../../ui/src/context"
import { useI18n, type UiI18n } from "../../../ui/src/context/i18n"
import { getFilename } from "@opencode-ai/shared/util/path"
import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2"
import type { ToolComponent } from "../components/message-part"
import { ToolDuration } from "./tool-duration"
import { presenter, type ToolPresenterDef } from "./tool-presenter"

type Input = Record<string, unknown>
type Meta = Record<string, unknown>
type MainPlanShape = {
  title: string
  goal?: string
  scope?: string
  target?: string
  stats: {
    progress: number
    objective: number
    tests: number
    phase_done: number
    phase_total: number
    task_done: number
    task_total: number
  }
}

export type TeamToolInfo = {
  icon: BasicToolProps["icon"]
  title: string
  subtitle?: string
}

export type TeamToolGroupKind = "context" | "research"

const TEAM_DISCOVERY_TOOLS = new Set([
  "inspect",
  "search",
  "lsp",
  "discover_batch",
  "archive_list",
  "data_query",
  "dir_tree",
  "markdown_read",
  "localgit_state",
  "localgit_log",
  "localgit_annotate",
])

const TEAM_RESEARCH_TOOLS = new Set(["websearch", "codesearch", "lib_batch"])

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function text(value: unknown) {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  if (!trimmed) return
  return trimmed
}

function number(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return
  return value
}

function keyValue(output?: string) {
  return (output ?? "").split("\n").reduce<Record<string, string>>((acc, line) => {
    const hit = line.match(/^\s*([a-z_]+):\s*(.*)$/)
    if (!hit) return acc
    acc[hit[1]!] = hit[2] ?? ""
    return acc
  }, {})
}

function terminal(textValue?: string) {
  if (!textValue) return
  return <div data-slot="team-tool-code">{textValue}</div>
}

function markdown(textValue?: string) {
  if (!textValue) return
  return (
    <div data-component="tool-output" data-scrollable>
      <Markdown text={textValue} />
    </div>
  )
}

function pill(textValue: string, tone?: "info" | "success" | "error") {
  return (
    <span data-slot="team-tool-pill" data-tone={tone}>
      {textValue}
    </span>
  )
}

function short(value?: string, size = 8) {
  if (!value) return ""
  return value.slice(0, size)
}

function sessionLink(id: string | undefined, path: string, href?: (id: string) => string | undefined) {
  if (!id) return

  const direct = href?.(id)
  if (direct) return direct

  const idx = path.indexOf("/session")
  if (idx === -1) return
  return `${path.slice(0, idx)}/session/${id}`
}

function date(value: unknown) {
  if (typeof value !== "string") return
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return
  return at
}

function messageTokens(message: AssistantMessage) {
  return (
    message.tokens.total ??
    message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write
  )
}

function countLabel(value: unknown, unit: string) {
  if (!Array.isArray(value)) return ""
  const count = value.length
  if (count === 0) return ""
  return `${count} ${unit}`
}

function discoveryCallCount(input: Record<string, unknown>) {
  return Array.isArray(input.calls) ? input.calls.length : 0
}

function discoveryCallLabel(i18n: UiI18n, count: number) {
  if (count <= 0) return ""
  return i18n.t(count === 1 ? "ui.messagePart.discovery.check.one" : "ui.messagePart.discovery.check.other", {
    count,
  })
}

export function getTeamToolInfo(i18n: UiI18n, tool: string, input: Record<string, unknown>): TeamToolInfo | undefined {
  switch (tool) {
    case "inspect": {
      const action = typeof input.action === "string" ? input.action : undefined
      return {
        icon:
          action === "tree" || action === "dir"
            ? "file-tree"
            : action === "archive"
              ? "archive"
              : action === "structured"
                ? "code-lines"
                : action === "markdown"
                  ? "prompt"
                  : "glasses",
        title: i18n.t("ui.tool.inspect"),
        subtitle:
          typeof input.filePath === "string"
            ? getFilename(input.filePath)
            : typeof input.path === "string"
              ? getFilename(input.path)
              : undefined,
      }
    }
    case "search":
      return {
        icon: "magnifying-glass",
        title: i18n.t("ui.tool.search"),
        subtitle:
          typeof input.pattern === "string"
            ? input.pattern
            : typeof input.path === "string"
              ? getFilename(input.path)
              : undefined,
      }
    case "lsp":
      return {
        icon: "code",
        title: i18n.t("ui.tool.lsp"),
        subtitle:
          typeof input.query === "string"
            ? input.query
            : typeof input.filePath === "string"
              ? getFilename(input.filePath)
              : typeof input.operation === "string"
                ? input.operation
                : undefined,
      }
    case "discover_batch":
      return {
        icon: "dot-grid",
        title: i18n.t("ui.tool.discoverBatch"),
        subtitle: discoveryCallLabel(i18n, discoveryCallCount(input)) || undefined,
      }
    case "archive_list":
      return {
        icon: "archive",
        title: i18n.t("ui.tool.archiveList"),
        subtitle:
          typeof input.filePath === "string"
            ? getFilename(input.filePath)
            : typeof input.path === "string"
              ? getFilename(input.path)
              : undefined,
      }
    case "data_query":
      return {
        icon: "code-lines",
        title: i18n.t("ui.tool.dataQuery"),
        subtitle: typeof input.filePath === "string" ? getFilename(input.filePath) : undefined,
      }
    case "dir_tree":
      return {
        icon: "file-tree",
        title: i18n.t("ui.tool.dirTree"),
        subtitle: typeof input.path === "string" ? getFilename(input.path) : undefined,
      }
    case "markdown_read":
      return {
        icon: "prompt",
        title: i18n.t("ui.tool.markdownRead"),
        subtitle: typeof input.filePath === "string" ? getFilename(input.filePath) : undefined,
      }
    case "localgit_state":
      return {
        icon: "branch",
        title: i18n.t("ui.tool.localGitState"),
        subtitle:
          typeof input.path === "string"
            ? getFilename(input.path)
            : typeof input.base === "string"
              ? input.base
              : undefined,
      }
    case "localgit_log":
      return {
        icon: "branch",
        title: i18n.t("ui.tool.localGitLog"),
        subtitle:
          typeof input.path === "string"
            ? getFilename(input.path)
            : typeof input.ref === "string"
              ? input.ref
              : typeof input.base === "string"
                ? input.base
                : undefined,
      }
    case "localgit_annotate":
      return {
        icon: "branch",
        title: i18n.t("ui.tool.localGitAnnotate"),
        subtitle:
          typeof input.filePath === "string"
            ? getFilename(input.filePath)
            : typeof input.pattern === "string"
              ? input.pattern
              : undefined,
      }
  }
}

export function getTeamToolGroupKind(tool: string): TeamToolGroupKind | undefined {
  if (TEAM_DISCOVERY_TOOLS.has(tool)) return "context"
  if (TEAM_RESEARCH_TOOLS.has(tool)) return "research"
}

export function discoverBatchSections(output: string | undefined) {
  if (!output) return [] as Array<{ key: string; label: string; output: string }>
  const hits = [...output.matchAll(/^\[(\d+)\]\s+(.+)$/gm)]
  if (hits.length === 0) return []

  return hits.flatMap((hit, index) => {
    const start = hit.index
    if (start === undefined) return []
    const lineEnd = output.indexOf("\n", start)
    const bodyStart = lineEnd === -1 ? output.length : lineEnd + 1
    const bodyEnd = hits[index + 1]?.index ?? output.length
    return [
      {
        key: `discover-batch-${hit[1] ?? index + 1}`,
        label: (hit[2] ?? "").trim(),
        output: output.slice(bodyStart, bodyEnd).trim(),
      },
    ]
  })
}

export function batchResultRows(metadata: Record<string, unknown>) {
  return batchRows(metadata.results)
}

function batchRowDetail(row: Record<string, unknown>) {
  const title = typeof row.title === "string" ? row.title : ""
  const tool = typeof row.tool === "string" ? row.tool : ""
  if (tool === "websearch" && title.startsWith("Web search: ")) return title.slice("Web search: ".length)
  if (tool === "codesearch" && title.startsWith("Code search: ")) return title.slice("Code search: ".length)
  if (tool === "webfetch" && title.startsWith("Web fetch: ")) return title.slice("Web fetch: ".length)
  return title
}

export function teamBatchRowInfo(i18n: UiI18n, row: Record<string, unknown>, fallback: (tool: string, input: any) => { icon: BasicToolProps["icon"]; title: string; subtitle?: string }) {
  const tool = typeof row.tool === "string" ? row.tool : ""
  const detail = batchRowDetail(row)
  const input =
    tool === "websearch" || tool === "codesearch"
      ? { query: detail }
      : tool === "webfetch"
        ? { url: detail }
        : { filePath: detail, path: detail }
  const info = getTeamToolInfo(i18n, tool, input) ?? fallback(tool, input)
  return {
    icon: info.icon,
    title: info.title,
    subtitle: detail || info.subtitle,
  }
}

function batchRows(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<Record<string, unknown>>
  return value.flatMap((item) => {
    const row = record(item)
    return row ? [row] : []
  })
}

function batchBody(metadata: Meta, format: "term" | "markdown") {
  const rows = batchRows(metadata.results)
  if (rows.length === 0) return format === "term" ? terminal(text(metadata.output)) : markdown(text(metadata.output))

  return (
    <div data-component="team-tool-body">
      <For each={rows}>
        {(row: Record<string, unknown>, index) => (
          <div data-slot="team-tool-card">
            <div data-slot="team-tool-title-row">
              <span data-slot="team-tool-title">
                {`${index() + 1}. ${text(row.tool) ?? "tool"}${text(row.action) ? `:${text(row.action)}` : ""}`}
              </span>
              <div data-slot="team-tool-pills">
                <Show when={text(row.title)}>{pill(text(row.title)!)}</Show>
              </div>
            </div>
            <Show when={format === "markdown"} fallback={terminal(text(row.output))}>
              {markdown(text(row.output))}
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

function estimateTokens(textValue: string | undefined) {
  const value = textValue?.trim()
  if (!value) return 0
  return Math.max(1, Math.round(value.length / 4))
}

export function TeamBatchResultList(props: {
  metadata: Record<string, unknown>
  format: "term" | "markdown"
  getToolInfo: (tool: string, input: any) => { icon: BasicToolProps["icon"]; title: string; subtitle?: string }
}) {
  const i18n = useI18n()
  const rows = createMemo(() => batchResultRows(props.metadata))

  return (
    <Show when={rows().length > 0}>
      <div data-component="discovery-batch-result-list">
        <For each={rows()}>
          {(row) => {
            const [open, setOpen] = createSignal(false)
            const info = createMemo(() => teamBatchRowInfo(i18n, row, props.getToolInfo))
            const textValue = createMemo(() => (typeof row.output === "string" ? row.output.trim() : ""))
            const estimatedTokens = createMemo(() => estimateTokens(textValue()))

            return (
              <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="tool-collapsible">
                <Collapsible.Trigger>
                  <div data-component="tool-trigger">
                    <div data-slot="basic-tool-tool-trigger-content">
                      <span data-slot="basic-tool-tool-indicator">
                        <Icon name={info().icon} size="small" />
                      </span>
                      <div data-slot="basic-tool-tool-info">
                        <div data-slot="basic-tool-tool-info-structured">
                          <div data-slot="basic-tool-tool-info-main">
                            <span data-slot="basic-tool-tool-title">{info().title}</span>
                            <Show when={info().subtitle}>
                              <span data-slot="basic-tool-tool-subtitle">{info().subtitle}</span>
                            </Show>
                            <Show when={estimatedTokens() > 0}>
                              <span data-slot="basic-tool-tool-arg">
                                {i18n.t(
                                  estimatedTokens() === 1
                                    ? "ui.messagePart.discovery.tokens.one"
                                    : "ui.messagePart.discovery.tokens.other",
                                  { count: estimatedTokens() },
                                )}
                              </span>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </div>
                    <Collapsible.Arrow />
                  </div>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <Show
                    when={props.format === "markdown"}
                    fallback={
                      <div data-component="bash-output">
                        <div data-slot="bash-scroll" data-scrollable>
                          <pre data-slot="bash-pre">
                            <code>{textValue()}</code>
                          </pre>
                        </div>
                      </div>
                    }
                  >
                    <div data-component="tool-output" data-scrollable>
                      <Markdown text={textValue()} />
                    </div>
                  </Show>
                </Collapsible.Content>
              </Collapsible>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

function parsePlan(output?: string) {
  const match = output?.match(/<plan_json>\n([\s\S]*?)\n<\/plan_json>/)
  if (!match?.[1]) return
  try {
    return JSON.parse(match[1]) as MainPlanShape
  } catch {
    return
  }
}

function planRows(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<Record<string, unknown>>
  return value.flatMap((item) => {
    const row = record(item)
    return row ? [row] : []
  })
}

function planPercent(value: unknown) {
  const raw = number(value)
  if (raw == null) return
  return `${Math.round(raw * 100)}%`
}

function prettyTime(value: unknown) {
  const time = number(value)
  if (time == null) return
  return new Date(time).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function planBody(input: Input, output?: string, metadata?: Meta) {
  const plan = (record(metadata?.plan) as MainPlanShape | undefined) ?? parsePlan(output)
  if (plan) {
    return (
      <div data-component="team-tool-body">
        <div data-slot="team-tool-card">
          <div data-slot="team-tool-title-row">
            <span data-slot="team-tool-title">{plan.title}</span>
            <div data-slot="team-tool-pills">
              <Show when={planPercent(plan.stats.progress)}>{pill(planPercent(plan.stats.progress)!, "info")}</Show>
              <Show when={planPercent(plan.stats.objective)}>{pill(`objective ${planPercent(plan.stats.objective)!}`)}</Show>
              <Show when={planPercent(plan.stats.tests)}>{pill(`tests ${planPercent(plan.stats.tests)!}`)}</Show>
            </div>
          </div>
          <div data-slot="team-tool-kv-grid">
            <Show when={plan.goal}>
              <div data-slot="team-tool-kv-row">
                <span data-slot="team-tool-kv-label">Goal</span>
                <span data-slot="team-tool-kv-value">{plan.goal}</span>
              </div>
            </Show>
            <Show when={plan.scope}>
              <div data-slot="team-tool-kv-row">
                <span data-slot="team-tool-kv-label">Scope</span>
                <span data-slot="team-tool-kv-value">{plan.scope}</span>
              </div>
            </Show>
            <Show when={plan.target}>
              <div data-slot="team-tool-kv-row">
                <span data-slot="team-tool-kv-label">Target</span>
                <span data-slot="team-tool-kv-value">{plan.target}</span>
              </div>
            </Show>
            <div data-slot="team-tool-kv-row">
              <span data-slot="team-tool-kv-label">Coverage</span>
              <span data-slot="team-tool-kv-value">
                {`${plan.stats.phase_done}/${plan.stats.phase_total} phases · ${plan.stats.task_done}/${plan.stats.task_total} tasks`}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const rows = planRows(metadata?.plans)
  if (rows.length > 0) {
    return (
      <div data-component="team-tool-body">
        <For each={rows}>
          {(row: Record<string, unknown>) => (
            <div data-slot="team-tool-card">
              <div data-slot="team-tool-title-row">
                <span data-slot="team-tool-title">{text(row.title) ?? text(row.plan_id) ?? "Plan"}</span>
                <div data-slot="team-tool-pills">
                  <Show when={planPercent(row.progress)}>{pill(planPercent(row.progress)!, "info")}</Show>
                </div>
              </div>
              <div data-slot="team-tool-kv-grid">
                <Show when={text(row.plan_id)}>
                  <div data-slot="team-tool-kv-row">
                    <span data-slot="team-tool-kv-label">Plan ID</span>
                    <span data-slot="team-tool-kv-value">{text(row.plan_id)}</span>
                  </div>
                </Show>
                <Show when={prettyTime(row.updated_at)}>
                  <div data-slot="team-tool-kv-row">
                    <span data-slot="team-tool-kv-label">Updated</span>
                    <span data-slot="team-tool-kv-value">{prettyTime(row.updated_at)}</span>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    )
  }

  return terminal(output) ?? terminal(text(input.plan_id) ?? text(input.action))
}

function memoryEntries(metadata?: Meta) {
  const entry = record(metadata?.entry)
  const entries = Array.isArray(metadata?.entries)
    ? metadata!.entries.flatMap((item: unknown) => {
        const row = record(item)
        return row ? [row] : []
      })
    : []
  if (entries.length > 0) return entries
  return entry ? [entry] : []
}

function memoryBody(input: Input, output?: string, metadata?: Meta) {
  const entries = memoryEntries(metadata)
  const summary = record(metadata?.summary)
  const summaryAreas = Array.isArray(summary?.by_area)
    ? summary.by_area.flatMap((item: unknown) => {
        const row = record(item)
        if (!row) return []
        const name = text(row.name)
        const count = number(row.count)
        if (!name || count == null) return []
        return [`${name}:${count}`]
      })
    : []
  const findings = Array.isArray(metadata?.findings)
    ? metadata!.findings.flatMap((item: unknown) => {
        const row = record(item)
        return row ? [row] : []
      })
    : []

  return (
    <div data-component="team-tool-body">
      <Show when={entries.length > 0}>
        <For each={entries.slice(0, 6)}>
          {(entry: Record<string, unknown>) => (
            <div data-slot="team-tool-card">
              <div data-slot="team-tool-title-row">
                <span data-slot="team-tool-title">{text(entry.title) ?? text(entry.id) ?? "Memory entry"}</span>
                <div data-slot="team-tool-pills">
                  <Show when={text(entry.area)}>{pill(text(entry.area)!)}</Show>
                  <Show when={text(entry.kind)}>{pill(text(entry.kind)!)}</Show>
                  <Show when={text(entry.domain)}>{pill(text(entry.domain)!)}</Show>
                </div>
              </div>
              <Show when={text(entry.content)}>
                <div data-slot="team-tool-summary">{text(entry.content)}</div>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <Show when={summary}>
        <div data-slot="team-tool-card">
          <div data-slot="team-tool-title-row">
            <span data-slot="team-tool-title">Memory summary</span>
            <div data-slot="team-tool-pills">
              <Show when={number(summary?.total) != null}>{pill(`${number(summary?.total)} entries`, "info")}</Show>
            </div>
          </div>
          <div data-slot="team-tool-kv-grid">
            <Show when={summaryAreas.length > 0}>
              <div data-slot="team-tool-kv-row">
                <span data-slot="team-tool-kv-label">Areas</span>
                <span data-slot="team-tool-kv-value">{summaryAreas.join(", ")}</span>
              </div>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={findings.length > 0}>
        <div data-slot="team-tool-card">
          <div data-slot="team-tool-title-row">
            <span data-slot="team-tool-title">Audit findings</span>
            <div data-slot="team-tool-pills">{pill(`${findings.length} findings`, "error")}</div>
          </div>
          <div data-slot="team-tool-stack">
            <For each={findings.slice(0, 8)}>
              {(item: Record<string, unknown>) => (
                <span data-slot="team-tool-line">{text(record(item)?.summary) ?? text(record(item)?.evidence)}</span>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={!!output && (entries.length > 0 || !!summary || findings.length > 0)}>{terminal(output)}</Show>
      <Show when={!entries.length && !summary && !findings.length && output}>
        {terminal(output)}
      </Show>
      <Show when={!entries.length && !summary && !findings.length && !output}>
        <div data-slot="team-tool-summary">{text(input.action) ?? "Memory operation"}</div>
      </Show>
    </div>
  )
}

function smartToolTrigger(input: {
  icon: BasicToolProps["icon"]
  title: string
  subtitle?: string
  pending?: boolean
  meta?: JSX.Element
  action?: JSX.Element
}) {
  return (
    <div data-component="tool-trigger">
      <div data-slot="basic-tool-tool-trigger-content">
        <span data-slot="basic-tool-tool-indicator">
          <Show
            when={input.pending}
            fallback={
              <span data-component="team-smart-tool-icon">
                <Icon name={input.icon} size="small" />
              </span>
            }
          >
            <span data-component="task-tool-spinner">
              <Spinner />
            </span>
          </Show>
        </span>
        <div data-slot="basic-tool-tool-info">
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title" class="team-smart-tool-title">
                <TextShimmer text={input.title} active={input.pending ?? false} />
              </span>
              <Show when={input.subtitle && !input.pending}>
                <span data-slot="basic-tool-tool-subtitle">{input.subtitle}</span>
              </Show>
            </div>
            <Show when={input.meta && !input.pending}>
              <span data-slot="basic-tool-tool-action">
                <span data-component="team-smart-tool-meta">{input.meta}</span>
              </span>
            </Show>
          </div>
        </div>
      </div>
      <Show when={input.action && !input.pending}>
        <span data-slot="basic-tool-tool-action">{input.action}</span>
      </Show>
    </div>
  )
}

function bugReportBody(input: Input, output?: string, metadata?: Meta) {
  const title = text(input.title) ?? text(metadata?.title)
  const summary = text(input.summary) ?? text(metadata?.summary)
  const kind = text(input.kind) ?? text(metadata?.kind) ?? "bug"
  const area = text(input.area) ?? text(metadata?.area)
  const tool = text(input.tool_name) ?? text(metadata?.tool_name)
  const suggestion = text(input.suggestion) ?? text(metadata?.suggestion)
  const reportID = text(metadata?.report_id)

  return (
    <div data-component="team-tool-body">
      <div data-slot="team-tool-card">
        <div data-slot="team-tool-title-row">
          <span data-slot="team-tool-title">{title ?? "Bug report"}</span>
          <div data-slot="team-tool-pills">
            {pill(kind)}
            <Show when={reportID}>{pill(short(reportID!), "success")}</Show>
          </div>
        </div>
        <Show when={summary}>
          <div data-slot="team-tool-summary">{summary}</div>
        </Show>
        <Show when={area || tool}>
          <div data-slot="team-tool-pills">
            <Show when={area}>{pill(area!)}</Show>
            <Show when={tool}>{pill(tool!)}</Show>
          </div>
        </Show>
        <Show when={suggestion}>
          <div data-slot="team-tool-kv-row">
            <span data-slot="team-tool-kv-label">Suggestion</span>
            <span data-slot="team-tool-kv-value">{suggestion}</span>
          </div>
        </Show>
      </div>
      <Show when={output}>{terminal(output)}</Show>
    </div>
  )
}

function taskAsyncBody(input: Input, output?: string, metadata?: Meta, status?: string) {
  const data = useData()
  const i18n = useI18n()
  const location = useLocation()
  const info = createMemo(() => keyValue(output))
  const sessionID = createMemo(() => text(metadata?.sessionId) ?? text(input.task_id) ?? text(info().task_id))
  const action = createMemo(() => text(input.action) ?? "start")
  const agent = createMemo(() => text(input.subagent_type) ?? text(info().agent))
  const session = createMemo(() => (sessionID() ? data.store.session.find((item) => item.id === sessionID()) : undefined))
  const childStatus = createMemo(() => (sessionID() ? data.store.session_status[sessionID()!] : undefined))
  const messages = createMemo(() => ((sessionID() ? data.store.message[sessionID()!] : undefined) ?? []) as Message[])
  const assistants = createMemo(
    () => messages().filter((item): item is AssistantMessage => item.role === "assistant"),
  )
  const title = createMemo(
    () =>
      text(info().title) ??
      text(input.description) ??
      session()?.title ??
      i18n.t("ui.tool.taskAsync"),
  )
  const summary = createMemo(
    () =>
      text(info().status) ??
      text(info().completion) ??
      text(info().task_output) ??
      text(info().last_assistant) ??
      text(info().result_access),
  )
  const active = createMemo(() => {
    const live = childStatus()?.type
    if (live) return live !== "idle"
    return ["busy", "retry", "stalled", "started", "watching", "queued", "resumed"].includes(summary() ?? "")
  })
  const agentColor = createMemo(() => {
    const name = agent()?.toLowerCase()
    if (!name) return
    return data.store.agent?.find((item) => item.name.toLowerCase() === name)?.color
  })
  const time = createMemo(() => {
    const state = record(metadata?.time)
    const start = session()?.time.created ?? number(state?.start) ?? date(info().created_at)
    const end =
      assistants()
        .map((item) => item.time.completed)
        .findLast((item): item is number => typeof item === "number") ??
      (!active() ? session()?.time.updated : undefined) ??
      number(state?.end) ??
      (!active() ? date(info().updated_at) : undefined)
    if (start == null && end == null) return
    return { start, end }
  })
  const totalTokens = createMemo(() => assistants().reduce((sum, item) => sum + messageTokens(item), 0))
  const tokenLabel = createMemo(() => {
    const count = totalTokens()
    if (count <= 0) return
    const formatted = new Intl.NumberFormat(i18n.locale()).format(count)
    return i18n.t(count === 1 ? "ui.tool.taskAsync.tokens.one" : "ui.tool.taskAsync.tokens.other", {
      count: formatted,
    })
  })

  const href = createMemo(() => sessionLink(sessionID(), location.pathname, data.sessionHref))
  const clickable = createMemo(() => !!(sessionID() && (data.navigateToSession || href())))

  const open = () => {
    const id = sessionID()
    if (!id) return
    if (data.navigateToSession) {
      data.navigateToSession(id)
      return
    }
    const value = href()
    if (value) window.location.assign(value)
  }

  const navigate = (event: MouseEvent) => {
    if (!data.navigateToSession) return
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    event.preventDefault()
    open()
  }

  const trigger = () => (
    <div data-component="task-tool-card" class="task-async-card">
      <div data-slot="basic-tool-tool-info-structured">
        <div data-slot="basic-tool-tool-info-main">
          <Show when={active()}>
            <span data-component="task-tool-spinner" style={{ color: agentColor() ?? "var(--icon-interactive-base)" }}>
              <Spinner />
            </span>
          </Show>
          <span data-slot="basic-tool-tool-title" class="task-async-title" style={{ color: agentColor() ?? "var(--text-strong)" }}>
            {title()}
          </span>
          <Show when={summary() ?? action()}>
            <span data-slot="basic-tool-tool-subtitle">{summary() ?? action()}</span>
          </Show>
        </div>
        <div data-component="task-async-tool-meta">
          <Show when={tokenLabel()}>{pill(tokenLabel()!, "info")}</Show>
          <ToolDuration time={time()} active={active()} status={status} />
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
    <BasicTool
      icon="task"
      status={status}
      trigger={trigger()}
      hideDetails
      triggerHref={href()}
      clickable={clickable()}
      onTriggerClick={navigate}
    />
  )
}

const toolDefs: ToolPresenterDef[] = [
  {
    name: "inspect",
    icon: "bullet-list",
    title: () => "Inspect",
    subtitle: (input) => text(input.filePath) ?? text(input.path) ?? text(input.action) ?? "",
    args: (input) =>
      [text(input.action), number(input.offset) != null ? `offset=${number(input.offset)}` : "", number(input.limit) != null ? `limit=${number(input.limit)}` : ""].filter(Boolean) as string[],
    body: "terminal",
  },
  {
    name: "search",
    icon: "magnifying-glass",
    title: () => "Search",
    subtitle: (input) => text(input.pattern) ?? text(input.path) ?? "",
    args: (input) => [text(input.include) ? `include=${text(input.include)}` : ""].filter(Boolean) as string[],
    body: "terminal",
  },
  {
    name: "lsp",
    icon: "code",
    title: () => "LSP",
    subtitle: (input) => text(input.operation) ?? text(input.query) ?? text(input.filePath) ?? "",
    body: "terminal",
  },
  {
    name: "archive_list",
    icon: "archive",
    title: () => "Archive list",
    subtitle: (input) => getFilename(text(input.filePath) ?? text(input.path) ?? ""),
    body: "output",
  },
  {
    name: "data_query",
    icon: "magnifying-glass",
    title: () => "Data query",
    subtitle: (input) => getFilename(text(input.filePath) ?? ""),
    body: "output",
  },
  {
    name: "dir_tree",
    icon: "bullet-list",
    title: () => "Directory tree",
    subtitle: (input) => text(input.path) ?? "",
    body: "output",
  },
  {
    name: "markdown_read",
    icon: "code-lines",
    title: () => "Markdown read",
    subtitle: (input) => getFilename(text(input.filePath) ?? ""),
    body: "output",
  },
  {
    name: "discover_batch",
    icon: "bullet-list",
    title: () => "Discover batch",
    subtitle: (input) => countLabel(input.calls, "checks"),
    body: "custom",
    expandCompleted: true,
    renderBody: ({ metadata }) => batchBody(metadata, "term"),
  },
  {
    name: "lib_batch",
    icon: "magnifying-glass",
    title: () => "Library batch",
    subtitle: (input) => countLabel(input.calls, "calls"),
    body: "custom",
    expandCompleted: true,
    renderBody: ({ metadata }) => batchBody(metadata, "markdown"),
  },
  {
    name: "localgit_state",
    icon: "branch",
    title: () => "Local Git State",
    subtitle: (input) => text(input.path) ?? text(input.base) ?? text(input.action) ?? "",
    body: "terminal",
  },
  {
    name: "localgit_log",
    icon: "branch",
    title: () => "Local Git Log",
    subtitle: (input) => text(input.path) ?? text(input.ref) ?? text(input.base) ?? "",
    body: "terminal",
  },
  {
    name: "localgit_annotate",
    icon: "branch",
    title: () => "Local Git Annotate",
    subtitle: (input) => text(input.filePath) ?? text(input.pattern) ?? "",
    body: "terminal",
  },
  {
    name: "atlas-plan-follow",
    icon: "layout-bottom",
    title: () => "Plan Follow",
    subtitle: (input) => text(input.plan_id) ?? text(input.action) ?? "tracking",
    body: "custom",
    renderBody: ({ input, output, metadata }) => planBody(input, output, metadata),
  },
  {
    name: "git_commit",
    icon: "branch",
    title: () => "Git Commit",
    subtitle: (input) => {
      const first = text(input.message)?.split("\n")[0] ?? ""
      return first.length > 60 ? `${first.slice(0, 57)}…` : first
    },
    body: "terminal",
  },
]

export const teamTools: Array<{ name: string; render: ToolComponent }> = [
  ...toolDefs.map(presenter),
  {
    name: "bug_report",
    render(props: Parameters<ToolComponent>[0]) {
      const pending = props.status === "pending" || props.status === "running"
      const reportID = text(props.metadata.report_id)
      return (
        <BasicTool
          {...props}
          icon="warning"
          
          trigger={smartToolTrigger({
            icon: "warning",
            title: "Bug report",
            subtitle: text(props.input.title) ?? text(props.input.summary) ?? text(props.input.kind) ?? "",
            pending,
            meta: (
              <>
                <Show when={text(props.input.kind) ?? text(props.metadata.kind)}>{pill((text(props.input.kind) ?? text(props.metadata.kind))!)}</Show>
                <Show when={reportID}>{pill(short(reportID!), "success")}</Show>
              </>
            ),
          })}
        >
          {bugReportBody(props.input, props.output, props.metadata)}
        </BasicTool>
      )
    },
  },
  {
    name: "bug_report_management",
    render(props: Parameters<ToolComponent>[0]) {
      const pending = props.status === "pending" || props.status === "running"
      return (
        <BasicTool
          {...props}
          icon="warning"
          
          trigger={smartToolTrigger({
            icon: "warning",
            title: "Bug report management",
            subtitle: text(props.input.action) ?? "",
            pending,
            meta: <Show when={text(props.input.action)}>{pill(text(props.input.action)!, "info")}</Show>,
          })}
        >
          {terminal(props.output)}
        </BasicTool>
      )
    },
  },
  {
    name: "memory",
    render(props: Parameters<ToolComponent>[0]) {
      const pending = props.status === "pending" || props.status === "running"
      const summary = record(props.metadata.summary)
      const total = number(summary?.total)
      const entries = Array.isArray(props.metadata.entries) ? props.metadata.entries.length : undefined
      return (
        <BasicTool
          {...props}
          icon="brain"
          
          trigger={smartToolTrigger({
            icon: "brain",
            title: "Memory",
            subtitle: text(props.input.action) ?? "",
            pending,
            meta: (
              <>
                <Show when={text(props.input.action)}>{pill(text(props.input.action)!, "info")}</Show>
                <Show when={total != null}>{pill(`${total} entries`, "success")}</Show>
                <Show when={total == null && entries != null}>{pill(`${entries} entries`, "success")}</Show>
              </>
            ),
          })}
        >
          {memoryBody(props.input, props.output, props.metadata)}
        </BasicTool>
      )
    },
  },
  {
    name: "main-plan",
    render(props: Parameters<ToolComponent>[0]) {
      const pending = props.status === "pending" || props.status === "running"
      const plan = record(props.metadata.plan) as MainPlanShape | undefined
      const progress = plan?.stats ? planPercent(plan.stats.progress) : undefined
      return (
        <BasicTool
          {...props}
          icon="layout-bottom"
          
          trigger={smartToolTrigger({
            icon: "layout-bottom",
            title: "Main Plan",
            subtitle: text(props.input.action) ?? text(props.input.plan_id) ?? "",
            pending,
            meta: (
              <>
                <Show when={text(props.input.action)}>{pill(text(props.input.action)!, "info")}</Show>
                <Show when={progress}>{pill(progress!, "success")}</Show>
              </>
            ),
          })}
        >
          {planBody(props.input, props.output, props.metadata)}
        </BasicTool>
      )
    },
  },
]

export const taskAsyncTool: { name: string; render: ToolComponent } = {
  name: "task_async",
  render(props: Parameters<ToolComponent>[0]) {
    return taskAsyncBody(props.input, props.output, props.metadata, props.status)
  },
}

export const editTools: Array<{ name: string; render: ToolComponent }> = [
  {
    name: "edit_batch",
    render: presenter({
      name: "edit_batch",
      icon: "code-lines",
      title: () => "Edit Batch",
      subtitle: (input) => countLabel(input.calls, "calls"),
      body: "custom",
      expandCompleted: true,
      renderBody: ({ metadata }) => batchBody(metadata, "term"),
    }).render,
  },
  {
    name: "workspace_replace",
    render: presenter({
      name: "workspace_replace",
      icon: "code-lines",
      title: () => "Workspace Replace",
      subtitle: (input) => text(input.path) ?? text(input.filePath) ?? "",
      body: "terminal",
    }).render,
  },
  {
    name: "path_edit",
    render: presenter({
      name: "path_edit",
      icon: "code-lines",
      title: () => "Path Edit",
      subtitle: (input) => text(input.filePath) ?? text(input.path) ?? "",
      body: "terminal",
    }).render,
  },
  {
    name: "multiedit",
    render: presenter({
      name: "multiedit",
      icon: "code-lines",
      title: () => "Multi Edit",
      subtitle: (input) => getFilename(text(input.filePath) ?? ""),
      body: "terminal",
    }).render,
  },
]
