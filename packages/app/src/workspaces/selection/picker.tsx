import { useDialog } from "@opencode/ui/context/dialog"
import { uuid } from "@opencode/util/uuid"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { ServerProvider } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { usePlatform } from "@/runtime/platform/platform"
import { createEffect, lazy, Suspense } from "solid-js"
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
  const servers = useServers()
  const dialog = useDialog()
  const global = useGlobal()

  return (input: DirectoryPickerInput) => {
    if (
      directoryPickerKind(platform.platform, input.server, servers.ownUrl()) === "native" &&
      platform.platform === "desktop"
    ) {
      void platform.openDirectoryPickerDialog({ title: input.title, multiple: input.multiple }).then(input.onSelect)

      return
    }

    const key = ServerConnection.key(input.server)

    // The picker lists folders through the server's live controller. Without one, as while the server rejects our
    // credentials, it would open on an empty backdrop, so the pick ends as cancelled.
    if (!global.serverCtx(key)) return input.onSelect(null)

    let selected = false
    const id = uuid()

    const onSelect = (result: string | string[] | null) => {
      selected = result !== null
      input.onSelect(result)
    }

    const cancel = () => {
      if (!selected) input.onSelect(null)
    }

    // Dialogs render under the caller's owner, so loading the lazy chunk would otherwise suspend the caller's boundary.
    dialog.show(
      () => {
        // A server that loses its controller while the picker is open closes it, which cancels the pick.
        createEffect(() => {
          if (!global.serverCtx(key)) dialog.close(id)
        })

        return (
          <ServerProvider conn={input.server}>
            <Suspense>
              <DirectoryPickerDialog {...input} onSelect={onSelect} />
            </Suspense>
          </ServerProvider>
        )
      },
      cancel,
      id,
    )
  }
}
