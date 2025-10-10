import { Show, type ParentProps, onMount, onCleanup } from "solid-js"
import { Icon, IconButton } from "@/ui"

interface DrawerProps extends ParentProps {
  open: boolean
  onClose: () => void
  title: string
  side?: "left" | "right"
}

export default function Drawer(props: DrawerProps) {
  let drawerRef: HTMLDivElement | undefined

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose()
    }
  }

  onMount(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.open) {
        props.onClose()
      }
    }
    document.addEventListener("keydown", handleEscape)
    onCleanup(() => document.removeEventListener("keydown", handleEscape))
  })

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
        onClick={handleBackdropClick}
        style={{ "touch-action": "none" }}
      >
        <div
          ref={drawerRef}
          class="fixed top-0 bottom-0 w-4/5 max-w-sm bg-background-panel
                 shadow-2xl transform transition-transform duration-300 ease-out
                 flex flex-col overflow-hidden"
          classList={{
            "left-0": props.side !== "right",
            "right-0": props.side === "right",
          }}
          style={{
            "padding-top": "var(--safe-area-inset-top)",
            "padding-left": props.side !== "right" ? "var(--safe-area-inset-left)" : "0",
            "padding-right": props.side === "right" ? "var(--safe-area-inset-right)" : "0",
          }}
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-border-subtle/30 shrink-0">
            <h2 class="text-base font-semibold text-text">{props.title}</h2>
            <IconButton size="sm" variant="ghost" onClick={props.onClose}>
              <Icon name="close" size={24} />
            </IconButton>
          </div>
          <div class="flex-1 overflow-y-auto">{props.children}</div>
        </div>
      </div>
    </Show>
  )
}
