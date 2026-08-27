import { lazy, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Titlebar, type TitlebarUpdate } from "@/shell/titlebar/titlebar"
import { usePlatform } from "@/runtime/platform/platform"
import { ToastRegion } from "@/shell/notifications/toast"
import { TitlebarRightProvider } from "@/shell/titlebar/right-slot"
import { useSettingsSurface } from "@/settings/surface"
import { useSettings } from "@/settings/model"

const DebugBar = lazy(() => import("@/shell/debug/debug-bar").then((module) => ({ default: module.DebugBar })))
const SettingsScreen = lazy(() => import("@/settings/shell").then((module) => ({ default: module.SettingsScreen })))

export default function Layout(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettingsSurface()
  const preferences = useSettings()
  const mobile = createMediaQuery("(max-width: 767px)")
  const [state, setState] = createStore({
    debugTools: false,
    tabsWidth: 260,
    tabsMount: undefined as HTMLElement | undefined,
  })
  const verticalTabs = () => preferences.appearance.tabLayout() === "vertical" && !mobile()

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
          // The native Windows titlebar already includes the gap above the content panels.
          "--shell-top-inset":
            platform.platform === "desktop" &&
            platform.os === "windows" &&
            !(mobile() && preferences.general.mobileTitlebarPosition() === "bottom")
              ? "0px"
              : "8px",
        }}
      >
        <Titlebar
          update={update}
          verticalTabs={verticalTabs() ? { mount: state.tabsMount } : undefined}
          debugTools={
            import.meta.env.DEV
              ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
              : undefined
          }
        />
        <div class="flex flex-1 min-h-0 min-w-0 flex-row">
          <Show when={verticalTabs()}>
            <aside
              ref={(element) => setState("tabsMount", element)}
              data-slot="vertical-tabs-sidebar"
              class="relative flex min-h-0 shrink-0 flex-col bg-v2-background-bg-deep px-2.5 pb-2 pt-[var(--shell-top-inset,8px)]"
              style={{ width: `${state.tabsWidth}px` }}
            >
              <ResizeHandle
                class="-end-2"
                direction="horizontal"
                size={state.tabsWidth}
                min={130}
                max={520}
                onResize={(width) => setState("tabsWidth", width)}
              />
            </aside>
          </Show>
          {/* Size containment collapses percentage-height descendants in WebKit. */}
          <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-content">
            <div
              class="flex size-full min-h-0 min-w-0 flex-col"
              hidden={settings.store.open}
              inert={settings.store.open}
              aria-hidden={settings.store.open}
            >
              <Suspense>{props.children}</Suspense>
            </div>
            <Show when={settings.store.open}>
              <Suspense>
                <SettingsScreen defaultValue={settings.store.tab} />
              </Suspense>
            </Show>
          </main>
        </div>
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
