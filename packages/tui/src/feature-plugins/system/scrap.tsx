import { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createSignal, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { SessionTabs, type SessionTabsController } from "../../component/session-tabs"
import { moveSessionTab } from "../../context/session-tabs-model"

type FixtureStatus = ReturnType<SessionTabsController["status"]>

const FIXTURE_TABS = [
  { sessionID: "fixture-1", title: "Implement session tabs" },
  { sessionID: "fixture-2", title: "Investigate rendering" },
  { sessionID: "fixture-3", title: "A deliberately long session title for truncation" },
  { sessionID: "fixture-4", title: "Fix provider state" },
  { sessionID: "fixture-5", title: "Review animation" },
  { sessionID: "fixture-6", title: "Untitled behavior" },
  { sessionID: "fixture-7", title: "Queue follow-up work" },
  { sessionID: "fixture-8", title: "Check narrow layout" },
  { sessionID: "fixture-9", title: "Profile terminal output" },
  { sessionID: "fixture-10", title: "Handle permission" },
  { sessionID: "fixture-11", title: "Run focused tests" },
  { sessionID: "fixture-12", title: "Prepare review" },
]

const EMPTY_STATUS: FixtureStatus = { unread: undefined, attention: false, busy: false }
const RUN_DURATION = 1_800
const RESUME_DURATION = 900

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "app.scrap",
        title: "Open scrap screen",
        group: "Debug",
        palette: true,
        run() {
          props.context.ui.router.navigate({ type: "plugin", name: "scrap" })
          props.context.ui.dialog.clear()
        },
      },
    ],
  }))
  return null
}

function Scrap(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const elevatedTheme = theme.contextual.elevated
  // A keyed store mirrors production: retitles mutate rows in place instead of remounting them.
  const [tabStore, setTabStore] = createStore<{ items: { sessionID: string; title?: string }[] }>({
    items: FIXTURE_TABS.slice(0, 6).map((tab) => ({ ...tab })),
  })
  const tabs = () => tabStore.items
  const setItems = (next: { sessionID: string; title?: string }[]) =>
    setTabStore("items", reconcile(next, { key: "sessionID" }))
  const [active, setActive] = createSignal<string | undefined>("fixture-1")
  const [lastEvent, setLastEvent] = createSignal("press space to start a random tab")
  const [statuses, setStatuses] = createSignal<Record<string, FixtureStatus>>({})
  const runs = new Map<string, ReturnType<typeof setTimeout>>()
  onCleanup(() => runs.forEach(clearTimeout))

  const number = (sessionID: string) => tabs().findIndex((tab) => tab.sessionID === sessionID) + 1

  function finishRun(sessionID: string, resumed: boolean) {
    runs.delete(sessionID)
    if (!tabs().some((item) => item.sessionID === sessionID)) return
    const roll = Math.random()
    // A permission request pauses the still-busy run until the tab is selected.
    if (!resumed && roll < 0.25) {
      setStatuses((current) => ({
        ...current,
        [sessionID]: { ...(current[sessionID] ?? EMPTY_STATUS), attention: true },
      }))
      setLastEvent(`tab ${number(sessionID)} needs input; select it to resolve`)
      return
    }
    const failed = roll >= 0.75
    const unread = active() === sessionID ? undefined : failed ? ("error" as const) : ("activity" as const)
    batch(() => {
      setStatuses((current) => ({
        ...current,
        [sessionID]: { ...(current[sessionID] ?? EMPTY_STATUS), busy: false, unread },
      }))
      // An untitled session earns its title after its first completed run, like a real summarization.
      const index = number(sessionID) - 1
      const fixture = FIXTURE_TABS.find((tab) => tab.sessionID === sessionID)
      if (!failed && fixture && tabs()[index]?.title === undefined) setTabStore("items", index, "title", fixture.title)
    })
    setLastEvent(
      `tab ${number(sessionID)} ${failed ? "failed" : "completed"}${unread ? " (unread)" : " while selected"}`,
    )
  }

  const select = (sessionID: string) => {
    const status = statuses()[sessionID]
    const resumes = status !== undefined && status.attention && status.busy && !runs.has(sessionID)
    batch(() => {
      setActive(sessionID)
      if (status && (status.unread || status.attention))
        setStatuses((current) => ({ ...current, [sessionID]: { ...status, unread: undefined, attention: false } }))
    })
    if (resumes) {
      setLastEvent(`tab ${number(sessionID)} input resolved, resuming`)
      runs.set(
        sessionID,
        setTimeout(() => finishRun(sessionID, true), RESUME_DURATION),
      )
    }
  }

  const controller = {
    tabs,
    current: active,
    status(sessionID) {
      return statuses()[sessionID] ?? EMPTY_STATUS
    },
    select,
    move(sessionID: string, index: number) {
      const next = moveSessionTab(tabs(), sessionID, index)
      if (next === tabs()) return
      setItems(next.map((tab) => ({ ...tab })))
    },
    close(sessionID?: string) {
      const target = sessionID ?? active()
      if (!target) return
      const items = tabs()
      const index = items.findIndex((tab) => tab.sessionID === target)
      if (index === -1) return
      const next = items.filter((tab) => tab.sessionID !== target).map((tab) => ({ ...tab }))
      const selected = next[index]?.sessionID ?? next[index - 1]?.sessionID
      clearTimeout(runs.get(target))
      runs.delete(target)
      batch(() => {
        setItems(next)
        setStatuses((current) => {
          const updated = { ...current }
          delete updated[target]
          return updated
        })
        if (active() === target && selected) select(selected)
        if (active() === target && !selected) setActive(undefined)
      })
    },
  } satisfies SessionTabsController

  const cycle = (direction: 1 | -1) => {
    const items = tabs()
    if (items.length === 0) return
    const index = items.findIndex((tab) => tab.sessionID === active())
    select(items[(index + direction + items.length) % items.length].sessionID)
  }
  const randomInactiveTab = () => {
    const candidates = tabs().filter((tab) => {
      const status = controller.status(tab.sessionID)
      return tab.sessionID !== active() && !status.busy && !status.unread && !status.attention
    })
    // Untitled sessions run first so their title arrival is easy to trigger.
    const untitled = candidates.filter((tab) => tab.title === undefined)
    const pool = untitled.length > 0 ? untitled : candidates
    return pool[Math.floor(Math.random() * pool.length)]
  }
  const selectedState = () => {
    const current = active()
    const status = current ? controller.status(current) : EMPTY_STATUS
    const activity = status.busy
      ? "running"
      : status.unread === "activity"
        ? "completed (unread)"
        : status.unread === "error"
          ? "failed (unread)"
          : "read"
    return status.attention ? `${activity} + needs input` : activity
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back home",
        group: "Scrap",
        run() {
          props.context.ui.router.navigate({ type: "home" })
        },
      },
      { bind: "left,h", title: "Previous tab", group: "Scrap", run: () => cycle(-1) },
      { bind: "right,l", title: "Next tab", group: "Scrap", run: () => cycle(1) },
      ...Array.from({ length: 10 }, (_, index) => ({
        bind: String((index + 1) % 10),
        title: `Select tab ${index + 1}`,
        group: "Scrap",
        run() {
          const tab = tabs()[index]
          if (tab) select(tab.sessionID)
        },
      })),
      {
        bind: "space",
        title: "Start a random tab",
        group: "Scrap",
        run() {
          const tab = randomInactiveTab()
          if (!tab) {
            setLastEvent("every tab is busy or unread; select tabs to read them, or press r")
            return
          }
          setStatuses((current) => ({
            ...current,
            [tab.sessionID]: { ...(current[tab.sessionID] ?? EMPTY_STATUS), busy: true, unread: undefined },
          }))
          setLastEvent(`tab ${number(tab.sessionID)} running`)
          runs.set(
            tab.sessionID,
            setTimeout(() => finishRun(tab.sessionID, false), RUN_DURATION),
          )
        },
      },
      {
        bind: "t",
        title: "Add tab",
        group: "Scrap",
        run() {
          const next = FIXTURE_TABS.find((fixture) => !tabs().some((tab) => tab.sessionID === fixture.sessionID))
          if (!next) {
            setLastEvent("all fixture tabs are open")
            return
          }
          setItems([...tabs().map((tab) => ({ ...tab })), { sessionID: next.sessionID }])
          select(next.sessionID)
          setLastEvent(`tab ${number(next.sessionID)} opened untitled; run it to earn its title`)
        },
      },
      { bind: "d", title: "Close tab", group: "Scrap", run: () => controller.close() },
      {
        bind: "r",
        title: "Reset",
        group: "Scrap",
        run() {
          runs.forEach(clearTimeout)
          runs.clear()
          batch(() => {
            setItems(FIXTURE_TABS.slice(0, 6).map((tab) => ({ ...tab })))
            setStatuses({})
            setActive("fixture-1")
          })
          setLastEvent("reset; press space to start a random tab")
        },
      },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.default}
    >
      <SessionTabs controller={controller} />
      <box
        height={1}
        flexShrink={0}
        backgroundColor={elevatedTheme.background.default}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
      >
        <text fg={elevatedTheme.text.subdued}>tab playground</text>
        <box flexGrow={1} />
        <text fg={elevatedTheme.text.subdued}>
          space run | t add | d close | r reset | ←/→ 1-0 move | drag reorders | esc home
        </text>
      </box>
      <box paddingTop={2} paddingLeft={2} flexDirection="column">
        <text fg={theme.text.default}>
          selected: {number(active() ?? "")} | state: {selectedState()}
        </text>
        <text fg={theme.text.default}>background: {lastEvent()}</text>
        <text fg={theme.text.subdued}>
          runs complete, fail, or request input; selecting a tab reads and resolves it
        </text>
      </box>
      <box flexGrow={1} />
    </box>
  )
}

export default Plugin.define({
  id: "opencode.scrap",
  setup(context) {
    context.ui.router.register({ name: "scrap", render: () => <Scrap context={context} /> })
    context.ui.slot("app", () => <Commands context={context} />)
  },
})
