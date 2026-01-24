import { createSignal, onCleanup, onMount } from "solid-js"

/**
 * Creates a reactive signal that tracks the visual viewport offset
 * caused by the virtual keyboard on mobile devices.
 *
 * When the virtual keyboard opens, the visual viewport shrinks but the
 * layout viewport stays the same, causing a gap at the bottom of the page.
 * This hook calculates that offset so UI elements can adjust accordingly.
 */
export function createVisualViewport() {
  const [offset, setOffset] = createSignal(0)

  onMount(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    let wasKeyboardOpen = false

    const forceRepaint = () => {
      // Reset any scroll offset the browser added
      window.scrollTo(0, 0)

      // Force a layout recalculation by toggling a style
      document.body.style.height = "100.1%"
      requestAnimationFrame(() => {
        document.body.style.height = ""
        // Scroll again after repaint in case it didn't take
        window.scrollTo(0, 0)
      })
    }

    const update = () => {
      // Calculate the difference between the layout viewport and visual viewport
      // This represents the space taken by the virtual keyboard
      const layoutHeight = window.innerHeight
      const visualHeight = viewport.height
      // Don't subtract viewport.offsetTop - that represents scroll position within
      // the visual viewport, but we need the full keyboard height to properly
      // offset fixed elements at the bottom of the screen
      const keyboardOffset = layoutHeight - visualHeight

      // Only set offset if keyboard is likely open (more than 100px difference)
      // to avoid small fluctuations from address bar hiding/showing
      const isKeyboardOpen = keyboardOffset > 100
      setOffset(isKeyboardOpen ? keyboardOffset : 0)

      // Force repaint when keyboard closes to eliminate any gap
      if (wasKeyboardOpen && !isKeyboardOpen) {
        // Multiple attempts to ensure the gap is filled
        forceRepaint()
        setTimeout(forceRepaint, 100)
        setTimeout(forceRepaint, 300)
      }
      wasKeyboardOpen = isKeyboardOpen
    }

    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    update()

    onCleanup(() => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    })
  })

  return offset
}
