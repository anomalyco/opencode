import { createMemo, For, Show, createEffect, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useData } from "../../../context/data"
import { useTheme, selectedForeground } from "../../../context/theme"
import { useBindings, useCommandShortcut } from "../../../keymap"
import { useComposerTab } from "./index"

export function ShellTab(props: { sessionID: string }) {
  const data = useData()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)
  const composer = useComposerTab()
  const killHint = useCommandShortcut("composer.shell.kill")
  const backgroundHint = useCommandShortcut("composer.background")

  const entries = createMemo(() =>
    data.shell
      .list()
      .filter((shell) => shell.metadata.sessionID === props.sessionID && shell.status === "running"),
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
      hints: () =>
        selectedEntry()
          ? [
              { label: "kill", shortcut: killHint() },
              { label: "background", shortcut: backgroundHint() },
            ]
          : [],
    })
    onCleanup(cleanup)
  })

  useBindings(() => ({
    mode: "composer",
    enabled: () => composer.active("shell"),
    commands: [
      {
        name: "composer.shell.up",
        title: "Previous shell",
        category: "Composer",
        run() {
          const list = entries()
          if (list.length === 0) return
          setStore("selected", (prev) => (prev - 1 + list.length) % list.length)
        },
      },
      {
        name: "composer.shell.down",
        title: "Next shell",
        category: "Composer",
        run() {
          const list = entries()
          if (list.length === 0) return
          setStore("selected", (prev) => (prev + 1) % list.length)
        },
      },
      {
        name: "composer.shell.kill",
        title: "Kill shell command",
        category: "Composer",
        run() {
          const entry = selectedEntry()
          if (!entry) return
          void data.shell.remove(entry.id)
        },
      },
      {
        name: "composer.background",
        title: "Background shell command",
        category: "Composer",
        run() {},
      },
    ],
    bindings: [
      { key: "up", desc: "Previous shell", group: "Shell", cmd: "composer.shell.up" },
      { key: "down", desc: "Next shell", group: "Shell", cmd: "composer.shell.down" },
      { key: "ctrl+d", desc: "Kill shell command", group: "Shell", cmd: "composer.shell.kill" },
      { key: "ctrl+b", desc: "Background shell command", group: "Shell", cmd: "composer.background" },
    ],
  }))

  return (
    <Show when={composer.active("shell")}>
      <scrollbox
        scrollbarOptions={{ visible: false }}
        maxHeight={5}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
      >
        <Show when={entries().length > 0} fallback={<text fg={theme.textMuted}> No shell commands</text>}>
          <For each={entries()}>
            {(shell, index) => {
              const active = createMemo(() => index() === store.selected)
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                  onMouseOver={() => setStore("selected", index())}
                >
                  <text
                    fg={active() ? fg : theme.text}
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
