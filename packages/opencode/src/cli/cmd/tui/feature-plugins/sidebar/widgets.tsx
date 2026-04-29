import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { PetWidget } from "./pet"
import { SpectrumWidget } from "./spectrum"

const id = "internal:sidebar-widgets"

// ============================================================================
// Clock Widget
// ============================================================================

function ClockWidget(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [time, setTime] = createSignal(new Date())

  const timer = setInterval(() => setTime(new Date()), 1000)
  onCleanup(() => clearInterval(timer))

  const timeStr = createMemo(() => {
    void time()
    return time().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  })

  const dateStr = createMemo(() => {
    void time()
    return time().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
  })

  return (
    <box>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme().text} bold>Time</text>
      </box>
      <text fg={theme().text}>{timeStr()}</text>
      <text fg={theme().textMuted}>{dateStr()}</text>
    </box>
  )
}

// ============================================================================
// Session Stats Widget
// ============================================================================

function SessionStatsWidget(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [tick, setTick] = createSignal(0)

  const timer = setInterval(() => setTick((t) => t + 1), 2000)
  onCleanup(() => clearInterval(timer))

  const sessionCount = createMemo(() => {
    void tick()
    return props.api.state.session.count()
  })

  const msgCount = createMemo(() => {
    void tick()
    return props.api.state.session.messages(props.session_id).length
  })

  const providerCount = createMemo(() => {
    void tick()
    return props.api.state.provider.length
  })

  return (
    <box>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme().text} bold>Stats</text>
      </box>
      <text fg={theme().textMuted}>Sessions: {sessionCount()}</text>
      <text fg={theme().textMuted}>Messages: {msgCount()}</text>
      <text fg={theme().textMuted}>Providers: {providerCount()}</text>
    </box>
  )
}

// ============================================================================
// Welcome Banner
// ============================================================================

function WelcomeBanner(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((t) => t + 1), 5000)
  onCleanup(() => clearInterval(timer))

  const sessionCount = createMemo(() => {
    void tick()
    return props.api.state.session.count()
  })

  return (
    <box gap={1}>
      <text fg={theme().accent} bold>🐱 Terminal Pet Companion</text>
      <text fg={theme().textMuted}>Sessions: {sessionCount()} | Tab to switch modes</text>
    </box>
  )
}

// ============================================================================
// Widget Container
// ============================================================================

function SidebarWidgets(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [audioLevel, setAudioLevel] = createSignal(0)

  return (
    <box gap={2}>
      <box backgroundColor={theme().backgroundElement} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" gap={3}>
        <ClockWidget api={props.api} />
      </box>
      <SpectrumWidget api={props.api} onLevel={setAudioLevel} />
      <PetWidget api={props.api} session_id={props.session_id} audioLevel={audioLevel()} />
      <SessionStatsWidget api={props.api} session_id={props.session_id} />
    </box>
  )
}

// ============================================================================
// Plugin Registration
// ============================================================================

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        return <SidebarWidgets api={api} session_id={props.session_id} />
      },
    },
  })

  api.slots.register({
    order: 50,
    slots: {
      home_bottom(_ctx) {
        return <WelcomeBanner api={api} />
      },
    },
  })

  api.command.register(() => [
    {
      title: "Toggle Pet Widget",
      value: "pet.toggle",
      description: "Toggle terminal pet companion",
      category: "Demo",
      onSelect() {
        const current = api.kv.get("pet_visible", true)
        api.kv.set("pet_visible", !current)
        api.ui.toast({ variant: "info", message: `Pet widget ${!current ? "shown" : "hidden"}` })
      },
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
