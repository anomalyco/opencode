import { createEffect, For, Show, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Part, Session, ToolPart, ToolStateRunning } from "@opencode-ai/sdk/v2"
import { formatDuration } from "../../../../util/format"
import { useTheme } from "../context/theme"
import { extractToolCommand, RUNNING_THRESHOLD_MS, type RunningItem } from "./running-utils"

type ToolsData = {
  session: Session[]
  session_status: Record<string, { type: string }>
  message: Record<string, { id: string }[]>
  part: Record<string, Part[]>
}

type RunningToolPart = ToolPart & { state: ToolStateRunning }

function isRunningTool(part: Part): part is RunningToolPart {
  return part.type === "tool" && part.state.status === "running"
}

function extractDescription(title: string): string {
  const match = title.match(/^(.+?)\s*\(@/)
  return match ? match[1] : title
}

export function createRunningTools(
  sessionID: Accessor<string>,
  data: ToolsData,
  tick: Accessor<number>,
): Accessor<RunningItem[]> {
  const [items, setItems] = createStore<RunningItem[]>([])

  // Track when each tool/session was first seen (for display threshold)
  const firstSeen = new Map<string, number>()
  let lastSessionID: string | null = null

  createEffect(() => {
    const now = tick()
    const currentSessionID = sessionID()

    // Reset tracking when session changes
    if (currentSessionID !== lastSessionID) {
      firstSeen.clear()
      lastSessionID = currentSessionID
    }

    const activeIds = new Set<string>()

    // Get all running tool parts from current session (excluding task tools - shown as agents)
    const sessionTools = (data.message[currentSessionID] ?? [])
      .flatMap((msg) => data.part[msg.id] ?? [])
      .filter(isRunningTool)
      .filter((part) => part.tool !== "task")
      .map((part) => {
        activeIds.add(part.id)
        if (!firstSeen.has(part.id)) firstSeen.set(part.id, now)
        return part
      })
      .filter((part) => now - firstSeen.get(part.id)! >= RUNNING_THRESHOLD_MS)
      .sort((a, b) => a.state.time.start - b.state.time.start)
      .map(
        (part): RunningItem => ({
          id: part.id,
          label: extractToolCommand(part.tool, part.state.input as Record<string, unknown>),
          startTime: part.state.time.start,
        }),
      )

    // Get active child sessions (agents)
    const childSessions = (data.session ?? [])
      .filter((s) => s.parentID === currentSessionID)
      .filter((s) => {
        const status = data.session_status?.[s.id]
        return status !== undefined && status.type !== "idle"
      })
      .map((session) => {
        activeIds.add(session.id)
        if (!firstSeen.has(session.id)) firstSeen.set(session.id, now)
        return session
      })
      .filter((session) => now - firstSeen.get(session.id)! >= RUNNING_THRESHOLD_MS)
      .sort((a, b) => firstSeen.get(a.id)! - firstSeen.get(b.id)!)

    // Build agent items with their running tools
    const agentItems = childSessions.map((session, i): RunningItem => {
      const agentTools = (data.message[session.id] ?? [])
        .flatMap((msg) => data.part[msg.id] ?? [])
        .filter(isRunningTool)
        .map((part) => {
          activeIds.add(part.id)
          if (!firstSeen.has(part.id)) firstSeen.set(part.id, now)
          return part
        })
        .filter((part) => now - firstSeen.get(part.id)! >= RUNNING_THRESHOLD_MS)
        .sort((a, b) => a.state.time.start - b.state.time.start)
        .map(
          (part): RunningItem => ({
            id: part.id,
            label: extractToolCommand(part.tool, part.state.input as Record<string, unknown>),
            startTime: part.state.time.start,
          }),
        )

      return {
        id: session.id,
        label: `Agent#${i + 1}`,
        subtext: extractDescription(session.title),
        startTime: firstSeen.get(session.id),
        isAgent: true,
        children: agentTools,
      }
    })

    // Cleanup stale entries
    for (const id of firstSeen.keys()) {
      if (!activeIds.has(id)) firstSeen.delete(id)
    }

    setItems(reconcile([...sessionTools, ...agentItems], { key: "id" }))
  })

  return () => items
}

export function ToolItemView(props: { item: RunningItem; now: number }) {
  return (
    <Show when={props.item.isAgent} fallback={<ToolLine item={props.item} now={props.now} />}>
      <AgentView item={props.item} now={props.now} />
    </Show>
  )
}

function AgentView(props: { item: RunningItem; now: number }) {
  const { theme } = useTheme()
  const elapsed = () => {
    if (props.item.startTime === undefined) return ""
    return formatDuration(Math.floor((props.now - props.item.startTime) / 1000))
  }

  return (
    <box flexDirection="column" paddingLeft={1}>
      <box flexDirection="row" gap={1}>
        <text flexShrink={0} fg={theme.warning}>
          ⊙
        </text>
        <text fg={theme.text}>{props.item.label}</text>
        <Show when={elapsed()}>
          <text fg={theme.textMuted}>{elapsed()}</text>
        </Show>
      </box>
      <text fg={theme.textMuted} paddingLeft={3}>
        {props.item.subtext}
      </text>
      <For each={props.item.children ?? []}>{(child) => <ToolLine item={child} now={props.now} indent />}</For>
    </box>
  )
}

function ToolLine(props: { item: RunningItem; now: number; indent?: boolean }) {
  const { theme } = useTheme()
  const elapsed = () => {
    if (props.item.startTime === undefined) return ""
    return formatDuration(Math.floor((props.now - props.item.startTime) / 1000))
  }

  return (
    <box flexDirection="row" gap={1} paddingLeft={props.indent ? 3 : 1}>
      <text flexShrink={0} fg={theme.warning}>
        ▶
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.item.label}
        <Show when={elapsed()}>
          <span style={{ fg: theme.textMuted }}> {elapsed()}</span>
        </Show>
      </text>
    </box>
  )
}
