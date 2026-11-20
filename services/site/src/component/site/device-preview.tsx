import { createSignal, lazy, onCleanup, onMount, Show, Suspense } from "solid-js"
import { devicePreviewFrame, devicePreviewOpenEvent, inDevicePreview } from "~/lib/platform"

/**
 * Device preview: the current page in a resizable device frame, to check the layout at phone,
 * tablet and desktop sizes. Shift+P, the ⌘K action or Settings opens it. Like Design mode it is a
 * development tool: Site loads it only on the development server, so production has none of it. The
 * panel itself is in device-preview-panel.tsx and loads the first time the preview opens.
 */

export { devicePreviewFrame, devicePreviewOpenEvent, inDevicePreview }
export const devicePreviewAvailable = () => !inDevicePreview()

// Open state for this tab, so a reload (or a hot update of the site) keeps the preview open.
const openKey = "opencode-site-device-preview-open"

const DevicePreviewPanel = lazy(() => import("./device-preview-panel"))

export default function DevicePreview() {
  const [open, setOpen] = createSignal(false)
  let opener: HTMLElement | undefined

  const show = () => {
    if (!devicePreviewAvailable() || open()) return
    if (document.activeElement instanceof HTMLElement) opener = document.activeElement
    setOpen(true)
    sessionStorage.setItem(openKey, "1")
  }
  const close = () => {
    setOpen(false)
    sessionStorage.removeItem(openKey)
    opener?.focus({ preventScroll: true })
  }

  onMount(() => {
    if (inDevicePreview()) return
    if (sessionStorage.getItem(openKey) === "1") setOpen(true)
    const key = (event: KeyboardEvent) => {
      if (event.key !== "P" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return
      if (open()) return close()
      show()
    }
    document.addEventListener("keydown", key)
    document.addEventListener(devicePreviewOpenEvent, show)
    onCleanup(() => {
      document.removeEventListener("keydown", key)
      document.removeEventListener(devicePreviewOpenEvent, show)
    })
  })

  return (
    <Suspense>
      <Show when={open() && devicePreviewAvailable()}>
        <DevicePreviewPanel onClose={close} />
      </Show>
    </Suspense>
  )
}
