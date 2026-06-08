import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ServerConnection } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { DialogSelectDirectory } from "./dialog-select-directory"
import { directoryPickerKind } from "./directory-picker-policy"

type DirectoryPickerInput = {
  server: ServerConnection.Any
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

export function useDirectoryPicker() {
  const platform = usePlatform()
  const dialog = useDialog()

  return (input: DirectoryPickerInput) => {
    if (directoryPickerKind(platform.platform, input.server) === "native" && platform.platform === "desktop") {
      void platform.openDirectoryPickerDialog({ title: input.title, multiple: input.multiple }).then(input.onSelect)
      return
    }

    dialog.show(
      () => <DialogSelectDirectory {...input} />,
      () => input.onSelect(null),
    )
  }
}
