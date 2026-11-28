import { createSignal } from "solid-js"
import { openPath } from "@opencode/util/open"
import { useRenderer } from "@opentui/solid"
import { useClipboard } from "../context/clipboard"
import { useDialog, type DialogContext } from "./dialog"
import { DialogSelect } from "./dialog-select"
import { useToast } from "./toast"

export function useWorkingDirectoryActions(input: { directory: () => string | undefined; onMove?: () => void }) {
  return usePathActions({
    title: () => "Working directory",
    path: input.directory,
    folder: input.directory,
    onMove: input.onMove,
  })
}

/**
 * A click target that opens a menu to copy `path`, open `folder` in the system file manager when this machine has it,
 * and move the session when `onMove` is given.
 */
export function usePathActions(input: {
  title: () => string
  path: () => string | undefined
  folder?: () => string | undefined
  onMove?: () => void
}) {
  const clipboard = useClipboard()
  const dialog = useDialog()
  const renderer = useRenderer()
  const toast = useToast()
  const [hovered, setHovered] = createSignal(false)

  const copied = () => toast.show({ message: "Path copied to clipboard", variant: "info" })

  function openMenu() {
    if (renderer.getSelection()?.getSelectedText()) return
    const path = input.path()
    if (!path) return
    const folder = input.folder?.()
    dialog.replace(() => (
      <DialogSelect
        title={input.title()}
        renderFilter={false}
        options={[
          {
            title: "Copy path",
            value: "location.copy",
            description: path,
            onSelect: (dialog) => {
              void clipboard.write(path).then(() => {
                dialog.clear()
                copied()
              }, toast.error)
            },
          },
          ...(folder
            ? [
                {
                  title: "Open folder",
                  value: "location.open",
                  description: "in system file manager",
                  onSelect: (dialog: DialogContext) => {
                    dialog.clear()
                    void openPath(folder).catch(toast.error)
                  },
                },
              ]
            : []),
          ...(input.onMove
            ? [
                {
                  title: "Workspaces",
                  value: "session.move",
                  description: "to another working directory",
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
    /** Copies the path, as the menu's first entry does. */
    copy: () => {
      const path = input.path()
      if (path) void clipboard.write(path).then(copied, toast.error)
    },
  }
}
