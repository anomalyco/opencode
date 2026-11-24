import { Contract } from "./core.js"
import type { Brand } from "effect"
import type { SessionRef } from "./host-apis.js"

/** Experimental: an opaque close right, not an agent or layout tab ID. May change without compatibility guarantees. */
export type ExperimentalBrowserTab = string & Brand.Brand<"ExperimentalBrowserTab">

/** What the built-in browser offers other plugins: a session's desktop browser pane. Read it with `ctx.use(Browser)`. */
export interface Browser {
  /**
   * The desktop browser pane exists for this session (the session is attached to a pane).
   *
   * @param session - The session to check.
   * @returns True when the session has a pane.
   */
  attached(session: SessionRef): boolean
  /**
   * A workspace file (relative path) or http(s) URL can open in the pane for this session.
   *
   * @param session - The session whose pane would open it.
   * @param path - A workspace-relative file path or an http(s) URL; omit it to ask whether the pane can open anything.
   * @returns True when `open` or `openFile` would succeed.
   */
  canOpen(session: SessionRef, path?: string): boolean
  /**
   * Opens an HTTP(S) page without embedded credentials. A file:// URL opens as a scoped preview only on the built-in local server and inside the session's workspace. Other file:// URLs are refused; use `openFile` for workspace files on non-built-in servers.
   *
   * @param session - The session whose pane opens it.
   * @param url - The URL to open.
   */
  open(session: SessionRef, url: string): void
  /** Experimental: may change without compatibility guarantees. */
  readonly experimental: {
    /**
     * Opens a new tab and returns an opaque handle for this plugin instance. Resolves once the tab exists, also while its page still loads or after its load failed, which the tab itself shows. Rejects if the pane is unavailable, the session is not on screen, or the address opened no page (as a download does), which leaves no tab.
     * @param session - The session whose pane opens it.
     * @param url - The URL to open.
     */
    open(session: SessionRef, url: string): Promise<ExperimentalBrowserTab>
    /**
     * Requests closure of the tab this instance opened. The handle survives session suspension and rebind, not a plugin or window restart or a takeover navigation.
     * @returns True if closed now. False for unknown, foreign, revoked or already closed handles, or if beforeunload asks for confirmation. The person can still confirm or cancel in the pane.
     * @param id - The handle returned by this plugin's `open`, not an agent or layout tab ID.
     */
    close(id: ExperimentalBrowserTab): Promise<boolean>
  }
  /**
   * Opens a workspace file as a browser tab. Local tabs display file: addresses and remote tabs display workspace: addresses. Check `canOpen(session, path)` first.
   *
   * @param session - The session whose pane opens it.
   * @param path - The workspace-relative file path.
   */
  openFile(session: SessionRef, path: string): void
}

/** The browser plugin provides this on desktop. Inactive on web or while the plugin is off. */
export const Browser = Contract.define<Browser, "browser">("browser")
