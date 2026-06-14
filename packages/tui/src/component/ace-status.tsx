import type { Event } from "@opencode-ai/sdk/v2"
import { createMemo, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useEvent } from "../context/event"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useRoute } from "../context/route"
import { kEffTone } from "../util/budget"

type AceMode = "off" | "monitor" | "fixed-cap" | "reject-escalate"

type AcePressure = {
  toolCalls: number
  turnToolCalls: number
  spawns: number
  spawnDepth: number
  activeSubagents: number
  kEff?: number
}

type AceEvent = Event & {
  properties: {
    sessionID: string
    mode: AceMode
    action?: "allow" | "observe" | "block" | "escalate"
    target?: "tool" | "spawn"
    pressure?: AcePressure
    reason?: string
  }
}

function isAceEvent(event: Event): event is AceEvent {
  return event.type === "session.next.ace.decision" || event.type === "session.next.ace.pressure"
}

function configMode(raw?: string): AceMode {
  if (raw === "monitor" || raw === "fixed-cap" || raw === "reject-escalate") return raw
  if (raw === "cap") return "fixed-cap"
  if (raw === "reject") return "reject-escalate"
  return "fixed-cap"
}

/**
 * Presentational ACE readout. Pure (theme-only) so it can be rendered and
 * snapshot-tested without the event/sync/route contexts.
 */
export function AceReadout(props: {
  mode: AceMode
  toolCalls: number
  spawns: number
  activeSubagents: number
  kEff?: number
  blocked?: string
}) {
  const { theme } = useTheme()
  const kEffColor = createMemo(() => {
    const tone = kEffTone(props.kEff)
    return tone === "error" ? theme.error : tone === "warning" ? theme.warning : theme.textMuted
  })

  return (
    <Show
      when={props.blocked}
      fallback={
        <text fg={theme.textMuted}>
          ACE {props.mode} {props.toolCalls}tc {props.spawns}sp
          {props.activeSubagents > 0 ? ` ${props.activeSubagents}active` : ""}
          <Show when={props.kEff !== undefined}>
            {" "}
            <span style={{ fg: kEffColor() }}>k{props.kEff!.toFixed(2)}</span>
          </Show>
        </text>
      }
    >
      <text fg={theme.error}>ACE block {props.blocked}</text>
    </Show>
  )
}

export function AceStatus() {
  const event = useEvent()
  const sync = useSync()
  const route = useRoute()
  const [store, setStore] = createStore({
    mode: "off" as AceMode,
    toolCalls: 0,
    spawns: 0,
    activeSubagents: 0,
    kEff: undefined as number | undefined,
    blocked: "",
  })

  const activeSessionID = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return (route.data as { sessionID: string }).sessionID
  })

  const configuredMode = createMemo(() => {
    const ace = sync.data.config.ace
    if (!ace || ace.enabled === false) return "off" as const
    return configMode(ace.mode)
  })

  onMount(() => {
    setStore("mode", configuredMode())
    let timeout: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = event.subscribe((raw) => {
      if (!isAceEvent(raw)) return
      if (raw.properties.sessionID !== activeSessionID()) return
      const pressure = raw.properties.pressure
      if (pressure) {
        setStore({
          mode: raw.properties.mode,
          toolCalls: pressure.toolCalls,
          spawns: pressure.spawns,
          activeSubagents: pressure.activeSubagents,
          kEff: pressure.kEff,
        })
      }
      if (raw.type === "session.next.ace.decision" && raw.properties.action === "block") {
        setStore("blocked", raw.properties.reason ?? `${raw.properties.target ?? "operation"} blocked`)
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => setStore("blocked", ""), 5_000)
      }
    })
    onCleanup(() => {
      unsubscribe()
      if (timeout) clearTimeout(timeout)
    })
  })

  const mode = createMemo(() => (store.mode === "off" ? configuredMode() : store.mode))

  return (
    <Show when={activeSessionID() && mode() !== "off"}>
      <AceReadout
        mode={mode()}
        toolCalls={store.toolCalls}
        spawns={store.spawns}
        activeSubagents={store.activeSubagents}
        kEff={store.kEff}
        blocked={store.blocked || undefined}
      />
    </Show>
  )
}
