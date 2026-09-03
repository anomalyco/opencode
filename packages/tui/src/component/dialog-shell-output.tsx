import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { isShellNotFoundError, type LocationRef, type ShellInfo } from "@opencode-ai/client"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import stripAnsi from "strip-ansi"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"

const PAGE_BYTES = 64 * 1024

export function DialogShellOutput(props: { shell: ShellInfo; location: LocationRef }) {
  const client = useClient()
  const dialog = useDialog()
  const theme = useTheme("elevated")
  const dimensions = useTerminalDimensions()
  const [info, setInfo] = createSignal(props.shell)
  const [output, setOutput] = createSignal("")
  const [loaded, setLoaded] = createSignal(false)
  const [omitted, setOmitted] = createSignal(false)
  const [error, setError] = createSignal("")
  const text = createMemo(() => stripAnsi(output()).replace(/\r\n?/g, "\n"))
  const height = () => Math.max(3, Math.floor(dimensions().height * 0.6) - 6)
  let scroll: ScrollBoxRenderable | undefined

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  createEffect(() => {
    // The running-shell inventory drops exited commands. Keep this view tied to
    // the opened ID and its original Location, not the list's current selection.
    const id = props.shell.id
    const location = { directory: props.location.directory, workspace: props.location.workspaceID }
    let cursor: number | undefined
    let disposed = false
    let missing = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      const current = await client.api.shell.get({ id, location })
      if (disposed) return false
      setInfo(current.data)
      if (cursor === undefined) {
        const head = await client.api.shell.output({ id, location, cursor: Number.MAX_SAFE_INTEGER })
        if (disposed) return false
        cursor = Math.max(0, head.data.size - PAGE_BYTES)
        setOmitted(cursor > 0)
      }
      const page = await client.api.shell.output({ id, location, cursor, limit: PAGE_BYTES })
      if (disposed) return false
      cursor = page.data.cursor
      setOutput((previous) => {
        const next = previous + page.data.output
        if (next.length > PAGE_BYTES) setOmitted(true)
        return next.slice(-PAGE_BYTES)
      })
      setLoaded(true)
      setError("")
      return cursor < page.data.size
    }

    const poll = () => {
      void load()
        .catch((cause: unknown) => {
          if (disposed) return
          missing = isShellNotFoundError(cause)
          setError(missing ? "Shell output is no longer available." : "Unable to read shell output. Retrying…")
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
    if (info().status === "running") return "Running"
    if (info().status === "timeout") return "Timed out"
    if (info().status === "killed") return "Killed"
    return info().exit === undefined ? "Exited" : `Exited · code ${info().exit}`
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
        <text fg={theme.text.default} attributes={TextAttributes.BOLD} flexGrow={1}>
          Shell output
        </text>
        <text fg={theme.text.subdued}>{status()}</text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.text.subdued} maxHeight={3} wrapMode="word">
        {props.shell.command}
      </text>
      <Show when={omitted()}>
        <text fg={theme.text.subdued}>Earlier output omitted · showing recent output</text>
      </Show>
      <scrollbox
        id="shell-output-scroll"
        ref={(value: ScrollBoxRenderable) => (scroll = value)}
        height={height()}
        stickyScroll
        stickyStart="bottom"
        scrollbarOptions={{ visible: false }}
      >
        <text fg={theme.text.default} wrapMode="word">
          {text() ||
            (loaded() ? "No captured output. Output redirected to files is not shown here." : "Loading output…")}
        </text>
      </scrollbox>
      <Show when={error()}>
        <text fg={theme.text.feedback.error.default}>{error()}</text>
      </Show>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <text fg={theme.text.subdued}>↑/↓ scroll</text>
        <text fg={theme.text.subdued}>end follow</text>
        <text fg={theme.text.subdued}>esc back</text>
      </box>
    </box>
  )
}
