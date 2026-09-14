import { createSignal } from "solid-js"
import open from "open"
import { useRenderer } from "@opentui/solid"
import { useClipboard } from "../context/clipboard"
import { useDialog } from "./dialog"
import { DialogSelect } from "./dialog-select"
import { useToast } from "./toast"
import { useLanguage } from "../context/language"

export function useWorkingDirectoryActions(input: { directory: () => string | undefined; onMove?: () => void }) {
  const language = useLanguage()
  const clipboard = useClipboard()
  const dialog = useDialog()
  const renderer = useRenderer()
  const toast = useToast()
  const [hovered, setHovered] = createSignal(false)

  function openMenu() {
    if (renderer.getSelection()?.getSelectedText()) return
    const directory = input.directory()
    if (!directory) return
    dialog.replace(() => (
      <DialogSelect
        title={language.t("tui.dialogs.workingDirectory")}
        renderFilter={false}
        options={[
          {
            title: language.t("tui.dialogs.copyPath"),
            value: "location.copy",
            description: directory,
            onSelect: (dialog) => {
              void clipboard.write(directory).then(() => {
                dialog.clear()
                toast.show({ message: language.t("tui.dialogs.pathCopied"), variant: "info" })
              }, toast.error)
            },
          },
          {
            title: language.t("tui.dialogs.openFolder"),
            value: "location.open",
            description: language.t("tui.dialogs.systemFileManager"),
            onSelect: (dialog) => {
              dialog.clear()
              void open(directory).catch(toast.error)
            },
          },
          ...(input.onMove
            ? [
                {
                  title: language.t("tui.dialogs.workspaces"),
                  value: "session.move",
                  description: language.t("tui.dialogs.anotherDirectory"),
                  onSelect: () => void input.onMove?.(),
                },
              ]
            : []),
        ]}
      />
    ))
  }

  return {
    hovered,
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
    onMouseUp: openMenu,
  }
}
