import { createEffect, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { setRailMount } from "@/components/titlebar-tab-rail"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettings()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
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
      {/* Row wrapper so the tab rail and the content sit side by side. With vertical
          tabs off this collapses to a single full-width child. */}
      <div class="flex-1 min-h-0 min-w-0 flex flex-row">
        <Show when={settings.general.verticalTabs()}>
          <div
            data-slot="titlebar-tab-rail"
            // `contain-strict` on <main> makes it an independent layout root, so the
            // rail needs its own explicit width and shrink-0 to avoid being squeezed
            // to zero by a wide session view. `p-2` matches the `m-2` inset on the
            // content card so the first tab lines up with the panel beside it.
            class="w-56 shrink-0 min-h-0 flex flex-col overflow-hidden bg-v2-background-bg-deep p-2 gap-1.5"
            ref={(el) => setRailMount(el)}
          />
        </Show>
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
