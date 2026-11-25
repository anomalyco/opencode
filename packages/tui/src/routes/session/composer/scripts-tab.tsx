import { createMemo, createSignal, For, Show, createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useData } from "../../../context/data"
import { useClient } from "../../../context/client"
import { useTheme } from "../../../context/theme"
import { Keymap } from "../../../context/keymap"
import { Locale } from "../../../util/locale"
import { scriptLabel } from "../../../util/session"
import { useComposerTab } from "./context"

export function ScriptsTab(props: { sessionID: string }) {
  const data = useData()
  const client = useClient()
  const theme = useTheme()
  const composer = useComposerTab()
  const shortcuts = Keymap.useShortcuts()

  // Scripts show for the main session only, like desktop.
  const runningScripts = createMemo(() =>
    data.session.get(props.sessionID)?.parentID
      ? []
      : data.job.list(props.sessionID).filter((job) => job.kind === "codemode" && job.sessionID === props.sessionID),
  )
  // Labels scan the transcript, so only while the tab shows.
  const entries = createMemo(() => {
    if (!composer.active("scripts")) return []
    const messages = data.session.message.list(props.sessionID)
    return runningScripts().map((job) => ({
      id: job.id,
      label: scriptLabel(messages, job),
      started: job.time.started,
    }))
  })

  const [store, setStore] = createStore({ selected: 0 })
  const [now, setNow] = createSignal(Date.now())
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    const count = runningScripts().length
    if (store.selected >= count) setStore("selected", Math.max(0, count - 1))
  })

  createEffect(() => {
    if (!composer.active("scripts")) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    if (!scroll || scroll.isDestroyed) return
    const target = scroll.getChildren()[store.selected]
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height || y < 0) {
      const center = Math.floor(scroll.height / 2)
      scroll.scrollBy(y - center)
    }
  })

  createEffect(
    on(
      () => runningScripts().length > 0,
      (running) => {
        if (!running) return
        onCleanup(
          composer.register({
            id: "scripts",
            label: "Scripts",
            hints: () =>
              runningScripts()[store.selected]
                ? [{ label: "cancel", shortcut: shortcuts.get("composer.script.cancel") ?? "" }]
                : [],
          }),
        )
      },
    ),
  )

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("scripts"),
    priority: 1,
    commands: [
      {
        id: "composer.script.up",
        title: "Previous script",
        group: "Composer",
        run() {
          if (store.selected === 0) {
            composer.close()
            return
          }
          setStore("selected", (prev) => prev - 1)
        },
      },
      {
        id: "composer.script.down",
        title: "Next script",
        group: "Composer",
        run() {
          const count = runningScripts().length
          if (count === 0) return
          setStore("selected", (prev) => (prev + 1) % count)
        },
      },
      {
        id: "composer.script.cancel",
        title: "Cancel script",
        group: "Composer",
        run() {
          const job = runningScripts()[store.selected]
          if (job) void client.api.experimental.job.cancel({ id: job.id })
        },
      },
    ],
  }))

  return (
    <Show when={composer.active("scripts")}>
      <scrollbox scrollbarOptions={{ visible: false }} maxHeight={5} ref={(r: ScrollBoxRenderable) => (scroll = r)}>
        <For each={entries()}>
          {(entry, index) => {
            const active = createMemo(() => index() === store.selected)
            const elapsed = createMemo(() => {
              const ms = Math.max(0, now() - entry.started)
              return ms < 60_000 ? `${Math.floor(ms / 1000)}s` : Locale.duration(ms)
            })
            return (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  active() ? theme.background.action.primary.focused : theme.background.action.primary.base
                }
                onMouseMove={() => setStore("selected", index())}
              >
                <box flexGrow={1} minWidth={0} flexDirection="row">
                  <text
                    fg={active() ? theme.text.action.primary.focused : theme.text.action.primary.base}
                    attributes={active() ? TextAttributes.BOLD : undefined}
                    wrapMode="none"
                    truncate
                  >
                    {entry.label}
                  </text>
                </box>
                <text
                  fg={active() ? theme.text.action.primary.focused : theme.text.muted}
                  wrapMode="none"
                  flexShrink={0}
                >
                  {elapsed()}
                </text>
              </box>
            )
          }}
        </For>
      </scrollbox>
    </Show>
  )
}
