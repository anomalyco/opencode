import { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createSignal, For, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { SessionTabs, type SessionTabsController } from "../../../component/session-tabs"
import { moveSessionTab } from "../../../context/session-tabs-model"
import type { Story } from "./index"

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

const EMPTY_STATUS: FixtureStatus = { unread: undefined, promptPulse: 0, attention: false, busy: false }
const RUN_DURATION = 1_800
const RESUME_DURATION = 900

// Plausible targets for the fake transcript's tool calls, picked per fixture index.
const TRANSCRIPT_FILES = [
  "packages/tui/src/component/session-tabs.tsx",
  "packages/tui/src/component/tab-pulse.tsx",
  "packages/tui/src/context/session-tabs-model.ts",
  "packages/core/src/session/runner.ts",
  "packages/server/src/routes/session.ts",
  "packages/tui/src/ui/animation.ts",
]

function SessionTabsStory(props: { context: Plugin.Context }) {
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
  // Unread clears on select, so the transcript remembers how each session's last run ended.
  const [outcomes, setOutcomes] = createSignal<Record<string, "completed" | "failed">>({})
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
      setOutcomes((current) => ({ ...current, [sessionID]: failed ? "failed" : "completed" }))
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
  const startRun = (sessionID: string) => {
    setStatuses((current) => ({
      ...current,
      [sessionID]: { ...(current[sessionID] ?? EMPTY_STATUS), busy: true, unread: undefined },
    }))
    setOutcomes((current) => {
      const next = { ...current }
      delete next[sessionID]
      return next
    })
    setLastEvent(`tab ${number(sessionID)} running`)
    runs.set(
      sessionID,
      setTimeout(() => finishRun(sessionID, false), RUN_DURATION),
    )
  }
  const randomInactiveTab = () => {
    const candidates = tabs().filter((tab) => {
      const status = controller.status(tab.sessionID)
      return !status.busy && !status.unread && !status.attention
    })
    // Untitled sessions run first so their title arrival is easy to trigger.
    const untitled = candidates.filter((tab) => tab.title === undefined)
    const pool = untitled.length > 0 ? untitled : candidates
    return pool[Math.floor(Math.random() * pool.length)]
  }
  // A fake transcript for the selected session so tab switches feel like moving between real
  // sessions; the tail line tracks the live status of the current run.
  const transcript = () => {
    const current = active()
    if (!current) return [{ text: "no session selected", color: theme.text.subdued }]
    const index = Math.max(
      0,
      FIXTURE_TABS.findIndex((fixture) => fixture.sessionID === current),
    )
    const fixture = FIXTURE_TABS[index]
    const status = controller.status(current)
    const outcome = outcomes()[current]
    const file = TRANSCRIPT_FILES[index % TRANSCRIPT_FILES.length]
    const lines = [
      { text: `> ${fixture.title}`, color: theme.text.default },
      { text: "", color: theme.text.default },
    ]
    if (!status.busy && outcome === undefined) {
      lines.push({ text: "no activity yet — press s to run this session", color: theme.text.subdued })
      return lines
    }
    lines.push(
      { text: "● Taking a look — reading the relevant code first.", color: theme.text.default },
      { text: "", color: theme.text.default },
      { text: `  ✱ Read ${file}`, color: theme.text.subdued },
      { text: `  ✱ Edit ${file}`, color: theme.text.subdued },
      { text: `  ✱ Bash bun run test`, color: theme.text.subdued },
      { text: "", color: theme.text.default },
    )
    if (status.attention)
      lines.push({
        text: "⚠ Permission required: Bash `bun run test` — select this tab to approve",
        color: theme.text.feedback.warning.default,
      })
    else if (status.busy) lines.push({ text: "● Working…", color: theme.text.subdued })
    else if (outcome === "failed")
      lines.push({
        text: `✗ bun run test failed — 3 tests failing in ${file}`,
        color: theme.text.feedback.error.default,
      })
    else
      lines.push({
        text: `✓ Done — updated ${file} and the tests pass.`,
        color: theme.text.feedback.success.default,
      })
    return lines
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
        title: "Back to storybook",
        group: "Storybook",
        run() {
          props.context.ui.router.navigate({ type: "plugin", name: "storybook" })
        },
      },
      { bind: "left,h", title: "Previous tab", group: "Storybook", run: () => cycle(-1) },
      { bind: "right,l", title: "Next tab", group: "Storybook", run: () => cycle(1) },
      ...Array.from({ length: 10 }, (_, index) => ({
        bind: String((index + 1) % 10),
        title: `Select tab ${index + 1}`,
        group: "Storybook",
        run() {
          const tab = tabs()[index]
          if (tab) select(tab.sessionID)
        },
      })),
      {
        bind: "space",
        title: "Start a random tab",
        group: "Storybook",
        run() {
          const tab = randomInactiveTab()
          if (!tab) {
            setLastEvent("every tab is busy or unread; select tabs to read them, or press r")
            return
          }
          startRun(tab.sessionID)
        },
      },
      {
        // Random runs stay off the selected tab, so this is the way to watch the edge flash
        // and running sweep under the cursor.
        bind: "s",
        title: "Run selected tab",
        group: "Storybook",
        run() {
          const current = active()
          if (!current) return
          if (controller.status(current).busy) {
            setLastEvent(`tab ${number(current)} is already running`)
            return
          }
          startRun(current)
        },
      },
      {
        bind: "t",
        title: "Add tab",
        group: "Storybook",
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
      { bind: "d", title: "Close tab", group: "Storybook", run: () => controller.close() },
      {
        bind: "r",
        title: "Reset",
        group: "Storybook",
        run() {
          runs.forEach(clearTimeout)
          runs.clear()
          batch(() => {
            setItems(FIXTURE_TABS.slice(0, 6).map((tab) => ({ ...tab })))
            setStatuses({})
            setOutcomes({})
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
      <box height={1} />
      <box flexGrow={1} paddingLeft={2} paddingRight={2} flexDirection="column">
        <For each={transcript()}>
          {(line) => (
            <text fg={line.color} wrapMode="none" selectable={false}>
              {line.text || " "}
            </text>
          )}
        </For>
      </box>
      <box paddingLeft={2} flexDirection="column">
        <text fg={theme.text.subdued}>
          selected: {number(active() ?? "")} | state: {selectedState()}
        </text>
        <text fg={theme.text.subdued}>background: {lastEvent()}</text>
      </box>
      <box
        height={1}
        flexShrink={0}
        backgroundColor={elevatedTheme.background.default}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
      >
        <text fg={elevatedTheme.text.subdued}>storybook / session tabs</text>
        <box flexGrow={1} />
        <text fg={elevatedTheme.text.subdued}>
          space/s run | t add | d close | r reset | ←/→ 1-0 move | drag reorders | esc back
        </text>
      </box>
    </box>
  )
}

export const sessionTabsStory: Story = {
  id: "session-tabs",
  title: "Session tabs",
  render: (context) => <SessionTabsStory context={context} />,
}
