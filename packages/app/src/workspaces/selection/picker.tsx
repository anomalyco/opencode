import { useDialog } from "@opencode/ui/context/dialog"
import { ServerConnection } from "@/runtime/server/registry"
import { usePlatform } from "@/runtime/platform/platform"
import { lazy, Suspense } from "solid-js"
import type { LocationRef } from "@opencode/client/promise"
import { directoryPickerKind } from "./policy"

const DirectoryPickerDialog = lazy(() =>
  import("./dialog").then((module) => ({ default: module.DirectoryPickerDialog })),
)

type DirectoryPickerInput = {
  server: ServerConnection.Any
  location?: LocationRef
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

    let selected = false

    const onSelect = (result: string | string[] | null) => {
      selected = result !== null
      input.onSelect(result)
    }

    const cancel = () => {
      if (!selected) input.onSelect(null)
    }

    // Dialogs render under the caller's owner, so loading the lazy chunk would otherwise suspend the caller's boundary.
    dialog.show(
      () => (
        <Suspense>
          <DirectoryPickerDialog {...input} onSelect={onSelect} />
        </Suspense>
      ),
      cancel,
    )
  }
}
