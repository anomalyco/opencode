import "./team-tools.css"

import { For, Show, createMemo } from "solid-js"
import { BasicTool } from "../../../ui/src/components/basic-tool"
import { Markdown } from "../../../ui/src/components/markdown"
import { useData } from "../../../ui/src/context"
import { getFilename } from "@opencode-ai/shared/util/path"
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

function countLabel(value: unknown, unit: string) {
  if (!Array.isArray(value)) return ""
  const count = value.length
  if (count === 0) return ""
  return `${count} ${unit}`
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

  return markdown(output) ?? terminal(text(input.plan_id) ?? text(input.action))
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
      <Show when={!entries.length && !summary && !findings.length && output}>
        {terminal(output)}
      </Show>
      <Show when={!entries.length && !summary && !findings.length && !output}>
        <div data-slot="team-tool-summary">{text(input.action) ?? "Memory operation"}</div>
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
      <Show when={output}>{markdown(output)}</Show>
    </div>
  )
}

function taskAsyncBody(input: Input, output?: string, metadata?: Meta, status?: string) {
  const data = useData()
  const info = createMemo(() => keyValue(output))
  const sessionID = createMemo(() => text(metadata?.sessionId) ?? text(input.task_id) ?? text(info().task_id))
  const action = createMemo(() => text(input.action) ?? "start")
  const agent = createMemo(() => text(input.subagent_type) ?? text(info().agent))
  const title = createMemo(
    () =>
      text(info().title) ??
      text(input.description) ??
      (sessionID() ? data.store.session.find((item) => item.id === sessionID())?.title : undefined) ??
      "Async task",
  )
  const summary = createMemo(
    () =>
      text(info().status) ??
      text(info().completion) ??
      text(info().task_output) ??
      text(info().last_assistant) ??
      text(info().result_access),
  )
  const time = createMemo(() => {
    const state = record(metadata?.time)
    const start = number(state?.start)
    const end = number(state?.end)
    if (start == null && end == null) return
    return { start, end }
  })

  return (
    <BasicTool
      icon="task"
      status={status}
      defaultOpen={status === "completed"}
      trigger={{
        title: title(),
        subtitle: summary() ?? action(),
        args: [action(), agent() ? `agent=${agent()}` : "", sessionID() ? `task=${short(sessionID()!)}` : ""].filter(Boolean),
      }}
    >
      <div data-component="team-tool-body">
        <div data-slot="team-tool-card">
          <div data-slot="team-tool-title-row">
            <span data-slot="team-tool-title">{title()}</span>
            <div data-slot="team-tool-pills">
              {pill(action())}
              <Show when={agent()}>{pill(agent()!)}</Show>
              <Show when={sessionID()}>{pill(short(sessionID()!), "success")}</Show>
              <ToolDuration time={time()} status={status} />
            </div>
          </div>
          <div data-slot="team-tool-kv-grid">
            <Show when={summary()}>
              <div data-slot="team-tool-kv-row">
                <span data-slot="team-tool-kv-label">Summary</span>
                <span data-slot="team-tool-kv-value">{summary()}</span>
              </div>
            </Show>
            <Show when={text(info().created_at)}>
              <div data-slot="team-tool-kv-row">
                <span data-slot="team-tool-kv-label">Created</span>
                <span data-slot="team-tool-kv-value">{text(info().created_at)}</span>
              </div>
            </Show>
            <Show when={text(info().updated_at)}>
              <div data-slot="team-tool-kv-row">
                <span data-slot="team-tool-kv-label">Updated</span>
                <span data-slot="team-tool-kv-value">{text(info().updated_at)}</span>
              </div>
            </Show>
            <Show when={text(info().last_error)}>
              <div data-slot="team-tool-kv-row">
                <span data-slot="team-tool-kv-label">Last error</span>
                <span data-slot="team-tool-kv-value">{text(info().last_error)}</span>
              </div>
            </Show>
          </div>
        </div>
        <Show when={output && output.trim().length > 0}>{terminal(output)}</Show>
      </div>
    </BasicTool>
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
      return (
        <BasicTool
          {...props}
          icon="warning"
          defaultOpen
          trigger={{
            title: "Bug report",
            subtitle: text(props.input.title) ?? text(props.input.summary) ?? text(props.input.kind) ?? "",
          }}
        >
          {bugReportBody(props.input, props.output, props.metadata)}
        </BasicTool>
      )
    },
  },
  {
    name: "bug_report_management",
    render(props: Parameters<ToolComponent>[0]) {
      return (
        <BasicTool
          {...props}
          icon="warning"
          defaultOpen={props.status === "completed"}
          trigger={{
            title: "Bug report management",
            subtitle: text(props.input.action) ?? "",
          }}
        >
          {markdown(props.output) ?? terminal(props.output)}
        </BasicTool>
      )
    },
  },
  {
    name: "memory",
    render(props: Parameters<ToolComponent>[0]) {
      return (
        <BasicTool
          {...props}
          icon="brain"
          defaultOpen={props.status === "completed"}
          trigger={{
            title: "Memory",
            subtitle: text(props.input.action) ?? "",
          }}
        >
          {memoryBody(props.input, props.output, props.metadata)}
        </BasicTool>
      )
    },
  },
  {
    name: "main-plan",
    render(props: Parameters<ToolComponent>[0]) {
      return (
        <BasicTool
          {...props}
          icon="layout-bottom"
          defaultOpen={props.status === "completed"}
          trigger={{
            title: "Main Plan",
            subtitle: text(props.input.action) ?? text(props.input.plan_id) ?? "",
          }}
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
