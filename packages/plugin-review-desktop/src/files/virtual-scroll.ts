import { createSignal, onMount, type Accessor } from "solid-js"

export function virtualScrollElement(root: HTMLElement | undefined) {
  if (!root?.isConnected) return null
  return root.closest<HTMLDivElement>(".scroll-view__viewport")
}

export function createVirtualScrollElement(root: Accessor<HTMLElement | undefined>) {
  const [mounted, setMounted] = createSignal(false)
  // Extension content roots are created before the host inserts their DOM.
  onMount(() => queueMicrotask(() => setMounted(true)))
  return () => (mounted() ? virtualScrollElement(root()) : null)
}
