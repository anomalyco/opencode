import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { Keymap } from "../../../context/keymap"
import type { useSessionTerminals } from "../../../context/session-terminals"
import { useTheme } from "../../../context/theme"
import { useComposerTab } from "./index"

export function TerminalsTab(props: { sessionID: string; terminals: ReturnType<typeof useSessionTerminals> }) {
  const composer = useComposerTab()
  const theme = useTheme()
  const [selected, setSelected] = createSignal(0)
  const session = () => props.terminals.get(props.sessionID)
  const entries = () => session()?.terminals ?? []

  onMount(() => {
    const cleanup = composer.register({ id: "terminals", label: "Terminals" })
    onCleanup(cleanup)
  })

  createEffect(() => {
    if (!composer.active("terminals")) return
    const index = entries().findIndex((terminal) => terminal.id === session()?.selectedTerminalID)
    setSelected(index < 0 ? 0 : index)
  })

  const select = () => {
    const terminal = entries()[selected()]
    composer.close()
    if (terminal) {
      void props.terminals.selectTerminal(props.sessionID, terminal.id)
      return
    }
    void props.terminals.newTerminal(props.sessionID)
  }

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("terminals"),
    priority: 1,
    commands: [
      {
        id: "composer.terminal.up",
        title: "Previous terminal",
        group: "Composer",
        run: () => setSelected((index) => (index + entries().length) % (entries().length + 1)),
      },
      {
        id: "composer.terminal.down",
        title: "Next terminal",
        group: "Composer",
        run: () => setSelected((index) => (index + 1) % (entries().length + 1)),
      },
      {
        id: "composer.terminal.select",
        title: "Select terminal",
        group: "Composer",
        run: select,
      },
    ],
  }))

  return (
    <Show when={composer.active("terminals")}>
      <scrollbox scrollbarOptions={{ visible: false }} maxHeight={5}>
        <For each={[...entries(), undefined]}>
          {(terminal, index) => {
            const active = createMemo(() => index() === selected())
            const current = () => terminal?.id === session()?.selectedTerminalID
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  active()
                    ? theme.background.action.primary.focused
                    : current()
                      ? theme.background.action.primary.selected
                      : theme.background.action.primary.default
                }
                onMouseOver={() => setSelected(index())}
                onMouseUp={() => {
                  setSelected(index())
                  select()
                }}
              >
                <text
                  fg={
                    active()
                      ? theme.text.action.primary.focused
                      : current()
                        ? theme.text.action.primary.selected
                        : theme.text.action.primary.default
                  }
                  attributes={active() ? TextAttributes.BOLD : undefined}
                  wrapMode="none"
                  truncate
                >
                  {terminal?.foregroundProcess ?? terminal?.title ?? "+ New terminal"}
                </text>
              </box>
            )
          }}
        </For>
      </scrollbox>
    </Show>
  )
}
