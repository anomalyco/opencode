import { createMemo, For, Show, createEffect, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useRoute, useRouteData } from "../../../context/route"
import { useData } from "../../../context/data"
import { useClient } from "../../../context/client"
import { useTheme } from "../../../context/theme"
import { Locale } from "../../../util/locale"
import { Keymap } from "../../../context/keymap"
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
  const { themeV2 } = useTheme()
  const fg = themeV2.text.action.primary("focused")
  const navigate = useRoute().navigate
  const composer = useComposerTab()
  const shortcuts = Keymap.useShortcuts()

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
        return [{ label: "interrupt", shortcut: shortcuts.get("composer.subagent.interrupt") ?? "" }]
      },
      onClose: () => {
        const parentID = session()?.parentID
        if (parentID) navigate({ type: "session", sessionID: parentID })
      },
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("subagents"),
    commands: [
      {
        id: "composer.subagent.up",
        title: "Previous subagent",
        group: "Composer",
        bind: "up",
        run() {
          const list = entries()
          if (list.length === 0) return
          moveTo((store.selected - 1 + list.length) % list.length, true)
        },
      },
      {
        id: "composer.subagent.down",
        title: "Next subagent",
        group: "Composer",
        bind: "down",
        run() {
          const list = entries()
          if (list.length === 0) return
          moveTo((store.selected + 1) % list.length, true)
        },
      },
      {
        id: "composer.subagent.select",
        title: "Navigate to subagent",
        group: "Composer",
        bind: "return",
        run() {
          const entry = entries()[store.selected]
          if (entry) navigate({ type: "session", sessionID: entry.sessionID })
        },
      },
      {
        id: "composer.subagent.interrupt",
        title: "Interrupt subagent",
        group: "Composer",
        bind: "ctrl+d",
        run() {
          const entry = selectedEntry()
          if (!entry || entry.status !== "running") return
          void client.api.session.interrupt({ sessionID: entry.sessionID })
        },
      },
    ],
  }))

  return (
    <Show when={composer.active("subagents")}>
      <scrollbox
        scrollbarOptions={{ visible: false }}
        maxHeight={5}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
      >
        <Show when={entries().length > 0} fallback={<text fg={themeV2.text.subdued()}> No subagents</text>}>
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
                  backgroundColor={active() ? themeV2.background.action.primary() : RGBA.fromInts(0, 0, 0, 0)}
                  onMouseOver={() => setStore("selected", index())}
                  onMouseUp={() => {
                    setStore("selected", index())
                    navigate({ type: "session", sessionID: entry.sessionID })
                  }}
                >
                  <box flexGrow={1} minWidth={0} flexDirection="row">
                    <text
                      fg={active() ? fg : entry.current ? themeV2.background.action.primary() : themeV2.text()}
                      attributes={active() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {entry.agent}: {entry.title}
                    </text>
                  </box>
                  <Show when={status()}>
                    <text fg={active() ? fg : themeV2.text.subdued()} wrapMode="none">
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
