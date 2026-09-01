import { createEffect, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { type TitlebarUpdate } from "@/components/titlebar"
import { WindowsAppMenu } from "@/components/windows-app-menu"
import { useCommand } from "@/context/command"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { SessionHistoryTree } from "@/pages/session-history-tree"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const current = platform.updater?.state()
      if (current?.status !== "ready") return
      return current.version
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
      <WindowChrome />
      <div class="relative flex min-h-0 min-w-0 flex-1">
        <SessionHistoryTree update={update} />
        <main class="flex min-h-0 min-w-0 flex-1 flex-col items-start overflow-x-hidden contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      <Show when={import.meta.env.DEV}>
        <div class="flex shrink-0 items-center gap-2 px-2 py-1">
          <Show when={import.meta.env.VITE_OPENCODE_CHANNEL === "dev"}>
            <button
              type="button"
              class="bg-icon-interactive-base text-[#FFF] font-medium px-2 rounded-sm uppercase font-mono cursor-pointer"
              onClick={() => setState("debugTools", (value) => !value)}
              aria-label="Toggle debug tools"
              aria-pressed={state.debugTools}
            >
              DEV
            </button>
          </Show>
          <Show when={state.debugTools}>
            <DebugBar inline />
          </Show>
        </div>
      </Show>
      <ToastRegion v2 />
    </div>
  )
}

function WindowChrome() {
  const platform = usePlatform()
  const command = useCommand()
  const windows = platform.platform === "desktop" && platform.os === "windows"
  const linux = platform.platform === "desktop" && platform.os === "linux"

  return (
    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-50 flex h-9 items-center gap-1.5 px-2"
      data-tauri-drag-region
    >
      <Show when={windows || linux}>
        <div class="pointer-events-auto">
          <WindowsAppMenu command={command} platform={platform} variant="v2" />
        </div>
      </Show>
    </div>
  )
}
