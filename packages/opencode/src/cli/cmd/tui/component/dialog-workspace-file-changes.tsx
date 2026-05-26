import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import type { VcsFileStatus } from "@opencode-ai/sdk/v2"
import { createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { Locale } from "@/util/locale"
import { useTheme } from "../context/theme"
import { useTuiConfig } from "../context/tui-config"
import { useDialog, type DialogContext } from "../ui/dialog"
import { getScrollAcceleration } from "../util/scroll"

const options = ["no", "yes"] as const

export type WorkspaceFileChangesChoice = (typeof options)[number]

function statusLabel(status: VcsFileStatus["status"]) {
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  return "M"
}

function changeCountWidth(file: VcsFileStatus) {
  // The "plus 2" is for spaces
  return `${file.additions ? `+${file.additions}` : ""}${file.deletions ? ` -${file.deletions}` : ""}`.length + 2
}

export function DialogWorkspaceFileChanges(props: {
  files: VcsFileStatus[]
  onSelect: (choice: WorkspaceFileChangesChoice) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const [store, setStore] = createStore({ active: "yes" as WorkspaceFileChangesChoice })
  const height = createMemo(() => Math.min(props.files.length, 8))
  const fileNameWidth = createMemo(() => 48 - Math.max(Math.max(7, ...props.files.map(changeCountWidth)) - 7, 0))

  function confirm() {
    props.onSelect(store.active)
    dialog.clear()
  }

  useKeyboard((evt) => {
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      confirm()
      return
    }
    if (evt.name === "left") {
      evt.preventDefault()
      evt.stopPropagation()
      const index = options.indexOf(store.active)
      setStore("active", options[Math.max(index - 1, 0)])
      return
    }
    if (evt.name === "right") {
      evt.preventDefault()
      evt.stopPropagation()
      const index = options.indexOf(store.active)
      setStore("active", options[Math.min(index + 1, options.length - 1)])
    }
  })

  return (
    <box gap={1}>
      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          File Changes Found
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox
        height={height()}
        backgroundColor={theme.backgroundElement}
        scrollbarOptions={{ visible: false }}
        scrollAcceleration={scrollAcceleration()}
      >
        <For each={props.files}>
          {(item) => (
            <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
              <box flexDirection="row" minWidth={0} flexShrink={1}>
                <box width={2} flexShrink={0}>
                  <text fg={theme.textMuted}>{statusLabel(item.status)}</text>
                </box>
                <text fg={theme.textMuted} wrapMode="none">
                  {Locale.truncateLeft(item.file, fileNameWidth())}
                </text>
              </box>
              <box flexDirection="row" gap={1} minWidth={7} flexShrink={0} justifyContent="flex-end">
                <text>
                  {" "}
                  {item.additions ? <span style={{ fg: theme.diffAdded }}>+{item.additions}</span> : null}
                  {item.deletions ? <span style={{ fg: theme.diffRemoved }}> -{item.deletions}</span> : null}
                </text>
              </box>
            </box>
          )}
        </For>
      </scrollbox>
      <box paddingLeft={2} paddingRight={2}>
        <text fg={theme.textMuted} wrapMode="word">
          Do you want to apply these changes after warping?
        </text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <For each={options}>
          {(item) => (
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={item === store.active ? theme.primary : undefined}
              onMouseUp={() => {
                setStore("active", item)
                props.onSelect(item)
                dialog.clear()
              }}
            >
              <text fg={item === store.active ? theme.selectedListItemText : theme.textMuted}>{item}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

DialogWorkspaceFileChanges.show = (dialog: DialogContext, files: VcsFileStatus[]) => {
  return new Promise<WorkspaceFileChangesChoice | undefined>((resolve) => {
    dialog.replace(
      () => <DialogWorkspaceFileChanges files={files} onSelect={resolve} />,
      () => resolve(undefined),
    )
  })
}
