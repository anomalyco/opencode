import { createMemo, For, Show, createEffect, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useRoute, useRouteData } from "../../../context/route"
import { useData } from "../../../context/data"
import { useClient } from "../../../context/client"
import { useTheme, selectedForeground } from "../../../context/theme"
import { Locale } from "../../../util/locale"
import { useBindings, useCommandShortcut } from "../../../keymap"
import { useComposerTab } from "./index"

interface SubagentEntry {
  sessionID: string
  agent: string
  title: string
  status: string
  current: boolean
}

export function SubagentsTab(props: { sessionID: string }) {
  const route = useRouteData("session")
  const data = useData()
  const client = useClient()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)
  const navigate = useRoute().navigate
  const composer = useComposerTab()
  const interruptHint = useCommandShortcut("composer.subagent.interrupt")

  const session = createMemo(() => data.session.get(props.sessionID))

  const entries = createMemo<SubagentEntry[]>(() => {
    const current = session()
    if (!current) return []

    const result: SubagentEntry[] = []

    if (current.parentID) {
      const siblings = data.session.list().filter((s) => s.parentID === current.parentID)
      for (const sibling of siblings) {
        const agentMatch = sibling.title.match(/@(\w+) subagent/)
        const agent = sibling.agent ? Locale.titlecase(sibling.agent) : agentMatch ? Locale.titlecase(agentMatch[1]) : "Subagent"
        const name = agentMatch ? sibling.title.replace(agentMatch[0], "").trim() || sibling.title : sibling.title
        result.push({
          sessionID: sibling.id,
          agent,
          title: name,
          status: data.session.status(sibling.id),
          current: sibling.id === route.sessionID,
        })
      }
    } else {
      const children = data.session.list().filter((s) => s.parentID === props.sessionID)
      for (const child of children) {
        const agentMatch = child.title.match(/@(\w+) subagent/)
        const agent = child.agent ? Locale.titlecase(child.agent) : agentMatch ? Locale.titlecase(agentMatch[1]) : "Subagent"
        const name = agentMatch ? child.title.replace(agentMatch[0], "").trim() || child.title : child.title
        result.push({
          sessionID: child.id,
          agent,
          title: name,
          status: data.session.status(child.id),
          current: child.id === route.sessionID,
        })
      }
    }

    return result
  })

  const [store, setStore] = createStore({ selected: 0 })
  let selectedSessionID = ""
  let wasActive = false
  let scroll: ScrollBoxRenderable | undefined

  const selected = createMemo(() => {
    return store.selected
  })
  const selectedEntry = createMemo(() => entries()[selected()])

  createEffect(() => {
    const active = composer.active("subagents")
    if (!active) {
      if (wasActive) {
        selectedSessionID = ""
        setStore("selected", 0)
      }
      wasActive = false
      return
    }
    const list = entries()
    if (selectedSessionID !== route.sessionID && list.length > 0) {
      const currentIdx = list.findIndex((e) => e.current)
      const next = currentIdx >= 0 ? currentIdx : 0
      selectedSessionID = route.sessionID
      setStore("selected", next)
      const scrollCurrentIntoView = () => scrollToIndex(next, true)
      scrollCurrentIntoView()
      requestAnimationFrame(scrollCurrentIntoView)
    }
    wasActive = true
    if (store.selected >= list.length) moveTo(Math.max(0, list.length - 1))
  })

  function moveTo(next: number, center = false) {
    setStore("selected", next)
    scrollToSelection(center)
  }

  function scrollToSelection(center: boolean) {
    scrollToIndex(selected(), center)
  }

  function scrollToIndex(index: number, center: boolean) {
    if (!scroll) return
    if (center) {
      scroll.scrollTo(Math.max(0, index - Math.floor(scroll.viewport.height / 2)))
      return
    }
    if (index >= scroll.scrollTop + scroll.viewport.height) {
      scroll.scrollTo(index - scroll.viewport.height + 1)
    }
    if (index < scroll.scrollTop) {
      scroll.scrollTo(index)
      if (index === 0) scroll.scrollTo(0)
    }
  }

  onMount(() => {
    const cleanup = composer.register({
      id: "subagents",
      label: "Subagents",
      hints: () => {
        const entry = selectedEntry()
        if (!entry || entry.status !== "running") return []
        return [{ label: "interrupt", shortcut: interruptHint() }]
      },
      onClose: () => {
        const parentID = session()?.parentID
        if (parentID) navigate({ type: "session", sessionID: parentID })
      },
    })
    onCleanup(cleanup)
  })

  useBindings(() => ({
    mode: "composer",
    enabled: () => composer.active("subagents"),
    commands: [
      {
        name: "composer.subagent.up",
        title: "Previous subagent",
        category: "Composer",
        run() {
          const list = entries()
          if (list.length === 0) return
          moveTo((store.selected - 1 + list.length) % list.length, true)
        },
      },
      {
        name: "composer.subagent.down",
        title: "Next subagent",
        category: "Composer",
        run() {
          const list = entries()
          if (list.length === 0) return
          moveTo((store.selected + 1) % list.length, true)
        },
      },
      {
        name: "composer.subagent.select",
        title: "Navigate to subagent",
        category: "Composer",
        run() {
          const entry = entries()[store.selected]
          if (entry) navigate({ type: "session", sessionID: entry.sessionID })
        },
      },
      {
        name: "composer.subagent.interrupt",
        title: "Interrupt subagent",
        category: "Composer",
        run() {
          const entry = selectedEntry()
          if (!entry || entry.status !== "running") return
          void client.api.session.interrupt({ sessionID: entry.sessionID })
        },
      },
    ],
    bindings: [
      { key: "up", desc: "Previous subagent", group: "Subagents", cmd: "composer.subagent.up" },
      { key: "down", desc: "Next subagent", group: "Subagents", cmd: "composer.subagent.down" },
      { key: "return", desc: "Navigate to subagent", group: "Subagents", cmd: "composer.subagent.select" },
      { key: "ctrl+d", desc: "Interrupt subagent", group: "Subagents", cmd: "composer.subagent.interrupt" },
    ],
  }))

  return (
    <Show when={composer.active("subagents")}>
      <scrollbox
        scrollbarOptions={{ visible: false }}
        maxHeight={5}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
      >
        <Show when={entries().length > 0} fallback={<text fg={theme.textMuted}> No subagents</text>}>
          <For each={entries()}>
            {(entry, index) => {
              const active = createMemo(() => index() === selected())
              const status = createMemo(() => {
                if (entry.status === "running") return "Running"
                return ""
              })
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                  onMouseOver={() => setStore("selected", index())}
                  onMouseUp={() => {
                    setStore("selected", index())
                    navigate({ type: "session", sessionID: entry.sessionID })
                  }}
                >
                  <box flexGrow={1} minWidth={0} flexDirection="row">
                    <text
                      fg={active() ? fg : entry.current ? theme.primary : theme.text}
                      attributes={active() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {entry.agent}: {entry.title}
                    </text>
                  </box>
                  <Show when={status()}>
                    <text fg={active() ? fg : theme.textMuted} wrapMode="none">
                      {status()}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
    </Show>
  )
}
