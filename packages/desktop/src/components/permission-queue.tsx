import { Button, Card } from "@opencode-ai/ui"
import { For, Show, createEffect, onCleanup } from "solid-js"
import { useSync } from "@/context/sync"
import { useSession } from "@/context/session"
import { useSDK } from "@/context/sdk"
import type { Permission } from "@opencode-ai/sdk"

export function PermissionQueue() {
  const sync = useSync()
  const session = useSession()
  const sdk = useSDK()

  const permissions = () => {
    const sessionID = session.id
    if (!sessionID) return []
    return sync.data.permission[sessionID] || []
  }

  const oldest = () => permissions()[0]

  const handleResponse = async (permission: Permission, response: "once" | "always" | "reject") => {
    if (!session.id) return
    await sdk.client.permission.respond({
      path: { sessionID: session.id, permissionID: permission.id },
      body: { response },
    })
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const p = oldest()
    if (!p) return

    if (event.key === "Enter" || event.key === "1") {
      event.preventDefault()
      handleResponse(p, "once")
    } else if (event.key === "2") {
      event.preventDefault()
      handleResponse(p, "always")
    } else if (event.key === "Escape" || event.key === "3") {
      event.preventDefault()
      handleResponse(p, "reject")
    }
  }

  createEffect(() => {
    if (permissions().length > 0) {
      document.addEventListener("keydown", handleKeyDown)
    }
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown)
    })
  })

  return (
    <Show when={permissions().length > 0}>
      <div class="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-md">
        <For each={permissions()}>
          {(permission, index) => {
            const isOldest = () => index() === 0
            return (
              <Card
                classList={{
                  "p-4 flex flex-col gap-3": true,
                  "ring-2 ring-border-strong-base": isOldest(),
                }}
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="flex-1">
                    <div class="text-14-medium text-text-strong">{permission.prompt}</div>
                    <Show when={permissions().length > 1 && isOldest()}>
                      <div class="text-12-regular text-text-weak mt-1">1 of {permissions().length} permissions</div>
                    </Show>
                  </div>
                </div>
                <Show when={isOldest()}>
                  <div class="flex gap-2">
                    <Button size="small" variant="primary" onClick={() => handleResponse(permission, "once")}>
                      Once (1/↵)
                    </Button>
                    <Button size="small" variant="secondary" onClick={() => handleResponse(permission, "always")}>
                      Always (2)
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => handleResponse(permission, "reject")}>
                      Reject (3/Esc)
                    </Button>
                  </div>
                </Show>
              </Card>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
