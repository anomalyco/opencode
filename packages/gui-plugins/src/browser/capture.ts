/** Why the window cannot draw the tab's next frame, so a screenshot would never finish. */
export type Undrawable = "minimized" | "hidden" | "stalled"

/** How long a viewport or element capture may wait for the tab's frame before it gives up. */
export const CAPTURE_DEADLINE_MS = 2_500

/**
 * A full document may rasterize and encode up to 16 MP before a fresh frame is delivered, and a tab that was never
 * shown first wakes and paints. About 15.6 MP took up to 1 s on Windows and 5.6 s on macOS, which left a 6 s deadline
 * no margin. Still well inside the tool's 60 s.
 */
export const FULL_PAGE_DEADLINE_MS = 15_000

type Size = { width: number; height: number }

type Rect = Size & { x: number; y: number }

/** Bound both the decoded bitmap (64 MB of RGBA) and the compositor's longest surface edge. */
export function captureScale(bounds: Size, pixelRatio: number, maxWidth: number) {
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error("Element or page has no visible screenshot area.")
  const scale = Math.min(1, maxWidth / (bounds.width * pixelRatio))
  const width = Math.ceil(bounds.width * pixelRatio * scale)
  const height = Math.ceil(bounds.height * pixelRatio * scale)

  if (width * height > 16_000_000 || Math.max(width, height) > 16_384)
    throw new Error("Screenshot exceeds 16 megapixels or 16384 pixels on one edge. Reduce maxWidth or capture the viewport or an element.")

  return scale
}

/** Intersect in actual bitmap pixels. Round outward so a fractional overlap includes the pixel it touches. */
export function cropPixels(clip: Rect, image: Size, viewWidth: number, zoom: number) {
  if (viewWidth <= 0 || clip.width <= 0 || clip.height <= 0) return
  const ratio = image.width / viewWidth * zoom
  const x = Math.max(0, Math.floor(clip.x * ratio))
  const y = Math.max(0, Math.floor(clip.y * ratio))
  const right = Math.min(image.width, Math.ceil((clip.x + clip.width) * ratio))
  const bottom = Math.min(image.height, Math.ceil((clip.y + clip.height) * ratio))

  if (right > x && bottom > y) return { x, y, width: right - x, height: bottom - y }
}

type Schedule = (ms: number, run: () => void) => () => void

const schedule: Schedule = (ms, run) => {
  const timer = setTimeout(run, ms)

  return () => clearTimeout(timer)
}

/** One native frame consumer per tab, held only by outstanding captures that need it. */
export function captureCoordinator(begin: () => void, end: () => void, after: Schedule = schedule) {
  let holders = 0

  return async <T>(presented: boolean, signal: AbortSignal, redraw: (stop: AbortSignal) => Promise<T>, deadline = CAPTURE_DEADLINE_MS) => {
    const cancel = () => new Error("Browser capture was cancelled.")

    if (signal.aborted) throw cancel()
    const stop = new AbortController()
    const interrupted = Promise.withResolvers<never>()

    const interrupt = (error: Error) => {
      interrupted.reject(error)
      stop.abort()
    }

    const aborted = () => interrupt(cancel())
    let held = false

    const acquire = () => {
      if (!holders) begin()
      holders++
      held = true
    }

    // A visible surface may become occluded after the redraw starts.
    const fallback = presented ? after(100, () => {
      try {
        acquire()
      } catch (error) {
        interrupt(error instanceof Error ? error : new Error(String(error)))
      }
    }) : undefined

    const timeout = after(deadline, () => interrupt(new Error(undrawableMessage("stalled", deadline))))
    signal.addEventListener("abort", aborted, { once: true })

    try {
      if (!presented) acquire()

      return await Promise.race([redraw(stop.signal), interrupted.promise])
    } finally {
      signal.removeEventListener("abort", aborted)
      timeout()
      fallback?.()

      if (held && --holders === 0) end()
    }
  }
}

/** CDP produced a PNG. Read its IHDR dimensions before deciding whether decoding and resizing are necessary. */
export function pngFits(png: Buffer, maxWidth: number, maxBytes: number) {
  if (png.length < 24 || png.length > maxBytes) return false
  const width = png.readUInt32BE(16)

  return width > 0 && width <= maxWidth && png.readUInt32BE(20) > 0
}

/** CDP produced a JPEG. Read its frame header dimensions, as for a PNG, so the final encoding needs no decode. */
export function jpegFits(jpeg: Buffer, maxWidth: number, maxBytes: number) {
  if (jpeg.length < 4 || jpeg.length > maxBytes || jpeg.readUInt16BE(0) !== 0xffd8) return false

  for (let at = 2; at + 9 <= jpeg.length; at += 2 + jpeg.readUInt16BE(at + 2)) {
    const marker = jpeg[at + 1]

    if (jpeg[at] !== 0xff || marker === 0xd9 || marker === 0xda) return false

    // Start-of-frame markers; 0xc4, 0xc8 and 0xcc share the range but are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const width = jpeg.readUInt16BE(at + 7)

      return width > 0 && width <= maxWidth && jpeg.readUInt16BE(at + 5) > 0
    }
  }

  return false
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

const causes: Record<Exclude<Undrawable, "stalled">, string> = {
  minimized: "The OpenCode window is minimized, so the system does not draw this tab.",
  hidden: "OpenCode is hidden, so the system does not draw this tab.",
}

export function undrawableMessage(reason: Undrawable, deadline = CAPTURE_DEADLINE_MS) {
  if (reason === "stalled") return `No fresh frame of this tab arrived within ${deadline / 1000} seconds. No cached screenshot was returned. Check that the page has finished navigating and is responsive before retrying.`

  return `${causes[reason]} A screenshot needs the window restored. Ask the user to restore the OpenCode window, then take the screenshot again; do not repeat it before then. Clicks, typing and other browser actions still work.`
}
