import { createRequire } from "node:module"
import { relayLog } from "./relay-log.ts"

type Progress = { race<T>(promise: Promise<T>): Promise<T> }
type Selectors = {
  _hasClosedShadowRoots?: () => Promise<boolean>
  queryCount(selector: string): Promise<number>
  queryAll(selector: string): Promise<unknown[]>
}
type Frame = {
  selectors: Selectors
  isNonRetriableError(error: unknown): boolean
  queryCount?: (progress: Progress, selector: string) => Promise<number>
  querySelectorAll?: (progress: Progress, selector: string) => Promise<unknown[]>
}
type ServerPage = { mainFrame(): Frame }

/**
 * Patchright finds elements its own way so it can reach into closed shadow roots: it walks the DOM over CDP,
 * describing every match. Through the extension that's fine for actions, but calls that return many elements are
 * slow: on a 4,000-element page `getByRole("link").count()` took ~650 ms (Playwright: ~9 ms), and before every
 * count()/evaluateAll()/all() it also pulled the whole DOM tree (DOM.getDocument depth -1) to look for closed
 * shadow roots, ~0.2-2 s. Playwright never reached into closed shadow roots, so count() and querySelectorAll()
 * go back to Playwright's lookup (Patchright's injected script, in the isolated world, which pages can't see) and
 * the shadow-root scan is off.
 *
 * The classes aren't exported; they're reached through the first page's main frame. If a Patchright update renames
 * these internals, nothing breaks: lookups stay correct but slower, and relay.log says so.
 */
export function tunePatchright() {
  const { server } = createRequire(import.meta.url)("patchright-core/lib/coreBundle") as { server?: { Page?: { prototype: ServerPage } } }
  const page = server?.Page?.prototype
  const mainFrame = page?.mainFrame
  if (!page || typeof mainFrame !== "function") {
    relayLog("patchright.tuning", { applied: false, reason: "server.Page.mainFrame not found" })
    return
  }
  page.mainFrame = function () {
    const frame = mainFrame.call(this)
    page.mainFrame = mainFrame
    const frames = Object.getPrototypeOf(frame) as Frame
    const selectors = Object.getPrototypeOf(frame.selectors) as Selectors
    if (typeof selectors._hasClosedShadowRoots !== "function" || typeof frames.queryCount !== "function" || typeof frames.querySelectorAll !== "function") {
      relayLog("patchright.tuning", { applied: false, reason: "Frame or FrameSelectors internals changed" })
      return frame
    }
    selectors._hasClosedShadowRoots = async () => false
    frames.querySelectorAll = function (progress, selector) {
      return progress.race(this.selectors.queryAll(selector))
    }
    frames.queryCount = async function (progress, selector) {
      return progress.race(this.selectors.queryCount(selector)).catch((error: unknown) => {
        if (this.isNonRetriableError(error)) throw error
        return 0
      })
    }
    return frame
  }
}
