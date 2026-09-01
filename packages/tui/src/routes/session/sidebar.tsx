import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, createSignal, For, Show, Switch, Match } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"
import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"
import { Glyphs } from "../../ui/glyphs"
import { Badge } from "../../ui/badge"
import { InkProgressBar } from "../../ui/ink/progress-bar"

// ── Tab Definitions ───────────────────────────────────────────────────────────
const TABS = [
  { id: "context",   label: "Context",   icon: "✦" },
  { id: "telemetry", label: "Telemetry", icon: "⚡" },
  { id: "knowledge", label: "Memory",    icon: "◈" },
  { id: "lsp",       label: "LSP",       icon: "◉" },
] as const

type TabId = (typeof TABS)[number]["id"]

// ── Static demo data (replaced by live data when SDK surfaces them) ───────────
const MEMORY_ITEMS = [
  { domain: "Code Style",  summary: "Strict Functional / Effect-TS", version: 3 },
  { domain: "Testing",     summary: "Bun Native (`bun test`)",        version: 2 },
  { domain: "Active Domain", summary: "General/Meta",                 version: 2 },
  { domain: "Action Graph",  summary: "0 Tools Executed",             version: 1 },
]

const LINEAGE = "General V1 → General/Meta V2"

// ── Sub-panel: Context ────────────────────────────────────────────────────────
function ContextPanel(props: {
  sessionID: string
  title: string
  sessionRawID?: string
  workspaceID?: string
}) {
  const { theme } = useTheme()
  const project = useProject()
  const workspace = () => {
    if (!props.workspaceID) return
    return project.workspace.get(props.workspaceID)
  }

  return (
    <box flexDirection="column" gap={1}>
      {/* Session title */}
      <box
        flexDirection="column"
        border={["left"]}
        borderColor={theme.accent}
        paddingLeft={1}
      >
        <text fg={theme.text}>
          <b>{props.title}</b>
        </text>
        <Show when={InstallationChannel !== "latest"}>
          <text fg={theme.textMuted}>{props.sessionRawID}</text>
        </Show>
      </box>

      {/* Workspace info */}
      <Show when={props.workspaceID}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted}>{Glyphs.pointerSmall}</text>
          <Show
            when={workspace()}
            fallback={<WorkspaceLabel type="unknown" name={props.workspaceID!} status="error" icon />}
          >
            {(item) => (
              <WorkspaceLabel
                type={item().type}
                name={item().name}
                status={project.workspace.status(item().id) ?? "error"}
                icon
              />
            )}
          </Show>
        </box>
      </Show>

      {/* Separator */}
      <text fg={theme.borderSubtle}>{"─".repeat(34)}</text>

      {/* Session stats */}
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>{"Version:"}</text>
          <text fg={theme.text}><b>{InstallationVersion}</b></text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>{"Branch:"}</text>
          <text fg={theme.accent}><b>{"feature/pplug"}</b></text>
        </box>
      </box>
    </box>
  )
}

// ── Sub-panel: Telemetry ──────────────────────────────────────────────────────
function TelemetryPanel(props: { sessionID: string }) {
  const { theme } = useTheme()
  const sync = useSync()
  const session = createMemo(() => sync.session.get(props.sessionID))

  // Derive model name from session
  const modelName = () => session()?.model?.id ?? "—"

  // Derive throughput from latest assistant message metadata if available
  const lastMsg = createMemo(() => {
    const s = session()
    if (!s) return undefined
    const msgs = sync.data.message[props.sessionID] ?? []
    return msgs.findLast((m: { role: string }) => m.role === "assistant")
  })

  const throughput = createMemo(() => {
    const meta = (lastMsg() as { metadata?: { throughput?: number } } | undefined)?.metadata
    return meta?.throughput ?? undefined
  })

  const ttft = createMemo(() => {
    const meta = (lastMsg() as { metadata?: { ttft?: number } } | undefined)?.metadata
    return meta?.ttft ?? undefined
  })

  // Static spark values (animated via createSignal when real data is available)
  const [spark] = createSignal([0.5, 1.2, 0.8, 1.9, 2.1, 1.8])

  return (
    <box flexDirection="column" gap={1}>
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.accent}><b>{"⚡ Live Telemetry"}</b></text>
      </box>

      {/* Engine */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>{"Engine:"}</text>
        <text fg={theme.text}><b>{modelName()}</b></text>
      </box>

      {/* Throughput */}
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>{"Throughput:"}</text>
          <text fg={theme.success}>
            <b>{throughput() != null ? `${(throughput() as number).toFixed(1)} tok/s` : "—"}</b>
          </text>
        </box>
        {/* Spark bar */}
        <box flexDirection="row" alignItems="center" gap={0}>
          <text fg={theme.textMuted}>{"Latency Spark: ["}</text>
          <For each={spark()}>
            {(v) => {
              const bars = ["▁","▂","▃","▄","▅","▆","▇","█"]
              const max = Math.max(...spark(), 1)
              const idx = Math.min(bars.length - 1, Math.round((v / max) * (bars.length - 1)))
              return <text fg={theme.accent}>{bars[idx]}</text>
            }}
          </For>
          <text fg={theme.textMuted}>{"]"}</text>
        </box>
      </box>

      {/* TTFT */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>{"TTFT:"}</text>
        <text fg={theme.warning}>
          {ttft() != null ? `${ttft()}ms` : "—"}
        </text>
      </box>

      {/* GPU KV Cache */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>{"GPU KV Cache:"}</text>
        <text fg={theme.success}>{"Active (FlashInfer)"}</text>
      </box>

      {/* Context bar */}
      <box flexDirection="column" gap={0}>
        <text fg={theme.textMuted}>{"Context window:"}</text>
        <InkProgressBar value={13} total={100} label="used" width={32} />
      </box>
    </box>
  )
}

// ── Sub-panel: Memory / Knowledge ─────────────────────────────────────────────
function MemoryPanel() {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={1}>
      {/* Memory Matrix header */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.accent}><b>{"✦ Memory Matrix"}</b></text>
        <text fg={theme.textMuted}>{`(${MEMORY_ITEMS.length} Synced)`}</text>
      </box>

      {/* Memory items tree */}
      <box flexDirection="column" gap={0}>
        <For each={MEMORY_ITEMS}>
          {(item, i) => {
            const isLast = () => i() === MEMORY_ITEMS.length - 1
            return (
              <box flexDirection="row" gap={1}>
                <text fg={theme.borderSubtle}>{isLast() ? " └─" : " ├─"}</text>
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{`[${item.domain}]`}</text>
                  <text fg={theme.text}>{`  ${item.summary}`}</text>
                </box>
              </box>
            )
          }}
        </For>
      </box>

      {/* Separator */}
      <text fg={theme.borderSubtle}>{"─".repeat(34)}</text>

      {/* Action graph */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.accent}><b>{"✦ Active Action & Symbol Graph"}</b></text>
      </box>
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>{"Reads: 0"}</text>
          <text fg={theme.textMuted}>{"Edits: 0"}</text>
          <text fg={theme.textMuted}>{"Diffs: 0"}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>{"Bash: 0"}</text>
        </box>
      </box>

      {/* Lineage */}
      <text fg={theme.borderSubtle}>{"─".repeat(34)}</text>
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>{"Lineage:"}</text>
        <text fg={theme.primary}>{LINEAGE}</text>
      </box>
    </box>
  )
}

// ── Sub-panel: LSP ────────────────────────────────────────────────────────────
function LspPanel() {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.accent}><b>{"◈ LSP"}</b></text>
      </box>
      <text fg={theme.textMuted}>{"LSPs are disabled"}</text>
    </box>
  )
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────
export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const [activeTab, setActiveTab] = createSignal<TabId>("context")

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={44}
        height="100%"
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={0}
        paddingRight={0}
        position={props.overlay ? "absolute" : "relative"}
        border={["left"]}
        borderColor={theme.borderSubtle}
      >
        {/* ── Brand header ── */}
        <box
          flexDirection="row"
          alignItems="center"
          gap={1}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          borderColor={theme.borderSubtle}
          border={["bottom"]}
        >
          <text fg={theme.success}>{"●"}</text>
          <text fg={theme.primary}><b>{"ZIQ"}</b></text>
          <text fg={theme.text}><b>{"-CODE"}</b></text>
          <text fg={theme.textMuted}>{"  "}{session()!.title?.slice(0, 16)}</text>
        </box>

        {/* ── Tab bar ── */}
        <box
          flexDirection="row"
          borderColor={theme.borderSubtle}
          border={["bottom"]}
          paddingLeft={1}
          paddingRight={1}
        >
          <For each={TABS}>
            {(tab) => {
              const isActive = () => tab.id === activeTab()
              return (
                <box
                  flexDirection="row"
                  alignItems="center"
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={0}
                  paddingBottom={0}
                  onMouseDown={() => setActiveTab(tab.id)}
                  backgroundColor={isActive() ? theme.backgroundElement : "transparent"}
                >
                  <text fg={isActive() ? theme.accent : theme.textMuted}>
                    {tab.icon}{" "}
                    {isActive() ? <b>{tab.label}</b> : tab.label}
                  </text>
                </box>
              )
            }}
          </For>
        </box>

        {/* ── Tab body ── */}
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <Switch>
              <Match when={activeTab() === "context"}>
                <ContextPanel
                  sessionID={props.sessionID}
                  title={session()!.title}
                  sessionRawID={props.sessionID}
                  workspaceID={session()!.workspaceID}
                />
                {/* Plugin slot for additional context content */}
                <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
              </Match>

              <Match when={activeTab() === "telemetry"}>
                <TelemetryPanel sessionID={props.sessionID} />
              </Match>

              <Match when={activeTab() === "knowledge"}>
                <MemoryPanel />
              </Match>

              <Match when={activeTab() === "lsp"}>
                <LspPanel />
              </Match>
            </Switch>
          </box>
        </scrollbox>

        {/* ── Footer ── */}
        <box
          flexShrink={0}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          borderColor={theme.borderSubtle}
          border={["top"]}
        >
          <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <box flexDirection="row" alignItems="center" gap={1}>
              <text fg={theme.success}>{"●"}</text>
              <text fg={theme.textMuted}>
                <b>{"Ziq"}</b>
              </text>
              <text fg={theme.text}>
                <b>{"-code local"}</b>
              </text>
              <text fg={theme.textMuted}>{"·"}</text>
              <text fg={theme.textMuted}>{InstallationVersion}</text>
            </box>
          </pluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
