/** Why the window cannot draw the tab's next frame, so a screenshot would never finish. */
export type Undrawable = "minimized" | "hidden" | "stalled"

/** How long a viewport or element capture may wait for the tab's frame before it gives up. */
export const CAPTURE_DEADLINE_MS = 2_500

/** CDP produced a PNG. Read its IHDR dimensions before deciding whether decoding and resizing are necessary. */
export function pngFits(png: Buffer, maxWidth: number, maxBytes: number) {
  if (png.length < 24 || png.length > maxBytes) return false
  const width = png.readUInt32BE(16)

  return width > 0 && width <= maxWidth && png.readUInt32BE(20) > 0
}

/**
 * macOS stops drawing a minimized window and every window of a hidden app, and a copy of the tab's frame then never
 * answers. Windows keeps drawing a minimized window, and Linux is left to the capture deadline.
 */
export function undrawable(window: {
  platform: NodeJS.Platform
  minimized: boolean
  visible: boolean
  appHidden: boolean
}): Undrawable | undefined {
  if (window.platform !== "darwin") return undefined

  if (window.minimized) return "minimized"

  if (window.appHidden || !window.visible) return "hidden"

  return undefined
}

const causes: Record<Undrawable, string> = {
  minimized: "The OpenCode window is minimized, so the system does not draw this tab.",
  hidden: "OpenCode is hidden, so the system does not draw this tab.",
  stalled: `No fresh frame of this tab arrived within ${CAPTURE_DEADLINE_MS / 1000} seconds. No cached screenshot was returned.`,
}

export function undrawableMessage(reason: Undrawable) {
  if (reason === "stalled") return `${causes.stalled} Check that the page has finished navigating and is responsive before retrying.`

  return `${causes[reason]} A screenshot needs the window restored. Ask the user to restore the OpenCode window, then take the screenshot again; do not repeat it before then. Clicks, typing and other browser actions still work.`
}
