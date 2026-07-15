import { createMemo, For, Show, createEffect, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useData } from "../../../context/data"
import { useLocation } from "../../../context/location"
import { useClient } from "../../../context/client"
import { useTheme } from "../../../context/theme"
import { Keymap } from "../../../context/keymap"
import { useComposerTab } from "./index"

export function ShellTab(props: { sessionID: string }) {
  const data = useData()
  const location = useLocation()
  const client = useClient()
  const { themeV2 } = useTheme()
  const fg = themeV2.text.action.primary("focused")
  const composer = useComposerTab()
  const shortcuts = Keymap.useShortcuts()

  const entries = createMemo(() =>
    data.shell.list().filter((shell) => shell.metadata.sessionID === props.sessionID && shell.status === "running"),
  )

  const [store, setStore] = createStore({ selected: 0 })
  let scroll: ScrollBoxRenderable | undefined

  const selectedEntry = createMemo(() => entries()[store.selected])

  createEffect(() => {
    if (store.selected >= entries().length) setStore("selected", Math.max(0, entries().length - 1))
  })

  createEffect(() => {
    if (!scroll) return
    const target = scroll.getChildren()[store.selected]
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height || y < 0) {
      const center = Math.floor(scroll.height / 2)
      scroll.scrollBy(y - center)
    }
  })

  onMount(() => {
    const cleanup = composer.register({
      id: "shell",
      label: "Shell",
      hints: () => (selectedEntry() ? [{ label: "kill", shortcut: shortcuts.get("composer.shell.kill") ?? "" }] : []),
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("shell"),
    commands: [
      {
        id: "composer.shell.up",
        title: "Previous shell",
        group: "Composer",
        bind: "up",
        run() {
          const list = entries()
          if (list.length === 0) return
          setStore("selected", (prev) => (prev - 1 + list.length) % list.length)
        },
      },
      {
        id: "composer.shell.down",
        title: "Next shell",
        group: "Composer",
        bind: "down",
        run() {
          const list = entries()
          if (list.length === 0) return
          setStore("selected", (prev) => (prev + 1) % list.length)
        },
      },
      {
        id: "composer.shell.kill",
        title: "Kill shell command",
        group: "Composer",
        bind: "ctrl+d",
        run() {
          const entry = selectedEntry()
          if (!entry) return
          const ref = location.current
          void client.api.shell.remove({
            id: entry.id,
            location: ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined,
          })
        },
      },
    ],
  }))

  return (
    <Show when={composer.active("shell")}>
      <scrollbox
        scrollbarOptions={{ visible: false }}
        maxHeight={5}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
      >
        <Show when={entries().length > 0} fallback={<text fg={themeV2.text.subdued()}> No shell commands</text>}>
          <For each={entries()}>
            {(shell, index) => {
              const active = createMemo(() => index() === store.selected)
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active() ? themeV2.background.action.primary() : RGBA.fromInts(0, 0, 0, 0)}
                  onMouseOver={() => setStore("selected", index())}
                >
                  <text
                    fg={active() ? fg : themeV2.text()}
                    attributes={active() ? TextAttributes.BOLD : undefined}
                    wrapMode="none"
                  >
                    {shell.command}
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
    </Show>
  )
}
