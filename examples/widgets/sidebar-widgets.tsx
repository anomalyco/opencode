/**
 * OpenCode UI Widget Plugin Example
 *
 * This plugin demonstrates how to add custom widgets to OpenCode's TUI interface
 * using the built-in slot extension system.
 *
 * Available Slots:
 * - sidebar_content: Main session sidebar content area
 * - sidebar_footer: Bottom of the session sidebar
 * - home_bottom: Below the home prompt
 * - home_footer: Bottom of the home page
 * - home_logo: Replace the OpenCode logo
 * - home_prompt: Replace the prompt input
 *
 * Features:
 * - Pet widget: A virtual pet companion in the sidebar
 * - Stats widget: Live token/session statistics
 * - Clock widget: Current time display
 */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"

// ============================================================================
// Pet Widget - A virtual companion in the sidebar
// ============================================================================

const petStates = [" Sleeping ", " Owo   ", " Hungry! ", " Happy~ ", " Playing "] as const
const petEmojis = ["  ◕‿◕  ", "  =^..^=", "  @.@   ", "  ^‿^   ", "  ^ↀ‿ↀ^ "] as const

function PetWidget(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [petIndex, setPetIndex] = createSignal(0)
  const [lastUpdate, setLastUpdate] = createSignal(Date.now())

  // Update pet state every 10 seconds
  const interval = setInterval(() => {
    setPetIndex((i) => (i + 1) % petStates.length)
    setLastUpdate(Date.now())
  }, 10000)

  onCleanup(() => clearInterval(interval))

  const mood = createMemo(() => {
    void lastUpdate() // Force reactivity
    return petStates[petIndex()]
  })

  const emoji = createMemo(() => {
    void lastUpdate()
    return petEmojis[petIndex()]
  })

  return (
    <box>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme().text} bold>
          Pet
        </text>
      </box>
      <text fg={theme().accent}>{emoji()}</text>
      <text fg={theme().textMuted}>{mood()}</text>
    </box>
  )
}

// ============================================================================
// Stats Widget - Live session statistics
// ============================================================================

function StatsWidget(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [tick, setTick] = createSignal(0)

  // Refresh every second
  const interval = setInterval(() => setTick((t) => t + 1), 1000)
  onCleanup(() => clearInterval(interval))

  const sessionCount = createMemo(() => {
    void tick()
    return props.api.state.session.count()
  })

  const messages = createMemo(() => {
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
        <text fg={theme().text} bold>
          Stats
        </text>
      </box>
      <text fg={theme().textMuted}>Sessions: {sessionCount()}</text>
      <text fg={theme().textMuted}>Messages: {messages()}</text>
      <text fg={theme().textMuted}>Providers: {providerCount()}</text>
    </box>
  )
}

// ============================================================================
// Clock Widget - Current time display
// ============================================================================

function ClockWidget(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [time, setTime] = createSignal(new Date())

  const interval = setInterval(() => setTime(new Date()), 1000)
  onCleanup(() => clearInterval(interval))

  const timeStr = createMemo(() => {
    void time()
    const t = time()
    return t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  })

  const dateStr = createMemo(() => {
    void time()
    const t = time()
    return t.toLocaleDateString([], { month: "short", day: "numeric" })
  })

  return (
    <box>
      <text fg={theme().text}>{timeStr()}</text>
      <text fg={theme().textMuted}>{dateStr()}</text>
    </box>
  )
}

// ============================================================================
// Weather Widget - External data example
// ============================================================================

function WeatherWidget(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [weather] = createSignal({ temp: 24, condition: "Sunny", icon: " ☀️ " })
  const w = weather

  return (
    <box>
      <text fg={theme().accent}>{w().icon}</text>
      <text fg={theme().text}>{w().temp}°C</text>
      <text fg={theme().textMuted}>{w().condition}</text>
    </box>
  )
}

// ============================================================================
// Sidebar Widget Container
// ============================================================================

function SidebarWidgets(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current

  return (
    <box gap={2}>
      <box
        backgroundColor={theme().backgroundElement}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={3}
      >
        <WeatherWidget api={props.api} />
        <ClockWidget api={props.api} />
      </box>
      <box gap={1}>
        <PetWidget api={props.api} session_id={props.session_id} />
      </box>
      <StatsWidget api={props.api} session_id={props.session_id} />
    </box>
  )
}

// ============================================================================
// Home Page Widget - Welcome banner
// ============================================================================

function WelcomeWidget(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [count, setCount] = createSignal(0)

  const sessionCount = createMemo(() => {
    const c = props.api.state.session.count()
    return c
  })

  const hasProviders = createMemo(() => {
    return props.api.state.provider.some(
      (p) => p.id !== "opencode" || Object.values(p.models).some((m) => m.cost?.input !== 0),
    )
  })

  return (
    <box gap={1}>
      <text fg={theme().accent} bold>
        Welcome to OpenCode!
      </text>
      <text fg={theme().textMuted}>
        <Show when={!hasProviders()} fallback={`${sessionCount()} active sessions`}>
          Connect a provider to get started
        </Show>
      </text>
      <text fg={theme().textMuted}>Press Tab to switch between Plan and Build mode</text>
    </box>
  )
}

// ============================================================================
// Plugin Registration
// ============================================================================

const widgetsPlugin: TuiPlugin = async (api) => {
  // Register sidebar widgets (session page)
  api.slots.register({
    order: 50, // Lower order = rendered first
    slots: {
      sidebar_content(_ctx, props) {
        return <SidebarWidgets api={api} session_id={props.session_id} />
      },
    },
  })

  // Register home page welcome widget
  api.slots.register({
    order: 50,
    slots: {
      home_bottom(_ctx) {
        return <WelcomeWidget api={api} />
      },
    },
  })

  // Register custom command to toggle widgets
  api.command.register(() => [
    {
      title: "Toggle Widget Demo",
      value: "widgets.toggle",
      category: "Demo",
      onSelect() {
        const current = api.kv.get("widgets_visible", true)
        api.kv.set("widgets_visible", !current)
        api.ui.toast({
          variant: "info",
          message: `Widgets ${!current ? "enabled" : "disabled"}`,
        })
      },
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id: "example:ui-widgets",
  tui: widgetsPlugin,
}

export default plugin
