import { createEffect, createRoot, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Permission } from "@opencode-ai/sdk/v2/client"
import { persisted } from "@/utils/persist"

type PermissionsBySession = {
  [sessionID: string]: Permission[]
}

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
}) => void

const AUTO_ACCEPT_TYPES = new Set(["edit", "write"])

function shouldAutoAccept(perm: Permission) {
  return AUTO_ACCEPT_TYPES.has(perm.type)
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: (props: { permissions: PermissionsBySession; onRespond: PermissionRespondFn }) => {
    const [store, setStore, _, ready] = persisted(
      "permission.v1",
      createStore({
        autoAcceptEdits: {} as Record<string, boolean>,
      }),
    )

    const responded = new Set<string>()
    const watches = new Map<string, () => void>()

    function respond(perm: Permission) {
      if (responded.has(perm.id)) return
      responded.add(perm.id)
      props.onRespond({
        sessionID: perm.sessionID,
        permissionID: perm.id,
        response: "once",
      })
    }

    function watch(sessionID: string) {
      if (watches.has(sessionID)) return

      const dispose = createRoot((dispose) => {
        createEffect(() => {
          if (!store.autoAcceptEdits[sessionID]) return

          const permissions = props.permissions[sessionID] ?? []
          permissions.length

          for (const perm of permissions) {
            if (!shouldAutoAccept(perm)) continue
            respond(perm)
          }
        })

        return dispose
      })

      watches.set(sessionID, dispose)
    }

    function unwatch(sessionID: string) {
      const dispose = watches.get(sessionID)
      if (!dispose) return
      dispose()
      watches.delete(sessionID)
    }

    createEffect(() => {
      if (!ready()) return

      for (const sessionID in store.autoAcceptEdits) {
        if (!store.autoAcceptEdits[sessionID]) continue
        watch(sessionID)
      }
    })

    onCleanup(() => {
      for (const dispose of watches.values()) dispose()
      watches.clear()
    })

    function enable(sessionID: string) {
      setStore("autoAcceptEdits", sessionID, true)
      watch(sessionID)

      const permissions = props.permissions[sessionID] ?? []
      for (const perm of permissions) {
        if (!shouldAutoAccept(perm)) continue
        respond(perm)
      }
    }

    function disable(sessionID: string) {
      setStore("autoAcceptEdits", sessionID, false)
      unwatch(sessionID)
    }

    return {
      get permissions() {
        return props.permissions
      },
      respond: props.onRespond,
      isAutoAccepting(sessionID: string) {
        return store.autoAcceptEdits[sessionID] ?? false
      },
      toggleAutoAccept(sessionID: string) {
        if (store.autoAcceptEdits[sessionID]) {
          disable(sessionID)
          return
        }

        enable(sessionID)
      },
      enableAutoAccept(sessionID: string) {
        if (store.autoAcceptEdits[sessionID]) return
        enable(sessionID)
      },
      disableAutoAccept(sessionID: string) {
        disable(sessionID)
      },
    }
  },
})
