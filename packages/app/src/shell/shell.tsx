import { lazy, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Titlebar, type TitlebarUpdate } from "@/shell/titlebar/titlebar"
import { usePlatform } from "@/runtime/platform/platform"
import { ToastRegion } from "@/shell/notifications/toast"
import { TitlebarRightProvider } from "@/shell/titlebar/right-slot"

const DebugBar = lazy(() => import("@/shell/debug/debug-bar").then((module) => ({ default: module.DebugBar })))

export default function Layout(props: ParentProps) {
  const platform = usePlatform()
  const [state, setState] = createStore({ debugTools: false })

  const update: TitlebarUpdate = {
    get version() {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return undefined
      return state.version
    },
    get installing() {
      return platform.updater?.state().status === "installing"
    },
    install: () => void platform.updater?.install(),
  }

  return (
    <TitlebarRightProvider>
      <div
        class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
        style={{
          "padding-top": "env(safe-area-inset-top, 0px)",
          "padding-bottom": "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <Titlebar
          update={update}
          debugTools={
            import.meta.env.DEV
              ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
              : undefined
          }
        />
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
        <Show when={import.meta.env.DEV && state.debugTools}>
          <Suspense>
            <DebugBar inline />
          </Suspense>
        </Show>
        <ToastRegion />
      </div>
    </TitlebarRightProvider>
  )
}
