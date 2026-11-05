import { showToast, toaster } from "@opencode/ui/toast"
import { createMemo, createSignal, lazy, onCleanup, Show, Suspense } from "solid-js"
import { createKeyed, Command, Slot, type Plugin } from "@opencode/plugin/gui"
import type Debug from "./index"
import { HeapSnapshots, MemoryDiagnostics } from "./contract"
import {
  createHeapCommandState,
  isHeapCommandEnabled,
  transitionHeapCommand,
  type HeapCommandEffect,
  type HeapCommandEvent,
} from "./heap-machine"
import { debugBarView } from "./memory-machine"

const setup: Plugin.Setup<typeof Debug> = (ctx) => {
  const DebugBar = lazy(() => import("./bar"))
  // Motion tuning lives only in the debug bar, on the dev server and in Beta. Both are fixed at build time, so other
  // builds, prod included, drop the import and never contain knobs.
  const motionTools = import.meta.env.DEV || import.meta.env.VITE_OPENCODE_CHANNEL === "beta"
  const Motion = motionTools ? lazy(() => import("./motion")) : undefined
  const bar = ctx.stores.bar

  const toggle = () => {
    bar.update((draft) => {
      draft.visible = !draft.visible
    })
  }

  const hide = () => {
    bar.update((draft) => {
      draft.visible = false
    })
  }

  // Offered by main only in debug builds. The bar stays open while diagnostics run, so they are never silently on.
  const memory = ctx.use(MemoryDiagnostics)

  const memoryState = () => {
    const live = memory()

    return live.status === "active" ? live.value.state() : undefined
  }

  const barView = createMemo(() => debugBarView(bar.value, memoryState()))

  const memoryControl = () => {
    const live = memory()
    const state = memoryState()

    if (live.status !== "active" || !state) return

    return {
      on: state.on,
      env: state.env,
      toggle: () => {
        // The environment's choice lasts for the launch.
        if (!state.env) void live.value.set(!state.on)
      },
    }
  }

  const toggleMotion = () => {
    bar.update((draft) => {
      draft.motion = !draft.motion
    })
  }

  ctx.add(
    Command,
    (): Command => ({
      id: "toggle",
      title: ctx.t("command.toggle"),
      group: ctx.t("command.category.view"),
      keywords: "toggle debug bar dev developer tools diagnostics",
      // Running diagnostics keep the bar open.
      enabled: barView().togglable,
      run: toggle,
    }),
  )

  const desktop = ctx.desktop

  // Offered only while main answers: never on the web, and not while the plugin restarts.
  if (desktop)
    createKeyed(ctx.use(HeapSnapshots), (heap) => {
      const [heapState, setHeapState] = createSignal(createHeapCommandState())
      const controllers = new Map<number, AbortController>()
      const toasts = new Map<number, ReturnType<typeof showToast>>()

      const dispatch = (event: HeapCommandEvent) => {
        const next = transitionHeapCommand(heapState(), event)

        setHeapState(next.state)
        next.effects.forEach(
          (effect) =>
            void Promise.try(() => run(effect)).catch((cause: unknown) => console.error("[debug] heap", cause)),
        )
      }

      const run = (effect: HeapCommandEffect) => {
        if (effect.type === "capture.start") {
          const controller = new AbortController()

          controllers.set(effect.attempt, controller)
          toasts.set(effect.attempt, showToast({ variant: "loading", title: ctx.t("heap.loading"), persistent: true }))
          void Promise.try(() => heap.write({ signal: AbortSignal.any([ctx.signal, controller.signal]) })).then(
            (result) => dispatch({ type: "succeeded", attempt: effect.attempt, result }),
            () => dispatch({ type: "failed", attempt: effect.attempt }),
          )

          return
        }

        const loading = toasts.get(effect.attempt)

        controllers.get(effect.attempt)?.abort()
        controllers.delete(effect.attempt)
        toasts.delete(effect.attempt)

        // Without an id, dismiss clears every toast.
        if (loading !== undefined) toaster.dismiss(loading)

        if (effect.type === "capture.abort") return

        if (effect.type === "toast.failed") return void showToast({ variant: "error", title: ctx.t("heap.failed") })
        const result = effect.result

        showToast({
          variant: result.complete ? "success" : "error",
          title: ctx.t(result.complete ? "heap.done" : "heap.partial"),
          description: result.directory,
          persistent: true,
          actions: [{ label: ctx.t("heap.reveal"), onClick: () => void desktop.reveal(result.directory) }],
        })
      }

      onCleanup(() => dispatch({ type: "disposed" }))

      ctx.add(Command, {
        id: "heap",
        get title() {
          return ctx.t("command.heap")
        },
        get description() {
          return ctx.t("command.heap.description")
        },
        get group() {
          return ctx.t("command.category.settings")
        },
        get enabled() {
          return isHeapCommandEnabled(heapState())
        },
        run: () => dispatch({ type: "run" }),
      })
    })

  ctx.add(Slot, {
    at: "window.bottom",
    render: () => (
      <>
        <Show when={barView().open}>
          <Suspense>
            <DebugBar
              devTools={import.meta.env.DEV}
              memory={memoryControl()}
              onClose={barView().closable ? hide : undefined}
              motion={Motion ? { open: barView().motion, toggle: toggleMotion } : undefined}
              inline
            />
          </Suspense>
        </Show>
        {Motion && (
          // The Knobs workspace opens only from the debug bar's KNOBS cell, and shows while the bar does.
          <Show when={barView().motion}>
            <Suspense>
              <Motion title={ctx.t("motion.title")} onClose={toggleMotion} />
            </Suspense>
          </Show>
        )}
      </>
    ),
  })
}

export default setup
