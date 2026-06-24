/**
 * Monitor / Workflows tab.
 *
 * 11 datasets. Three get bespoke inline SVG charts in this milestone;
 * the rest show as JSON for now.
 *
 *   orchestration       → tree diagram (root → leaves)
 *   tool_sankey         → proportional bars per tool → status
 *   complexity          → scatter (tokens × duration, bubble size = cost)
 *   model_delegation    → horizontal bars per provider/model
 *   error_propagation   → ranked list with counts
 *   compaction          → sparkline of tokens before/after
 *   per_session         → table
 *
 * The remaining datasets (collaboration, patterns, concurrency,
 * subagent_effectiveness) are rendered as JSON for inspection until
 * their bespoke chart lands.
 */

import { createResource, createSignal, For, Show, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { createMonitorClient } from "@/utils/monitor-sdk"
import {
  Orchestration,
  ToolSankey,
  ModelFlowSlice,
  ErrorGroup,
  ComplexityPoint,
  CompactionPoint,
  PerSessionRow,
} from "@/utils/monitor-schema"
import { z } from "zod"

type Status = "active" | "completed" | "all"

const STATUSES: { id: Status; key: string }[] = [
  { id: "active", key: "monitor.workflows.status_active" },
  { id: "completed", key: "monitor.workflows.status_completed" },
  { id: "all", key: "monitor.workflows.status_all" },
]

// --- Orchestration tree --------------------------------------------------

function OrchestrationTree(props: { nodes: z.infer<typeof Orchestration>["nodes"]; links: z.infer<typeof Orchestration>["links"] }) {
  // Build adjacency.
  const childrenOf = new Map<string | null, string[]>()
  for (const n of props.nodes) {
    const list = childrenOf.get(n.parent) ?? []
    list.push(n.id)
    childrenOf.set(n.parent, list)
  }
  const titleById = new Map(props.nodes.map((n) => [n.id, n.title] as const))
  const roots = childrenOf.get(null) ?? []

  const W = 760
  const rowH = 28
  const padding = 16

  // Pre-compute layout via DFS.
  let y = padding
  const pos = new Map<string, { x: number; y: number }>()
  function visit(id: string, depth: number) {
    pos.set(id, { x: padding + depth * 16, y })
    y += rowH
    for (const child of childrenOf.get(id) ?? []) visit(child, depth + 1)
  }
  for (const r of roots) visit(r, 0)

  const height = Math.max(y + padding, 80)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} class="w-full" role="img" aria-label="orchestration">
      <For each={props.links}>
        {(link) => {
          const a = pos.get(link.source)
          const b = pos.get(link.target)
          if (!a || !b) return null
          const path = `M ${a.x + 6} ${a.y + rowH / 2} L ${b.x} ${a.y + rowH / 2} L ${b.x} ${b.y + rowH / 2}`
          return <path d={path} stroke="currentColor" class="text-border-base" fill="none" />
        }}
      </For>
      <For each={props.nodes}>
        {(n) => {
          const p = pos.get(n.id)
          if (!p) return null
          return (
            <g transform={`translate(${p.x},${p.y})`}>
              <rect width={Math.max(80, Math.min(220, n.title.length * 7))} height={rowH - 6} rx={4} class="fill-surface-strong-base" />
              <text x={8} y={rowH / 2 - 2} dominant-baseline="central" class="fill-text-strong" font-size="11">
                {n.title.length > 30 ? n.title.slice(0, 28) + "…" : n.title}
              </text>
              <title>{titleById.get(n.id)}</title>
            </g>
          )
        }}
      </For>
    </svg>
  )
}

// --- Tool Sankey (proportional bars) -------------------------------------

function ToolSankeyChart(props: { sankey: z.infer<typeof ToolSankey> }) {
  const max = () => Math.max(1, ...props.sankey.edges.map((e) => e.value))
  return (
    <div class="flex flex-col gap-1">
      <For each={props.sankey.edges.slice(0, 12)}>
        {(edge) => (
          <div class="flex items-center gap-2 text-11-regular">
            <span class="w-20 truncate text-text-weak font-mono">{edge.source.replace(/^tool:/, "")}</span>
            <div class="flex-1 h-3 bg-surface-strong-base rounded overflow-hidden">
              <div
                class="h-full bg-icon-info-base"
                style={{ width: `${(edge.value / max()) * 100}%` }}
              />
            </div>
            <span class="w-32 truncate text-text-base font-mono">{edge.target.replace(/^status:/, "")}</span>
            <span class="w-10 text-right text-text-weak">{edge.value}</span>
          </div>
        )}
      </For>
      <Show when={props.sankey.edges.length === 0}>
        <p class="text-11-regular text-text-weak">No tool activity yet.</p>
      </Show>
    </div>
  )
}

// --- Complexity scatter --------------------------------------------------

function ComplexityScatter(props: { points: ComplexityPoint[] }) {
  const W = 320
  const H = 200
  const padding = 16
  const data = () => props.points
  const maxTokens = () => Math.max(1, ...data().map((p) => p.tokens))
  const maxDuration = () => Math.max(1, ...data().map((p) => p.duration_ms))
  const maxCost = () => Math.max(0.01, ...data().map((p) => p.cost))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="w-full" role="img" aria-label="complexity">
      <For each={data()}>
        {(p) => {
          const cx = padding + (p.tokens / maxTokens()) * (W - 2 * padding)
          const cy = H - padding - (p.duration_ms / maxDuration()) * (H - 2 * padding)
          const r = 2 + Math.sqrt(p.cost / maxCost()) * 10
          return (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              class="fill-icon-info-base opacity-70"
            >
              <title>
                {p.session_id.slice(0, 8)} · {p.tokens.toLocaleString()} tok · ${p.cost.toFixed(4)}
              </title>
            </circle>
          )
        }}
      </For>
      <line
        x1={padding}
        y1={H - padding}
        x2={W - padding}
        y2={H - padding}
        class="stroke-border-weak-base"
      />
      <line x1={padding} y1={padding} x2={padding} y2={H - padding} class="stroke-border-weak-base" />
      <text x={padding} y={H - 4} font-size="10" class="fill-text-weak">
        tokens
      </text>
      <text x={4} y={padding + 8} font-size="10" class="fill-text-weak">
        duration
      </text>
    </svg>
  )
}

// --- Model delegation (horizontal bars) ----------------------------------

function ModelDelegation(props: { slices: ModelFlowSlice[] }) {
  const max = () => Math.max(1, ...props.slices.map((s) => s.cost))
  return (
    <div class="flex flex-col gap-1">
      <For each={props.slices.slice(0, 8)}>
        {(slice) => (
          <div class="flex items-center gap-2 text-11-regular">
            <span class="w-32 truncate text-text-base font-mono">
              {slice.provider}/{slice.model}
            </span>
            <div class="flex-1 h-3 bg-surface-strong-base rounded overflow-hidden">
              <div class="h-full bg-icon-warning-base" style={{ width: `${(slice.cost / max()) * 100}%` }} />
            </div>
            <span class="w-20 text-right text-text-weak">${slice.cost.toFixed(3)}</span>
          </div>
        )}
      </For>
      <Show when={props.slices.length === 0}>
        <p class="text-11-regular text-text-weak">No model activity yet.</p>
      </Show>
    </div>
  )
}

// --- Error groups (ranked list) ------------------------------------------

function ErrorGroups(props: { groups: ErrorGroup[] }) {
  return (
    <ul class="flex flex-col gap-1 text-12-regular">
      <For each={props.groups.slice(0, 8)}>
        {(g) => (
          <li class="flex items-center gap-2">
            <span class="size-2 rounded-full bg-status-error-base" />
            <span class="flex-1 truncate text-text-base">{g.message.slice(0, 60)}</span>
            <span class="text-text-weak font-mono">{g.count}</span>
          </li>
        )}
      </For>
      <Show when={props.groups.length === 0}>
        <p class="text-11-regular text-text-weak">No errors recorded.</p>
      </Show>
    </ul>
  )
}

// --- Compaction sparkline ------------------------------------------------

function CompactionTimeline(props: { points: CompactionPoint[] }) {
  if (props.points.length === 0) return <p class="text-11-regular text-text-weak">No compaction events.</p>
  return (
    <ol class="flex flex-col gap-1 text-11-regular">
      <For each={props.points.slice(0, 10)}>
        {(p) => (
          <li class="flex items-center justify-between gap-2">
            <span class="font-mono text-text-weak">{new Date(p.at).toLocaleTimeString()}</span>
            <span class="text-text-base truncate">{p.session_id.slice(0, 8)}</span>
            <span class="text-text-weak">
              {p.tokens_before?.toLocaleString() ?? "?"} → {p.tokens_after?.toLocaleString() ?? "?"}
            </span>
          </li>
        )}
      </For>
    </ol>
  )
}

// --- Per-session table ---------------------------------------------------

function PerSessionTable(props: { rows: PerSessionRow[] }) {
  return (
    <table class="w-full text-11-regular">
      <thead>
        <tr class="text-text-weak text-left">
          <th class="font-normal pb-1">title</th>
          <th class="font-normal pb-1 text-right">cost</th>
          <th class="font-normal pb-1 text-right">tokens</th>
          <th class="font-normal pb-1 text-right">tools</th>
          <th class="font-normal pb-1 text-right">errors</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.rows.slice(0, 10)}>
          {(r) => (
            <tr class="border-t border-border-weak-base">
              <td class="py-1 truncate max-w-[180px]">{r.title}</td>
              <td class="py-1 text-right font-mono">${r.cost.toFixed(4)}</td>
              <td class="py-1 text-right font-mono">{r.tokens.toLocaleString()}</td>
              <td class="py-1 text-right">{r.tool_calls}</td>
              <td class="py-1 text-right">{r.errors}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  )
}

// --- Generic JSON viewer for not-yet-charted datasets --------------------

function JsonView(props: { label: string; data: unknown }) {
  return (
    <details class="text-11-regular">
      <summary class="cursor-pointer text-text-base">{props.label}</summary>
      <pre class="mt-1 max-h-32 overflow-auto rounded bg-surface-strong-base p-2 text-10-regular text-text-weak">
        {JSON.stringify(props.data, null, 2)}
      </pre>
    </details>
  )
}

export function MonitorWorkflows(props: { baseUrl: string }) {
  const language = useLanguage()
  const client = createMonitorClient({ baseUrl: props.baseUrl })
  const [status, setStatus] = createSignal<Status>("all")
  const [report] = createResource(
    () => status(),
    (s) => client.workflows(s),
  )

  const orchestration = createMemo(() => {
    const r = report()
    if (!r) return null
    const parsed = Orchestration.safeParse(r.datasets.orchestration)
    return parsed.success ? parsed.data : null
  })

  const sankey = createMemo(() => {
    const r = report()
    if (!r) return null
    const parsed = ToolSankey.safeParse(r.datasets.tool_sankey)
    return parsed.success ? parsed.data : null
  })

  const complexity = createMemo(() => {
    const r = report()
    if (!r) return []
    const parsed = z.array(ComplexityPoint).safeParse(r.datasets.complexity)
    return parsed.success ? parsed.data : []
  })

  const modelFlow = createMemo(() => {
    const r = report()
    if (!r) return []
    const parsed = z.array(ModelFlowSlice).safeParse(r.datasets.model_delegation)
    return parsed.success ? parsed.data : []
  })

  const errorGroups = createMemo(() => {
    const r = report()
    if (!r) return []
    const parsed = z.array(ErrorGroup).safeParse(r.datasets.error_propagation)
    return parsed.success ? parsed.data : []
  })

  const compaction = createMemo(() => {
    const r = report()
    if (!r) return []
    const parsed = z.array(CompactionPoint).safeParse(r.datasets.compaction)
    return parsed.success ? parsed.data : []
  })

  const perSession = createMemo(() => {
    const r = report()
    if (!r) return []
    const parsed = z.array(PerSessionRow).safeParse(r.datasets.per_session)
    return parsed.success ? parsed.data : []
  })

  return (
    <div class="flex flex-col gap-4">
      <header class="flex items-center justify-between">
        <h2 class="text-14-medium text-text-base">{language.t("monitor.workflows.title")}</h2>
        <div class="flex gap-1">
          <For each={STATUSES}>
            {(s) => (
              <button
                type="button"
                onClick={() => setStatus(s.id)}
                classList={{
                  "px-2 py-1 text-12-medium rounded": true,
                  "bg-surface-strong-base text-text-strong": status() === s.id,
                  "text-text-weak hover:text-text-base": status() !== s.id,
                }}
              >
                {language.t(s.key)}
              </button>
            )}
          </For>
        </div>
      </header>

      <Show
        when={report()}
        fallback={<p class="text-text-weak text-13-regular">{language.t("monitor.common.loading")}</p>}
      >
        {(r) => (
          <div class="grid gap-3" style={{ "grid-template-columns": "repeat(auto-fill, minmax(320px, 1fr))" }}>
            <article class="rounded-lg border border-border-weak-base bg-surface-base p-3 col-span-full">
              <header class="text-13-medium text-text-base mb-2">Orchestration DAG</header>
              <Show when={orchestration()} fallback={<p class="text-11-regular text-text-weak">No data.</p>}>
                {(o) => <OrchestrationTree nodes={o().nodes} links={o().links} />}
              </Show>
            </article>

            <article class="rounded-lg border border-border-weak-base bg-surface-base p-3">
              <header class="text-13-medium text-text-base mb-2">Tool execution</header>
              <Show when={sankey()}>
                {(s) => <ToolSankeyChart sankey={s()} />}
              </Show>
            </article>

            <article class="rounded-lg border border-border-weak-base bg-surface-base p-3">
              <header class="text-13-medium text-text-base mb-2">Model delegation</header>
              <ModelDelegation slices={modelFlow()} />
            </article>

            <article class="rounded-lg border border-border-weak-base bg-surface-base p-3">
              <header class="text-13-medium text-text-base mb-2">Complexity scatter</header>
              <ComplexityScatter points={complexity()} />
            </article>

            <article class="rounded-lg border border-border-weak-base bg-surface-base p-3">
              <header class="text-13-medium text-text-base mb-2">Error propagation</header>
              <ErrorGroups groups={errorGroups()} />
            </article>

            <article class="rounded-lg border border-border-weak-base bg-surface-base p-3">
              <header class="text-13-medium text-text-base mb-2">Compaction</header>
              <CompactionTimeline points={compaction()} />
            </article>

            <article class="rounded-lg border border-border-weak-base bg-surface-base p-3 col-span-full">
              <header class="text-13-medium text-text-base mb-2">Per-session rollup</header>
              <PerSessionTable rows={perSession()} />
            </article>

            <article class="rounded-lg border border-border-weak-base bg-surface-base p-3 col-span-full">
              <header class="text-13-medium text-text-base mb-2">Other datasets</header>
              <div class="grid gap-2" style={{ "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))" }}>
                <Show when={report()}>
                  {(r) => (
                    <>
                      <JsonView label="collaboration" data={r().datasets.collaboration} />
                      <JsonView label="patterns" data={r().datasets.patterns} />
                      <JsonView label="concurrency" data={r().datasets.concurrency} />
                      <JsonView label="subagent_effectiveness" data={r().datasets.subagent_effectiveness} />
                    </>
                  )}
                </Show>
              </div>
            </article>
          </div>
        )}
      </Show>
    </div>
  )
}