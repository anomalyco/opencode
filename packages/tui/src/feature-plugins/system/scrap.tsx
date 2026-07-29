import { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createSignal } from "solid-js"
import { SessionTabs, type SessionTabsController } from "../../component/session-tabs"
import { moveSessionTab, type SessionTab } from "../../context/session-tabs-model"

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
  const [tabs, setTabs] = createSignal<SessionTab[]>(FIXTURE_TABS.slice(0, 6))
  const [active, setActive] = createSignal<string | undefined>("fixture-2")
  const [animations, setAnimations] = createSignal(true)
  const [statuses, setStatuses] = createSignal<Record<string, FixtureStatus>>({
    "fixture-2": { ...EMPTY_STATUS, busy: true },
    "fixture-3": { ...EMPTY_STATUS, unread: "activity" },
    "fixture-4": { ...EMPTY_STATUS, unread: "error" },
    "fixture-5": { ...EMPTY_STATUS, attention: true },
    "fixture-6": { ...EMPTY_STATUS, busy: true, attention: true },
  })
  const controller = {
    tabs,
    current: active,
    status(sessionID) {
      return statuses()[sessionID] ?? EMPTY_STATUS
    },
    move(sessionID, index) {
      setTabs((current) => moveSessionTab(current, sessionID, index))
    },
    select(sessionID) {
      setActive(sessionID)
    },
    close(sessionID?: string) {
      const target = sessionID ?? active()
      if (!target) return
      const items = tabs()
      const index = items.findIndex((tab) => tab.sessionID === target)
      if (index === -1) return
      const next = items.filter((tab) => tab.sessionID !== target)
      batch(() => {
        setTabs(next)
        if (active() === target) setActive(next[index]?.sessionID ?? next[index - 1]?.sessionID)
      })
    },
  } satisfies SessionTabsController

  const cycle = (direction: 1 | -1) => {
    const items = tabs()
    if (items.length === 0) return
    const index = items.findIndex((tab) => tab.sessionID === active())
    controller.select(items[(index + direction + items.length) % items.length].sessionID)
  }
  const updateStatus = (update: (status: FixtureStatus) => FixtureStatus) => {
    const sessionID = active()
    if (!sessionID) return
    setStatuses((current) => ({ ...current, [sessionID]: update(current[sessionID] ?? EMPTY_STATUS) }))
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
      { bind: "h", title: "Previous tab", group: "Scrap", run: () => cycle(-1) },
      { bind: "l", title: "Next tab", group: "Scrap", run: () => cycle(1) },
      {
        bind: "t",
        title: "Add tab",
        group: "Scrap",
        run() {
          const next = FIXTURE_TABS.find((fixture) => !tabs().some((tab) => tab.sessionID === fixture.sessionID))
          if (next) setTabs((current) => [...current, next])
        },
      },
      { bind: "d", title: "Close tab", group: "Scrap", run: () => controller.close() },
      {
        bind: "b",
        title: "Toggle busy",
        group: "Scrap",
        run: () =>
          updateStatus((status) =>
            status.busy ? { ...status, busy: false, unread: "activity" } : { ...status, busy: true, unread: undefined },
          ),
      },
      {
        bind: "u",
        title: "Cycle unread",
        group: "Scrap",
        run: () =>
          updateStatus((status) => ({
            ...status,
            unread: status.unread === undefined ? "activity" : status.unread === "activity" ? "error" : undefined,
          })),
      },
      {
        bind: "a",
        title: "Toggle attention",
        group: "Scrap",
        run: () => updateStatus((status) => ({ ...status, attention: !status.attention })),
      },
      {
        bind: "m",
        title: "Toggle motion",
        group: "Scrap",
        run: () => setAnimations((enabled) => !enabled),
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
      <SessionTabs controller={controller} animations={animations()} />
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
          h/l select | t add | d close | b busy | u unread | a attention | m motion | esc home
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
