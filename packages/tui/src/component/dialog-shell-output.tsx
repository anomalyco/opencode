import { useLanguage } from "../context/language"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { isShellNotFoundError, type LocationRef, type ShellInfo } from "@opencode/client"
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import stripAnsi from "strip-ansi"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"

const PAGE_BYTES = 64 * 1024

export function DialogShellOutput(props: { shell: ShellInfo; location: LocationRef }) {
  const client = useClient()
  const dialog = useDialog()
  const language = useLanguage()
  const theme = useTheme("elevated")
  const dimensions = useTerminalDimensions()
  const [info, setInfo] = createSignal(props.shell)
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
    const id = props.shell.id
    const location = { directory: props.location.directory, workspace: props.location.workspaceID }
    let cursor: number | undefined
    let disposed = false
    let missing = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      if (untrack(info).status === "running") {
        const current = await client.api.shell.get({ id, location })
        if (disposed) return false
        setInfo(current.data)
      }
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
        const next = (previous ?? "") + page.data.output
        if (next.length > PAGE_BYTES) setOmitted(true)
        return next.slice(-PAGE_BYTES)
      })
      setError("")
      return cursor < page.data.size
    }

    const poll = () => {
      void load()
        .catch((cause: unknown) => {
          if (disposed) return
          missing = isShellNotFoundError(cause)
          setError(language.t(missing ? "tui.dialogs.shellOutputUnavailable" : "tui.dialogs.shellOutputRetry"))
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
    if (info().status === "running") return language.t("tui.transcript.running")
    if (info().status === "timeout") return language.t("tui.dialogs.timedOut")
    if (info().status === "killed") return language.t("tui.dialogs.killed")
    return info().exit === undefined
      ? language.t("tui.dialogs.exited")
      : language.t("tui.dialogs.exitCode", { code: info().exit! })
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "up",
        title: language.t("tui.details.scrollOutputUp"),
        group: language.t("tui.details.shell"),
        run: () => scroll?.scrollBy(-1),
      },
      {
        bind: "down",
        title: language.t("tui.details.scrollOutputDown"),
        group: language.t("tui.details.shell"),
        run: () => scroll?.scrollBy(1),
      },
      {
        bind: "pageup",
        title: language.t("tui.details.previousOutputPage"),
        group: language.t("tui.details.shell"),
        run: () => scroll?.scrollBy(-height()),
      },
      {
        bind: "pagedown",
        title: language.t("tui.details.nextOutputPage"),
        group: language.t("tui.details.shell"),
        run: () => scroll?.scrollBy(height()),
      },
      {
        bind: "home",
        title: language.t("tui.details.firstLoadedOutput"),
        group: language.t("tui.details.shell"),
        run: () => scroll?.scrollTo(0),
      },
      {
        bind: "end",
        title: language.t("tui.details.followShellOutput"),
        group: language.t("tui.details.shell"),
        run: () => scroll?.scrollTo(Infinity),
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.default} attributes={TextAttributes.BOLD} flexGrow={1}>
          {language.t("tui.dialogs.shellOutput")}
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
        <text fg={theme.text.subdued}>{language.t("tui.details.earlierOutputOmittedShowingRecentOutput")}</text>
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
            (output() === undefined
              ? language.t("tui.dialogs.loadingOutput")
              : language.t("tui.dialogs.noCapturedOutput"))}
        </text>
      </scrollbox>
      <Show when={error()}>
        <text fg={theme.text.feedback.error.default}>{error()}</text>
      </Show>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <text fg={theme.text.subdued}>{language.t("tui.details.scroll")}</text>
        <text fg={theme.text.subdued}>{language.t("tui.details.endFollow")}</text>
        <text fg={theme.text.subdued}>{language.t("tui.details.escBack")}</text>
      </box>
    </box>
  )
}
