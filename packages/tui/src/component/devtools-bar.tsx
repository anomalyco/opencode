import { CliRenderEvents, TextAttributes, type Renderable } from "@opentui/core"
import { TimeToFirstDraw, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { open } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type ParentProps } from "solid-js"
import { useClient } from "../context/client"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { Keymap } from "../context/keymap"
import { useTheme, useThemes } from "../context/theme"
import { DevTools } from "../devtools"
import { useDialog } from "../ui/dialog"
import { DialogExperiments } from "./dialog-experiments"
import { usePlugin } from "../plugin/context"
import { errorMessage } from "../util/error"

const graphWidth = 23
const sampleIntervalMilliseconds = 2_000
const sampleRetentionMilliseconds = 30_000
const statusWindowMilliseconds = 6_000
type Panel = "server" | "theme" | "tools" | "ui"
type ProcessSample = Readonly<{ cpu: number; memory: number; delay: number; time: number }>
export type RuntimeStatus = "normal" | "medium" | "high"

export function DevToolsBar() {
  const client = useClient()
  const config = useConfig()
  const dialog = useDialog()
  const data = useData()
  const location = useLocation()
  const route = useRoute()
  const plugins = usePlugin()
  const themes = useThemes()
  const keymap = Keymap.use()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const { current: theme, mode, supports, setMode } = themes
  const elevatedTheme = useTheme("elevated")
  const [panel, setPanel] = createSignal<Panel>()
  const [dumping, setDumping] = createSignal(false)
  const [dumpPath, setDumpPath] = createSignal<string>()
  const [dumpError, setDumpError] = createSignal<string>()
  const [frontendSamples, setFrontendSamples] = createSignal<readonly ProcessSample[]>([])
  const [debugOverlay, setDebugOverlay] = createSignal(renderer.debugOverlay.enabled)
  let focus: Renderable | null
  const connected = createMemo(() => client.connection.status() === "connected")
  const serverIndicator = createMemo(() => connectionIndicator(client.connection.status(), client.connection.attempt()))
  const themePerformance = createMemo(
    () => DevTools.data().find((group) => group.id === "theme-performance")?.entries ?? [],
  )
  const groups = createMemo(() => DevTools.data().filter((group) => group.id !== "theme-performance"))
  const [server] = createResource(connected, async () => {
    const [health, info] = await Promise.all([client.api.health.get(), client.api.server.get()])
    return {
      health,
      address: info.urls[0] ? new URL(info.urls[0]).host : "Unknown",
    }
  })
  const close = () => {
    setPanel()
    setTimeout(() => {
      if (panel() || !focus || focus.isDestroyed) return
      focus.focus()
      focus = null
    }, 1)
  }
  const toggle = (next: Panel) => {
    if (panel() === next) return close()
    if (!panel()) {
      focus = renderer.currentFocusedRenderable
      focus?.blur()
    }
    setPanel(next)
  }
  const nextMode = () => (mode() === "dark" ? "light" : "dark")
  const canSwitchMode = () => supports(nextMode())
  const runtime = createMemo(() => runtimeStatus(frontendSamples()))
  const timing = () => config.data.debug?.timing ?? false
  const turnTokens = () => config.data.debug?.turn_tokens ?? false
  const verboseTurnTokens = () => turnTokens() === "verbose"

  const offEscape = keymap.intercept(
    "key",
    ({ event }) => {
      if (!panel() || event.name !== "escape") return
      event.preventDefault()
      event.stopPropagation()
      close()
    },
    { priority: 10 },
  )
  onCleanup(offEscape)

  const onDebugOverlayToggle = (enabled: boolean) => setDebugOverlay(enabled)
  renderer.on(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, onDebugOverlayToggle)
  onCleanup(() => renderer.off(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, onDebugOverlayToggle))

  onMount(() => {
    const eventLoop = monitorEventLoopDelay({ resolution: 20 })
    let frontendCPU = process.cpuUsage()
    let frontendTime = performance.now()
    let frontendReady = false
    eventLoop.enable()
    const sample = () => {
      const now = performance.now()
      const cpu = process.cpuUsage(frontendCPU)
      frontendCPU = process.cpuUsage()
      setFrontendSamples((samples) =>
        [
          ...samples,
          {
            cpu: frontendReady ? cpuPercent(cpu.user + cpu.system, now - frontendTime) : 0,
            memory: process.memoryUsage().rss,
            delay: eventLoop.percentile(99) / 1_000_000,
            time: now,
          },
        ].filter((sample) => sample.time >= now - sampleRetentionMilliseconds),
      )
      eventLoop.reset()
      frontendReady = true
      frontendTime = now
    }
    sample()
    const timer = setInterval(sample, sampleIntervalMilliseconds)
    onCleanup(() => {
      clearInterval(timer)
      eventLoop.disable()
    })
  })

  async function dump() {
    setDumping(true)
    setDumpPath()
    setDumpError()
    const routeData = route.data
    const sessionID = routeData.type === "session" ? routeData.sessionID : undefined
    const info = sessionID ? data.session.get(sessionID) : undefined
    const sessionLocation =
      info?.location ??
      (location.current
        ? { directory: location.current.directory, workspaceID: location.current.workspaceID }
        : undefined)
    const details = server()
    const backend = {
      connected: connected(),
      version: details?.health.version,
      pid: details?.health.pid,
      error: client.connection.error(),
    }
    const events = await (sessionID
      ? (async () => {
          const events: { readonly created: number }[] = []
          for await (const event of client.api.session.log({ sessionID, follow: false })) {
            if (event.type !== "log.synced") events.push(event)
          }
          // Durable events stay in aggregate order even when their wall-clock timestamps differ.
          client.connection.internal.history().forEach((event) => {
            const index = events.findIndex((item) => item.created > event.created)
            if (index === -1) {
              events.push(event)
              return
            }
            events.splice(index, 0, event)
          })
          return events.slice(-100)
        })().catch(() => client.connection.internal.history())
      : Promise.resolve([]))
    const file = path.join(tmpdir(), `opencode-debug-${crypto.randomUUID()}.json`)
    const output =
      JSON.stringify(
        {
          backend,
          session: sessionID
            ? {
                ...info,
                id: sessionID,
                projectID: info?.projectID ?? location.current?.project.id,
                location: sessionLocation,
                status: data.session.status(sessionID),
                pending: data.session.pending.list(sessionID),
                inboxIDs: data.session.input.list(sessionID),
                permissions: data.session.permission.list(sessionID) ?? [],
                forms: data.session.form.list(sessionID) ?? [],
              }
            : undefined,
          events,
          mcp: {
            servers: sessionLocation
              ? (data.location.mcp.server.list(sessionLocation) ?? [])
              : (data.location.mcp.server.list() ?? []),
            resources: sessionLocation
              ? (data.location.mcp.resource.list(sessionLocation) ?? [])
              : (data.location.mcp.resource.list() ?? []),
          },
          plugins: {
            ready: plugins.ready(),
            list: plugins.list().map((plugin) => ({
              name: "id" in plugin ? plugin.id : plugin.target,
              ...plugin,
            })),
          },
          theme: {
            name: themes.selected,
            mode: themes.mode(),
          },
        },
        null,
        2,
      ) + "\n"
    await open(file, "wx", 0o600)
      .then((handle) => handle.writeFile(output).finally(() => handle.close()))
      .then(
        () => setDumpPath(file),
        (error) => setDumpError(errorMessage(error)),
      )
    setDumping(false)
  }

  return (
    <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.raise(theme.background.default)}>
      <Show when={panel()}>
        <box
          position="absolute"
          zIndex={2400}
          left={0}
          bottom={1}
          width={dimensions().width}
          height={Math.max(0, dimensions().height - 1)}
          backgroundColor="transparent"
          onMouseUp={close}
        />
      </Show>
      <BarItem active={panel() === "server"} onClick={() => toggle("server")}>
        <text
          fg={
            panel() === "server"
              ? theme.text.action.primary.focused
              : serverIndicator().state === "connected"
                ? theme.text.feedback.success.default
                : serverIndicator().state === "disconnected"
                  ? theme.text.feedback.error.default
                  : theme.text.default
          }
        >
          {serverIndicator().icon}
        </text>
        <text
          fg={
            panel() === "server"
              ? theme.text.action.primary.focused
              : serverIndicator().state === "disconnected"
                ? theme.text.feedback.error.default
                : theme.text.subdued
          }
        >
          {" "}
          Server
        </text>
        <Show when={panel() === "server"}>
          <PanelBox>
            <PanelTitle>Server</PanelTitle>
            <Row label="Status" value={connected() ? "Connected" : client.connection.status()} />
            <Show when={client.connection.attempt() > 0}>
              <Row label="Reconnect" value={String(client.connection.attempt())} />
            </Show>
            <Show when={client.connection.error()}>{(error) => <Row label="Last error" value={error()} />}</Show>
            <Show when={server()}>
              {(value) => (
                <>
                  <Row label="Version" value={value().health.version} />
                  <Row label="PID" value={String(value().health.pid)} />
                  <Row label="Address" value={value().address} />
                </>
              )}
            </Show>
            <Show when={server.error}>
              <text fg={elevatedTheme.text.feedback.error.default}>Server details unavailable</text>
            </Show>
          </PanelBox>
        </Show>
      </BarItem>
      <BarItem active={panel() === "ui"} onClick={() => toggle("ui")}>
        <text
          fg={
            panel() === "ui"
              ? theme.text.action.primary.focused
              : runtime() === "high"
                ? theme.text.feedback.error.default
                : theme.text.subdued
          }
        >
          {statusIcon(runtime())}
        </text>
        <text
          fg={
            panel() === "ui"
              ? theme.text.action.primary.focused
              : runtime() === "high"
                ? theme.text.feedback.error.default
                : theme.text.subdued
          }
        >
          {" "}
          UI
        </text>
        <Show when={panel() === "ui"}>
          <PanelBox>
            <PanelTitle>UI</PanelTitle>
            <Row label="Status" value={runtime()} />
            <ProcessStat
              label="Loop"
              values={frontendSamples().map((sample) => sample.delay)}
              unit=" ms"
              decimals={1}
            />
            <ProcessStat label="CPU" values={frontendSamples().map((sample) => sample.cpu)} unit="%" />
            <ProcessStat
              label="Memory"
              values={frontendSamples().map((sample) => sample.memory / 1024 / 1024)}
              unit=" MB"
              decimals={0}
            />
            <Action onClick={() => renderer.toggleDebugOverlay()} hoverBackground>
              {debugOverlay() ? "[x]" : "[ ]"} Debug overlay
            </Action>
          </PanelBox>
        </Show>
      </BarItem>
      <BarItem active={panel() === "theme"} onClick={() => toggle("theme")}>
        <text fg={panel() === "theme" ? theme.text.action.primary.focused : theme.text.subdued}>Theme</text>
        <Show when={panel() === "theme"}>
          <PanelBox>
            <PanelTitle>Theme</PanelTitle>
            <Row label="Name" value={themes.selected} />
            <Row label="Mode" value={mode()} />
            <For each={themePerformance()}>{(entry) => <Row label={entry.key} value={String(entry.value)} />}</For>
            <Show when={canSwitchMode()}>
              <Action onClick={() => setMode(nextMode())} hoverBackground>
                Switch to {nextMode()}
              </Action>
            </Show>
          </PanelBox>
        </Show>
      </BarItem>
      <BarItem active={panel() === "tools"} onClick={() => toggle("tools")}>
        <text fg={panel() === "tools" ? theme.text.action.primary.focused : theme.text.subdued}>Tools</text>
        <Show when={panel() === "tools"}>
          <PanelBox>
            <PanelTitle>Tools</PanelTitle>
            <Action onClick={() => void dump()} disabled={dumping()} hoverBackground>
              {dumping() ? "Writing debug snapshot..." : "Write debug snapshot"}
            </Action>
            <Show when={dumpPath()}>
              {(file) => (
                <text fg={elevatedTheme.text.subdued} wrapMode="word">
                  {file()}
                </text>
              )}
            </Show>
            <Show when={dumpError()}>
              {(error) => (
                <text fg={elevatedTheme.text.feedback.error.default} wrapMode="word">
                  {error()}
                </text>
              )}
            </Show>
            <box marginTop={1}>
              <text fg={elevatedTheme.text.default} attributes={TextAttributes.BOLD}>
                Render
              </text>
              <Action
                onClick={() =>
                  void config.update((draft) => {
                    draft.debug = { ...draft.debug, timing: !timing() }
                  })
                }
                hoverBackground
              >
                {timing() ? "[x]" : "[ ]"} Time to first draw
              </Action>
              <Action
                onClick={() =>
                  void config.update((draft) => {
                    draft.debug = { ...draft.debug, turn_tokens: !turnTokens() }
                  })
                }
                hoverBackground
              >
                {turnTokens() ? "[x]" : "[ ]"} Turn token usage
              </Action>
              <Show when={Boolean(turnTokens())}>
                <Action
                  onClick={() =>
                    void config.update((draft) => {
                      draft.debug = { ...draft.debug, turn_tokens: verboseTurnTokens() ? true : "verbose" }
                    })
                  }
                  hoverBackground
                >
                  {verboseTurnTokens() ? "[x]" : "[ ]"} Turn token usage (verbose)
                </Action>
              </Show>
            </box>
            <For each={groups()}>
              {(group) => (
                <box marginTop={1}>
                  <text fg={elevatedTheme.text.default} attributes={TextAttributes.BOLD}>
                    {group.title}
                  </text>
                  <For each={group.entries}>{(entry) => <Row label={entry.key} value={String(entry.value)} />}</For>
                </box>
              )}
            </For>
          </PanelBox>
        </Show>
      </BarItem>
      <BarItem
        active={false}
        onClick={() => {
          close()
          dialog.replace(() => <DialogExperiments />)
        }}
      >
        <text fg={theme.text.subdued}>Experiments</text>
      </BarItem>
      <box flexGrow={1} minWidth={0}>
        <TimeToFirstDraw visible={timing()} width="100%" fg={theme.text.subdued} label="Time to first draw" />
      </box>
    </box>
  )
}

function BarItem(props: ParentProps<{ active: boolean; onClick: () => void }>) {
  const theme = useTheme()
  const renderer = useRenderer()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      position="relative"
      zIndex={props.active ? 2500 : undefined}
      height={1}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.active
          ? theme.background.action.primary.focused
          : hovered()
            ? theme.background.action.primary.hovered
            : undefined
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick()
      }}
    >
      <box flexDirection="row">{props.children}</box>
    </box>
  )
}

function PanelBox(props: ParentProps) {
  const theme = useTheme("elevated")
  const renderer = useRenderer()
  return (
    <box
      position="absolute"
      zIndex={2600}
      bottom={1}
      left={-1}
      width={42}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.background.default}
      flexDirection="column"
      onMouseUp={(event) => {
        if (renderer.getSelection()?.getSelectedText()) return
        event.stopPropagation()
      }}
    >
      {props.children}
    </box>
  )
}

function PanelTitle(props: ParentProps) {
  const theme = useTheme("elevated")
  return (
    <text fg={theme.text.default} attributes={TextAttributes.BOLD} marginBottom={1}>
      {props.children}
    </text>
  )
}

function Row(props: { label: string; value: string }) {
  const theme = useTheme("elevated")
  return (
    <box flexDirection="row">
      <text fg={theme.text.subdued}>{props.label}</text>
      <box flexGrow={1} />
      <text fg={theme.text.default}>{props.value}</text>
    </box>
  )
}

function Action(props: ParentProps<{ onClick: () => void; disabled?: boolean; hoverBackground?: boolean }>) {
  const theme = useTheme("elevated")
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      backgroundColor={
        props.hoverBackground && hovered() && !props.disabled ? theme.background.action.primary.hovered : undefined
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (!props.disabled) props.onClick()
      }}
    >
      <text fg={props.disabled ? theme.text.subdued : theme.text.action.primary.default}>{props.children}</text>
    </box>
  )
}

function cpuPercent(microseconds: number, milliseconds: number) {
  if (milliseconds <= 0) return 0
  return Math.max(0, microseconds / (milliseconds * 10))
}

function ProcessStat(props: { label: string; values: readonly number[]; unit: string; decimals?: number }) {
  const theme = useTheme("elevated")
  const value = () => {
    const value = props.values.at(-1)
    if (value === undefined) return "--"
    return `${value.toFixed(props.decimals ?? 1)}${props.unit}`
  }
  return (
    <box flexDirection="row">
      <box width={7}>
        <text fg={theme.text.subdued}>{props.label}</text>
      </box>
      <box flexGrow={1}>
        <text fg={props.values.length ? theme.text.default : theme.text.subdued}>{brailleGraph(props.values)}</text>
      </box>
      <box width={8} alignItems="flex-end">
        <text fg={props.values.length ? theme.text.default : theme.text.subdued}>{value()}</text>
      </box>
    </box>
  )
}

export function runtimeStatus(samples: readonly Readonly<{ delay: number; time: number }>[]): RuntimeStatus {
  const latest = samples.at(-1)?.time
  if (latest === undefined) return "normal"
  const delay = Math.max(
    0,
    ...samples.filter((sample) => sample.time > latest - statusWindowMilliseconds).map((sample) => sample.delay),
  )
  if (delay >= 100) return "high"
  if (delay >= 20) return "medium"
  return "normal"
}

export function statusIcon(status: RuntimeStatus) {
  if (status === "high") return "●"
  if (status === "medium") return "⦿"
  return "○"
}

export function connectionIndicator(status: "connected" | "connecting" | "reconnecting", attempt: number) {
  if (status === "connected") return { state: "connected" as const, icon: "✓" }
  if (status === "reconnecting" && attempt >= 3) return { state: "disconnected" as const, icon: "×" }
  return { state: "reconnecting" as const, icon: "↻" }
}

export function brailleGraph(values: readonly number[], width = graphWidth) {
  const min = Math.min(...values)
  const range = Math.max(...values) - min
  const points = [...Array<number | undefined>(width * 2 - values.length).fill(values.at(0)), ...values].slice(
    -width * 2,
  )
  const dots = [
    [6, 2, 1, 0],
    [7, 5, 4, 3],
  ]
  return Array.from({ length: width }, (_, index) => {
    const bits = [points[index * 2], points[index * 2 + 1]].reduce<number>((result, value, column) => {
      if (value === undefined) return result
      const height = 1 + Math.round((range === 0 ? 0 : (value - min) / range) * 3)
      return dots[column].slice(0, height).reduce<number>((bits, dot) => bits | (1 << dot), result)
    }, 0)
    return String.fromCodePoint(0x2800 + bits)
  }).join("")
}
