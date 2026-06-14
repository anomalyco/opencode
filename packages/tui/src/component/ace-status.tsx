import type { Event } from "@daemon-protocol/sdk/v2"
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

export function AceStatus() {
  const { theme } = useTheme()
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

  const kEffColor = createMemo(() => {
    const tone = kEffTone(store.kEff)
    return tone === "error" ? theme.error : tone === "warning" ? theme.warning : theme.textMuted
  })

  return (
    <Show when={activeSessionID() && mode() !== "off"}>
      <Show
        when={store.blocked}
        fallback={
          <text fg={theme.textMuted}>
            ACE {mode()} {store.toolCalls}tc {store.spawns}sp
            {store.activeSubagents > 0 ? ` ${store.activeSubagents}active` : ""}
            <Show when={store.kEff !== undefined}>
              {" "}
              <span style={{ fg: kEffColor() }}>k{store.kEff!.toFixed(2)}</span>
            </Show>
          </text>
        }
      >
        <text fg={theme.error}>ACE block {store.blocked}</text>
      </Show>
    </Show>
  )
}
