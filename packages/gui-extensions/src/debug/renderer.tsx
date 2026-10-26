import { showToast, toaster } from "@opencode/ui/toast"
import { lazy, Show, Suspense } from "solid-js"
import { createKeyed, Command, Slot, type Setup } from "../sdk"
import type Debug from "./index"

const setup: Setup<typeof Debug> = (ctx) => {
  const DebugBar = lazy(() => import("./bar"))
  // Motion tuning lives only in the debug bar, on the dev server and in Beta. Both are fixed at build time, so other
  // builds, prod included, drop the import and never contain knobs.
  const motionTools = import.meta.env.DEV || import.meta.env.VITE_OPENCODE_CHANNEL === "beta"
  const Motion = motionTools ? lazy(() => import("./motion")) : undefined
  const bar = ctx.stores.bar
  const visible = () => bar.value.visible
  const motion = () => bar.value.motion

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
  const memory = ctx.uses.memory

  const memoryState = () => {
    const live = memory()

    return live.status === "active" ? live.value.state() : undefined
  }

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
      keywords: "dev bar developer tools diagnostics",
      run: toggle,
    }),
  )

  const desktop = ctx.desktop

  // Offered only while main answers: never on the web, and not while the extension restarts.
  if (desktop)
    createKeyed(ctx.uses.heap, (heap) =>
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
        run: async () => {
          const loading = showToast({ variant: "loading", title: ctx.t("heap.loading"), persistent: true })

          const result = await heap.write({ signal: ctx.signal }).catch(() => undefined)

          toaster.dismiss(loading)

          if (ctx.signal.aborted) return

          if (!result) return void showToast({ variant: "error", title: ctx.t("heap.failed") })

          showToast({
            variant: result.complete ? "success" : "error",
            title: ctx.t(result.complete ? "heap.done" : "heap.partial"),
            description: result.directory,
            persistent: true,
            actions: [{ label: ctx.t("heap.reveal"), onClick: () => void desktop.reveal(result.directory) }],
          })
        },
      }),
    )

  ctx.add(Slot, {
    at: "window.bottom",
    render: () => (
      <>
        <Show when={visible() || memoryState()?.on}>
          <Suspense>
            <DebugBar
              diagnostics={import.meta.env.DEV}
              memory={memoryControl()}
              onClose={hide}
              motion={Motion ? { open: motion(), toggle: toggleMotion } : undefined}
              inline
            />
          </Suspense>
        </Show>
        {Motion && (
          // The Knobs workspace opens only from the debug bar's KNOBS cell, and shows while the bar does.
          <Show when={visible() && motion()}>
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
