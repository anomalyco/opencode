import { Predicate } from "effect"
import type { JsonObject } from "./protocol.ts"
import { getObject, getString, isRestrictedUrl } from "./relay-helpers.ts"

/**
 * How a root-session `Page.*` event about a child frame should reach CDP
 * clients once the relay knows the frame is protected.
 *
 * - `forward`: an ordinary frame event.
 * - `suppress`: the frame is protected; clients must not learn about it.
 * - `retract`: the frame just became protected after its attach was already
 *   forwarded; emit a synthetic `Page.frameDetached` so clients drop it.
 * - `restore`: a protected frame navigated back to an ordinary document; emit
 *   a synthetic `Page.frameAttached` before forwarding the navigation.
 */
export type ProtectedFrameDecision =
  | { readonly kind: "forward" }
  | { readonly kind: "suppress" }
  | { readonly kind: "retract"; readonly frameId: string }
  | { readonly kind: "restore"; readonly frameId: string; readonly parentFrameId: string }

const navigationIntentMethods = new Set(["Page.frameRequestedNavigation", "Page.frameScheduledNavigation", "Page.frameStartedNavigating"])

/**
 * Tracks child frames whose document is a restricted URL, such as a password
 * manager's `chrome-extension://` inline menu injected into the page.
 *
 * Chrome reports such a frame to the tab's root session like any other child
 * frame, but the relay can never expose its target, so a stock Playwright
 * client would keep an empty-URL phantom frame forever. While the frame exists
 * `chrome.debugger` also rejects every command for the tab; that block is
 * tracked separately by the relay and lifted when the last protected frame in
 * the tab goes away.
 */
export class ProtectedFrameTracker {
  private readonly framesByTab = new Map<number, Set<string>>()

  has(tabId: number, frameId: string): boolean {
    return this.framesByTab.get(tabId)?.has(frameId) ?? false
  }

  hasAny(tabId: number): boolean {
    return (this.framesByTab.get(tabId)?.size ?? 0) > 0
  }

  /** Mark a frame protected. Returns true when it was not already tracked. */
  mark(tabId: number, frameId: string): boolean {
    const frames = this.framesByTab.get(tabId) ?? new Set<string>()
    if (frames.has(frameId)) return false
    frames.add(frameId)
    this.framesByTab.set(tabId, frames)
    return true
  }

  /** Forget one frame. Returns true when it was the tab's last protected frame. */
  release(tabId: number, frameId: string): boolean {
    const frames = this.framesByTab.get(tabId)
    if (!frames?.delete(frameId)) return false
    if (frames.size > 0) return false
    this.framesByTab.delete(tabId)
    return true
  }

  forgetTab(tabId: number): void {
    this.framesByTab.delete(tabId)
  }

  /**
   * Classify a root-session `Page.*` event. Only child frames are ever
   * protected; the main frame is left to root-target handling, so a frame is
   * marked only with positive evidence that it has a parent.
   */
  observe(options: {
    readonly tabId: number
    readonly method: string
    readonly params: JsonObject | undefined
    readonly mainFrameId: string | undefined
    /** Whether a `Page.frameAttached` with a parent was seen for this frame. */
    readonly isChildFrame: (frameId: string) => boolean
  }): ProtectedFrameDecision {
    const { tabId, method, params } = options
    if (!method.startsWith("Page.") || !params) return { kind: "forward" }
    const frame = getObject(params.frame)
    const frameId = getString(params, "frameId") ?? getString(frame, "id")
    if (!frameId || frameId === options.mainFrameId) return { kind: "forward" }
    const frameUrl = getString(frame, "url")
    const parentId = getString(frame, "parentId")
    const intentUrl = navigationIntentMethods.has(method) ? getString(params, "url") : undefined

    if (this.has(tabId, frameId)) {
      if (method === "Page.frameDetached") {
        this.release(tabId, frameId)
        return { kind: "suppress" }
      }
      if (method === "Page.frameNavigated" && frameUrl !== undefined && !isRestrictedUrl(frameUrl) && Predicate.isString(parentId)) {
        this.release(tabId, frameId)
        return { kind: "restore", frameId, parentFrameId: parentId }
      }
      return { kind: "suppress" }
    }

    const restricted = intentUrl !== undefined
      ? isRestrictedUrl(intentUrl) && options.isChildFrame(frameId)
      : method === "Page.frameNavigated" && Predicate.isString(parentId) && isRestrictedUrl(frameUrl)
    if (!restricted) return { kind: "forward" }
    this.mark(tabId, frameId)
    return { kind: "retract", frameId }
  }
}
