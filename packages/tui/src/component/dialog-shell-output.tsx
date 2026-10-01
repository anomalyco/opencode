import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import {
  isMonitorNotFoundError,
  isShellNotFoundError,
  type LocationRef,
  type MonitorInfo,
  type ShellInfo,
} from "@opencode/client"
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import stripAnsi from "strip-ansi"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"

const PAGE_BYTES = 64 * 1024

export function DialogShellOutput(
  props:
    | { shell: ShellInfo; location: LocationRef; monitor?: never }
    | { monitor: MonitorInfo; shell?: never; location?: never },
) {
  const client = useClient()
  const data = useData()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  const [info, setInfo] = createSignal(props.shell)
  const monitor = () =>
    props.monitor &&
    (data.monitor.list(props.monitor.sessionID).find((item) => item.id === props.monitor.id) ?? props.monitor)
  const [output, setOutput] = createSignal<string>()
  const [omitted, setOmitted] = createSignal(false)
  const [error, setError] = createSignal("")
  const text = createMemo(() => stripAnsi(output() ?? "").replace(/\r\n?/g, "\n"))
  const height = () => Math.max(3, Math.floor(dimensions().height * 0.6) - 6)
  let scroll: ScrollBoxRenderable | undefined

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  createEffect(() => {
    // The running-shell inventory drops exited commands. Keep this view tied to
    // the opened ID and its original Location, not the list's current selection.
    const location = props.location && { directory: props.location.directory }
    const read = async (input: { cursor?: number; limit?: number }) => {
      if (props.monitor)
        return client.api.monitor.output({ sessionID: props.monitor.sessionID, id: props.monitor.id, ...input })
      const response = await client.api.shell.output({ id: props.shell.id, location, ...input })
      return response.data
    }
    let cursor: number | undefined
    let disposed = false
    let missing = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      if (props.shell && untrack(info)?.status === "running") {
        const current = await client.api.shell.get({ id: props.shell.id, location })
        if (disposed) return false
        setInfo(current.data)
      }
      if (cursor === undefined) {
        const head = await read({ cursor: Number.MAX_SAFE_INTEGER })
        if (disposed) return false
        cursor = Math.max(0, head.size - PAGE_BYTES)
        setOmitted(cursor > 0)
      }
      const page = await read({ cursor, limit: PAGE_BYTES })
      if (disposed) return false
      cursor = page.cursor
      setOutput((previous) => {
        const next = (previous ?? "") + page.output
        if (next.length > PAGE_BYTES) setOmitted(true)
        return next.slice(-PAGE_BYTES)
      })
      setError("")
      return cursor < page.size
    }

    const poll = () => {
      void load()
        .catch((cause: unknown) => {
          if (disposed) return
          missing = isShellNotFoundError(cause) || isMonitorNotFoundError(cause)
          setError(missing ? "Output is no longer available." : "Unable to read output. Retrying…")
        })
        .then((more) => {
          // Poll only while the viewer is open, including after exit so the final
          // file flush is observed. Never overlap reads or reload earlier pages.
          if (!disposed && !missing) timer = setTimeout(poll, more ? 0 : 1_000)
        })
    }
    poll()
    onCleanup(() => {
      disposed = true
      clearTimeout(timer)
    })
  })

  const status = () => {
    const current = monitor()
    if (current)
      return current.status === "running"
        ? "Running"
        : `Ended · ${current.reason?.replaceAll("_", " ") ?? "unknown"}${current.exitCode === undefined ? "" : ` · code ${current.exitCode}`}`
    const shell = info()
    if (shell?.status === "running") return "Running"
    if (shell?.status === "timeout") return "Timed out"
    if (shell?.status === "killed") return "Killed"
    return shell?.exit === undefined ? "Exited" : `Exited · code ${shell.exit}`
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "up", title: "Scroll output up", group: "Shell", run: () => scroll?.scrollBy(-1) },
      { bind: "down", title: "Scroll output down", group: "Shell", run: () => scroll?.scrollBy(1) },
      { bind: "pageup", title: "Previous output page", group: "Shell", run: () => scroll?.scrollBy(-height()) },
      { bind: "pagedown", title: "Next output page", group: "Shell", run: () => scroll?.scrollBy(height()) },
      { bind: "home", title: "First loaded output", group: "Shell", run: () => scroll?.scrollTo(0) },
      { bind: "end", title: "Follow shell output", group: "Shell", run: () => scroll?.scrollTo(Infinity) },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} flexGrow={1}>
          {props.monitor ? "Monitor output" : "Shell output"}
        </text>
        <text fg={theme.text.muted}>{status()}</text>
        <text fg={theme.text.muted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.text.muted} maxHeight={3} wrapMode="word">
        {props.monitor?.description ?? props.shell?.command}
      </text>
      <Show when={omitted()}>
        <text fg={theme.text.muted}>Earlier output omitted · showing recent output</text>
      </Show>
      <scrollbox
        id="shell-output-scroll"
        ref={(value: ScrollBoxRenderable) => (scroll = value)}
        height={height()}
        stickyScroll
        stickyStart="bottom"
        scrollbarOptions={{ visible: false }}
      >
        <text fg={theme.text.base} wrapMode="word">
          {text() ||
            (output() === undefined
              ? "Loading output…"
              : "No captured output. Output redirected to files is not shown here.")}
        </text>
      </scrollbox>
      <Show when={error()}>
        <text fg={theme.text.feedback.error.base}>{error()}</text>
      </Show>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <text fg={theme.text.muted}>↑/↓ scroll</text>
        <text fg={theme.text.muted}>end follow</text>
        <text fg={theme.text.muted}>esc back</text>
      </box>
    </box>
  )
}
