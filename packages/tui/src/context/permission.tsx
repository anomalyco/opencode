import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

export type PermissionMode = "auto" | "normal"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const sdk = useSDK()
    // `managed` means the server holds a lease for us and resolves auto-approved
    // requests without publishing `permission.asked`. Servers predating the
    // lease endpoint leave it false and `sync.tsx` keeps replying client-side.
    const [store, setStore] = createStore<{ mode: PermissionMode; managed: boolean }>({
      mode: args.auto ? "auto" : "normal",
      managed: false,
    })

    // The lease covers this instance, matching what client-side auto mode has
    // always done for a connected TUI. It has to be renewed to stay alive, so a
    // crashed or killed TUI cannot leave an attached server auto-approving.
    let lease: { id: string; ttl: number } | undefined
    let renewal: ReturnType<typeof setInterval> | undefined

    function stopRenewal() {
      if (!renewal) return
      clearInterval(renewal)
      renewal = undefined
    }

    async function acquire() {
      const result = await sdk.client.permission
        .autoAcquire({ scope: { type: "instance" } })
        .then((response) => response.data)
        .catch(() => undefined)
      if (!result) return setStore("managed", false)
      lease = result
      setStore("managed", true)
      stopRenewal()
      renewal = setInterval(() => void renew(), Math.max(1000, Math.floor(result.ttl / 3)))
    }

    async function renew() {
      const held = lease
      if (!held) return
      const result = await sdk.client.permission
        .autoRenew({ leaseID: held.id })
        .then((response) => response.data)
        .catch(() => undefined)
      if (result || lease !== held) return
      // The server dropped the lease — the instance was disposed or the renewal
      // was too late. Take a fresh one so the indicator keeps telling the truth.
      lease = undefined
      await acquire()
    }

    async function release() {
      const held = lease
      lease = undefined
      stopRenewal()
      setStore("managed", false)
      if (!held) return
      await sdk.client.permission.autoRelease({ leaseID: held.id }).catch(() => {})
    }

    function apply(mode: PermissionMode) {
      setStore("mode", mode)
      void (mode === "auto" ? acquire() : release())
    }

    onMount(() => {
      if (store.mode === "auto") void acquire()
    })

    onCleanup(() => {
      void release()
    })

    return {
      get mode() {
        return store.mode
      },
      get managed() {
        return store.managed
      },
      set(mode: PermissionMode) {
        apply(mode)
      },
      toggle() {
        apply(store.mode === "auto" ? "normal" : "auto")
      },
    }
  },
})
