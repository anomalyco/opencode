import { createSignal, lazy, Show, Suspense } from "solid-js"
import { Command, createKeyed, Slot, type Setup } from "../sdk"
import type Debug from "./index"
import { simulated } from "./simulated"

const setup: Setup<typeof Debug> = (ctx) => {
  const DebugBar = lazy(() => import("./bar"))
  // Motion tuning lives only in the debug bar, on the dev server and in Beta. Both are fixed at build time, so other
  // builds, prod included, drop the import and never contain knobs.
  const motionTools = import.meta.env.DEV || import.meta.env.VITE_OPENCODE_CHANNEL === "beta"
  const Motion = motionTools ? lazy(() => import("./motion")) : undefined
  const bar = ctx.stores.bar
  const visible = () => bar.value.visible
  const motion = () => bar.value.motion
  const Demo = motionTools ? lazy(() => import("./demo")) : undefined
  const [demo, setDemo] = createSignal(false)

  // Routing a session on Drive's simulated model opens the bar with its Demo panel, so the controls are in view.
  if (motionTools)
    createKeyed(
      () => {
        const session = ctx.sessions.current()

        return session?.location && simulated({ ...session, location: session.location }) ? session.key : undefined
      },
      () => {
        void bar.update((draft) => {
          draft.visible = true
        })
        setDemo(true)
      },
    )

  const toggle = () => {
    bar.update((draft) => {
      draft.visible = !draft.visible
    })
  }

  const toggleMotion = () => {
    bar.update((draft) => {
      draft.motion = !draft.motion
    })
  }

  const toggleDemo = () => {
    setDemo((value) => !value)
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

  ctx.add(Slot, {
    at: "window.bottom",
    render: () => (
      <>
        <Show when={visible()}>
          <Suspense>
            <DebugBar
              diagnostics={import.meta.env.DEV}
              onClose={toggle}
              motion={Motion ? { open: motion(), toggle: toggleMotion } : undefined}
              demo={Demo ? { open: demo(), toggle: toggleDemo } : undefined}
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
        {Demo && (
          <Show when={visible() && demo()}>
            <Suspense>
              <Demo />
            </Suspense>
          </Show>
        )}
      </>
    ),
  })
}

export default setup
