import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { VcsFileStatus } from "@opencode/client"
import { createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { FilePath } from "../ui/file-path"
import { useTheme } from "../context/theme"
import { useConfig, useNewDesigns } from "../config"
import {
  DIALOG_INSET,
  DialogBleed,
  dialogWidth,
  DialogHeader,
  DialogLayout,
  useDialog,
  type DialogContext,
} from "../ui/dialog"
import { getScrollAcceleration } from "../util/scroll"

const options = ["no", "yes"] as const

export type WorkspaceFileChangesChoice = (typeof options)[number]

export function statusLabel(status: VcsFileStatus["status"]) {
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
  title?: string
  message?: string
  /** Footer action for the "yes" choice under the "new-designs" experiment, e.g. `{ title: "delete", key: "d" }`. */
  confirm?: { title: string; key: string }
}) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const overlayTheme = useTheme()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))
  const newDesigns = useNewDesigns()
  const [store, setStore] = createStore({ active: "yes" as WorkspaceFileChangesChoice })
  const height = createMemo(() => Math.min(props.files.length, 8))
  const fileNameWidth = createMemo(() =>
    Math.max(
      2,
      Math.min(dialogWidth("medium"), dimensions().width - 2) -
        DIALOG_INSET * 2 -
        2 -
        Math.max(7, ...props.files.map(changeCountWidth)),
    ),
  )

  function choose(choice: WorkspaceFileChangesChoice) {
    props.onSelect(choice)
    dialog.clear()
  }

  const confirmAction = () => props.confirm ?? { title: "confirm", key: "enter" }

  useKeyboard((evt) => {
    // Escape needs no handling here: the dialog closes on escape, which resolves as a cancel.
    if (newDesigns()) {
      if (evt.name !== (confirmAction().key === "enter" ? "return" : confirmAction().key)) return
      evt.preventDefault()
      evt.stopPropagation()
      choose("yes")
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      choose(store.active)
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
    <DialogLayout
      header={<DialogHeader title={props.title ?? "File Changes Found"} />}
      footer={{
        actions: {
          primary: [
            { title: "cancel", key: "esc", onTrigger: () => choose("no") },
            { title: confirmAction().title, key: confirmAction().key, onTrigger: () => choose("yes") },
          ],
        },
      }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <For each={options}>
            {(item) => (
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={item === store.active ? theme.background.action.primary.focused : undefined}
                onMouseUp={() => {
                  setStore("active", item)
                  props.onSelect(item)
                  dialog.clear()
                }}
              >
                <text fg={item === store.active ? theme.text.action.primary.focused : theme.text.muted}>{item}</text>
              </box>
            )}
          </For>
        </box>
      }
    >
      <box gap={1}>
        <text fg={theme.text.muted} wrapMode="word">
          {props.message ?? "Do you want to move these changes with the session?"}
        </text>
        <DialogBleed>
          <scrollbox
            height={height()}
            backgroundColor={overlayTheme.background.raised.high}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={scrollAcceleration()}
          >
            <For each={props.files}>
              {(item) => (
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  paddingLeft={DIALOG_INSET}
                  paddingRight={DIALOG_INSET}
                >
                  <box flexDirection="row" minWidth={0} flexShrink={1}>
                    <box width={2} flexShrink={0}>
                      <text fg={overlayTheme.text.muted}>{statusLabel(item.status)}</text>
                    </box>
                    <FilePath value={item.file} maxWidth={fileNameWidth()} fg={overlayTheme.text.muted} />
                  </box>
                  <box flexDirection="row" gap={1} minWidth={7} flexShrink={0} justifyContent="flex-end">
                    <text>
                      {" "}
                      {item.additions ? (
                        <span style={{ fg: overlayTheme.diff.text.added }}>+{item.additions}</span>
                      ) : null}
                      {item.deletions ? (
                        <span style={{ fg: overlayTheme.diff.text.removed }}> -{item.deletions}</span>
                      ) : null}
                    </text>
                  </box>
                </box>
              )}
            </For>
          </scrollbox>
        </DialogBleed>
      </box>
    </DialogLayout>
  )
}

DialogWorkspaceFileChanges.show = (
  dialog: DialogContext,
  files: VcsFileStatus[],
  options?: { title?: string; message?: string; confirm?: { title: string; key: string } },
) => {
  return new Promise<WorkspaceFileChangesChoice | undefined>((resolve) => {
    dialog.replace(
      () => <DialogWorkspaceFileChanges files={files} onSelect={resolve} {...options} />,
      () => resolve(undefined),
    )
  })
}
