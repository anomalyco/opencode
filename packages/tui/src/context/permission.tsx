import { createStore } from "solid-js/store"
import { createEffect, onCleanup } from "solid-js"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"
import { useRoute } from "./route"
import { useSDK } from "./sdk"
import { useToast } from "../ui/toast"

export type PermissionMode = "auto" | "normal" | "review"

const RETRY_MAX_MS = 30_000
const requestMs = () => Number(process.env["OPENCODE_TUI_REVIEW_OVERLAY_TIMEOUT_MS"]) || 5_000
const retryMs = () => Number(process.env["OPENCODE_TUI_REVIEW_OVERLAY_RETRY_MS"]) || 1_000

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const route = useRoute()
    const sdk = useSDK()
    const toast = useToast()
    const [store, setStore] = createStore<{ mode: PermissionMode; revision: number }>({
      mode: args.auto ? "auto" : "normal",
      revision: 0,
    })

    function set(mode: PermissionMode) {
      if (store.mode === mode) return
      setStore({ mode, revision: store.revision + 1 })
    }

    // Review mode is useless without the server-side overlay: opencode's built-in
    // ruleset allows almost everything, so nothing would ever reach the classifier.
    // The overlay is per-session and lives only in the server's memory, so the TUI
    // owns keeping it in sync with the mode and the session on screen.
    const attached = new Set<string>()
    let desired: string | undefined
    let chain: Promise<void> = Promise.resolve()
    let retry: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let unmounted = false

    async function apply(sessionID: string, enabled: boolean) {
      // The deadline is enforced here rather than left to the signal, so a
      // transport that never settles still resolves one way or the other.
      const controller = new AbortController()
      let expire!: () => void
      const deadline = new Promise<undefined>((resolve) => {
        expire = () => resolve(undefined)
      })
      const timer = setTimeout(() => {
        controller.abort()
        expire()
      }, requestMs())
      timer.unref?.()
      try {
        const result = await Promise.race([
          sdk.client.permission.overlay({ sessionID, enabled }, { signal: controller.signal }),
          deadline,
        ])
        return result?.data === enabled
      } catch {
        return false
      } finally {
        clearTimeout(timer)
      }
    }

    function scheduleRetry() {
      if (retry || unmounted) return
      const delay = Math.min(retryMs() * 2 ** failures, RETRY_MAX_MS)
      failures++
      retry = setTimeout(() => {
        retry = undefined
        void reconcile()
      }, delay)
      retry.unref?.()
    }

    async function step() {
      if (unmounted) return
      for (const sessionID of [...attached]) {
        if (sessionID === desired) continue
        // Failing to disable only costs the user extra prompts, so keep trying.
        if (await apply(sessionID, false)) {
          attached.delete(sessionID)
          failures = 0
        } else scheduleRetry()
      }
      const target = desired
      if (target === undefined || attached.has(target)) return
      if (await apply(target, true)) {
        attached.add(target)
        failures = 0
        return
      }
      // Failing to enable is the unsafe direction: the UI would claim every action
      // is being reviewed while the server auto-allows them. Drop out of the mode.
      if (desired !== target || store.mode !== "review") return
      desired = undefined
      set("normal")
      toast.show({
        variant: "error",
        title: "Auto-approve unavailable",
        message: "Could not enable review for this session. Switched back to normal permissions.",
        duration: 5000,
      })
    }

    function reconcile() {
      chain = chain.then(step, step)
      return chain
    }

    createEffect(() => {
      const data = route.data
      const next = store.mode === "review" && data.type === "session" ? data.sessionID : undefined
      if (next === desired) return
      desired = next
      void reconcile()
    })

    // A disposed instance forgets the overlay along with the rest of its memory.
    // Without re-attaching, review mode would stay lit while the server silently
    // went back to allowing everything.
    onCleanup(
      sdk.event.on("event", (event) => {
        if (event.payload.type !== "server.instance.disposed") return
        if (sdk.directory && event.directory && event.directory !== sdk.directory) return
        if (attached.size === 0) return
        attached.clear()
        void reconcile()
      }),
    )

    onCleanup(() => {
      unmounted = true
      if (retry) clearTimeout(retry)
      for (const sessionID of attached) void apply(sessionID, false)
      attached.clear()
    })

    return {
      get mode() {
        return store.mode
      },
      get revision() {
        return store.revision
      },
      set,
      toggle() {
        setStore({ mode: store.mode === "normal" ? "auto" : "normal", revision: store.revision + 1 })
      },
      /**
       * Move the overlay onto `sessionID` and wait for the server to confirm.
       * Callers that create a session and prompt it in the same tick must await
       * this, because the route only catches up afterwards.
       */
      async attach(sessionID: string) {
        if (store.mode !== "review") return
        if (desired !== sessionID) desired = sessionID
        await reconcile()
      },
    }
  },
})
