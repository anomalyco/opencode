import { For, Show, createSignal, onMount } from "solid-js"
import { usePlayground } from "@/context/playground"
import { PlaygroundWindowComponent } from "./window"
import { EmptyState } from "./empty-state"

export function Canvas(props: {
  onError?: (windowId: string, message: string) => void
  onElementSelected?: (selector: string, tagName: string, textContent: string) => void
}) {
  const playground = usePlayground()
  let ref: HTMLDivElement | undefined
  const [rect, setRect] = createSignal<DOMRect | undefined>()

  onMount(() => {
    if (ref) setRect(ref.getBoundingClientRect())
  })

  function deselect(e: MouseEvent) {
    if (e.target === ref) {
      playground.selectWindow(undefined)
    }
  }

  return (
    <div
      ref={ref}
      data-component="playground-canvas"
      class="relative flex-1 overflow-hidden bg-background-base"
      onMouseDown={deselect}
    >
      {/* Subtle dot grid pattern */}
      <div
        class="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          "background-image": "radial-gradient(circle, currentColor 1px, transparent 1px)",
          "background-size": "24px 24px",
        }}
      />

      <Show when={playground.windows.length === 0}>
        <EmptyState />
      </Show>

      <For each={playground.windows}>
        {(window) => (
          <PlaygroundWindowComponent
            window={window}
            canvasRect={rect}
            onError={props.onError}
            onElementSelected={props.onElementSelected}
          />
        )}
      </For>

      {/* Minimized windows taskbar */}
      <Show when={playground.windows.some((w) => w.minimized)}>
        <div class="absolute bottom-16 left-4 right-4 flex items-center gap-2 pointer-events-none">
          <For each={playground.windows.filter((w) => w.minimized)}>
            {(window) => (
              <button
                class="pointer-events-auto px-3 py-1.5 rounded-md bg-background-stronger border border-border-weak-base text-12-medium text-text-base hover:bg-background-base transition-colors shadow-sm"
                onClick={() => playground.minimizeWindow(window.id)}
              >
                {window.title || "Untitled"}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
