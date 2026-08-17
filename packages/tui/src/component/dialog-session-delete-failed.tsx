import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"

export function DialogSessionDeleteFailed(props: {
  session: string
  workspace: string
  onDelete?: () => boolean | void | Promise<boolean | void>
  onRestore?: () => boolean | void | Promise<boolean | void>
  onDone?: () => void
}) {
  const dialog = useDialog()
  const { themeV2 } = useTheme().contextual("elevated")
  const [store, setStore] = createStore({
    active: "delete" as "delete" | "restore",
  })

  const options = [
    {
      id: "delete" as const,
      title: "Delete workspace",
      description: "Delete the workspace and all sessions attached to it.",
      run: props.onDelete,
    },
    {
      id: "restore" as const,
      title: "Restore to new workspace",
      description: "Try to restore this session into a new workspace.",
      run: props.onRestore,
    },
  ]

  async function confirm() {
    const result = await options.find((item) => item.id === store.active)?.run?.()
    if (result === false) return
    props.onDone?.()
    if (!props.onDone) dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Confirm recovery option", group: "Dialog", run: () => void confirm() },
      { bind: "left", title: "Delete broken session", group: "Dialog", run: () => setStore("active", "delete") },
      { bind: "up", title: "Delete broken session", group: "Dialog", run: () => setStore("active", "delete") },
      {
        bind: "right",
        title: "Restore broken session",
        group: "Dialog",
        run: () => setStore("active", "restore"),
      },
      {
        bind: "down",
        title: "Restore broken session",
        group: "Dialog",
        run: () => setStore("active", "restore"),
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={themeV2.text()}>
          Failed to Delete Session
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={themeV2.text.subdued()} wrapMode="word">
        {`The session "${props.session}" could not be deleted because the workspace "${props.workspace}" is not available.`}
      </text>
      <text fg={themeV2.text.subdued()} wrapMode="word">
        Choose how you want to recover this broken workspace session.
      </text>
      <box flexDirection="column" paddingBottom={1} gap={1}>
        <For each={options}>
          {(item) => (
            <box
              flexDirection="column"
              paddingLeft={1}
              paddingRight={1}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={item.id === store.active ? themeV2.background.action("focused") : undefined}
              onMouseUp={() => {
                setStore("active", item.id)
                void confirm()
              }}
            >
              <text
                attributes={TextAttributes.BOLD}
                fg={item.id === store.active ? themeV2.text.action("focused") : themeV2.text()}
              >
                {item.title}
              </text>
              <text
                fg={item.id === store.active ? themeV2.text.action("focused") : themeV2.text.subdued()}
                wrapMode="word"
              >
                {item.description}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
