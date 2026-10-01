import { createMemo, For, Show, createEffect, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useData } from "../../../context/data"
import { useClient } from "../../../context/client"
import { useTheme } from "../../../context/theme"
import { Keymap } from "../../../context/keymap"
import { useComposerTab } from "./context"
import { useDialog } from "../../../ui/dialog"
import { DialogShellOutput } from "../../../component/dialog-shell-output"
import { useToast } from "../../../ui/toast"

export function ShellTab(props: { sessionID: string }) {
  const data = useData()
  const client = useClient()
  const theme = useTheme()
  const composer = useComposerTab()
  const shortcuts = Keymap.useShortcuts()
  const dialog = useDialog()
  const toast = useToast()

  const entries = createMemo(() => {
    const monitors = data.monitor.list(props.sessionID)
    return [
      ...monitors.map((monitor) => ({ monitor, shell: data.shell.get(monitor.shellID) })),
      ...data.shell
        .listBySession(props.sessionID)
        .filter((shell) => shell.status === "running" && !monitors.some((monitor) => monitor.shellID === shell.id))
        .map((shell) => ({ monitor: undefined, shell })),
    ]
  })

  createEffect(() => {
    if (client.connection.status() !== "connected") return
    void data.monitor.sync(props.sessionID).catch(() => undefined)
  })

  const [store, setStore] = createStore({ selected: 0, stopping: {} as Record<string, boolean | undefined> })
  let scroll: ScrollBoxRenderable | undefined

  const selectedEntry = createMemo(() => entries()[store.selected])

  const open = () => {
    const entry = selectedEntry()
    if (entry?.monitor) {
      const monitor = entry.monitor
      dialog.replace(() => <DialogShellOutput monitor={monitor} />)
      return
    }
    if (entry?.shell) {
      const shell = entry.shell
      dialog.replace(() => <DialogShellOutput shell={shell} location={shell.location} />)
    }
  }

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
      label: "Background",
      hints: () => {
        const entry = selectedEntry()
        if (!entry) return []
        return [
          { label: "output", shortcut: shortcuts.get("composer.shell.select") ?? "" },
          ...(entry.monitor?.status === "ended"
            ? []
            : [
                {
                  label: store.stopping[entry.monitor?.shellID ?? entry.shell!.id] ? "stopping…" : "stop",
                  shortcut: store.stopping[entry.monitor?.shellID ?? entry.shell!.id]
                    ? ""
                    : (shortcuts.get("composer.shell.kill") ?? ""),
                },
              ]),
        ]
      },
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("shell"),
    priority: 1,
    commands: [
      {
        id: "composer.shell.up",
        title: "Previous background task",
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
        id: "composer.shell.down",
        title: "Next background task",
        group: "Composer",
        run() {
          const list = entries()
          if (list.length === 0) return
          setStore("selected", (prev) => (prev + 1) % list.length)
        },
      },
      {
        id: "composer.shell.select",
        title: "View shell output",
        group: "Composer",
        run: open,
      },
      {
        id: "composer.shell.kill",
        title: "Stop background task",
        group: "Composer",
        run() {
          const entry = selectedEntry()
          const id = entry?.monitor?.shellID ?? entry?.shell?.id
          if (!entry || !id || entry.monitor?.status === "ended" || store.stopping[id]) return
          setStore("stopping", id, true)
          const request = entry.monitor
            ? client.api.monitor.stop({ id: entry.monitor.id, sessionID: props.sessionID })
            : client.api.shell.remove({ id, location: { directory: entry.shell!.location.directory } })
          void request
            .catch(() => {
              toast.show({ message: "Could not stop background task. Try again.", variant: "error" })
            })
            .finally(() => setStore("stopping", id, undefined))
        },
      },
    ],
  }))

  return (
    <Show when={composer.active("shell")}>
      <scrollbox scrollbarOptions={{ visible: false }} maxHeight={8} ref={(r: ScrollBoxRenderable) => (scroll = r)}>
        <Show when={entries().length > 0} fallback={<text fg={theme.text.muted}> No background tasks</text>}>
          <For each={entries()}>
            {(entry, index) => {
              const active = createMemo(() => index() === store.selected)
              return (
                <box
                  flexDirection="column"
                  flexShrink={0}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    active() ? theme.background.action.primary.focused : theme.background.action.primary.base
                  }
                  onMouseMove={() => setStore("selected", index())}
                  onMouseUp={() => {
                    setStore("selected", index())
                    open()
                  }}
                >
                  <text
                    fg={active() ? theme.text.action.primary.focused : theme.text.action.primary.base}
                    attributes={active() ? TextAttributes.BOLD : undefined}
                    wrapMode={entry.monitor ? "word" : "none"}
                  >
                    {entry.monitor ? `Monitor · ${entry.monitor.description}` : entry.shell?.command.split("\n", 1)[0]}
                  </text>
                  <Show when={entry.monitor}>
                    {(monitor) => (
                      <>
                        <text fg={active() ? theme.text.action.primary.focused : theme.text.muted} wrapMode="word">
                          {monitor().eventCount} events ·{" "}
                          {monitor().status === "running"
                            ? store.stopping[monitor().shellID]
                              ? "stopping…"
                              : "running"
                            : `ended: ${monitor().reason?.replaceAll("_", " ") ?? "unknown"}${monitor().exitCode === undefined ? "" : ` (exit ${monitor().exitCode})`}`}
                        </text>
                        <text fg={active() ? theme.text.action.primary.focused : theme.text.muted} wrapMode="word">
                          started {new Date(monitor().startedAt).toLocaleTimeString()} · expires{" "}
                          {new Date(monitor().expiresAt).toLocaleTimeString()}
                        </text>
                      </>
                    )}
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
    </Show>
  )
}
