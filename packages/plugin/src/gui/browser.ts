import { Contract } from "./core.js"
import type { SessionRef } from "./host-apis.js"

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
   * Opens a URL (http(s) or file://) as a browser tab in the session's side panel.
   *
   * @param session - The session whose pane opens it.
   * @param url - The URL to open.
   */
  open(session: SessionRef, url: string): void
  /**
   * Opens a workspace file (relative path) as a file:// browser tab. Check `canOpen(session, path)` first.
   *
   * @param session - The session whose pane opens it.
   * @param path - The workspace-relative file path.
   */
  openFile(session: SessionRef, path: string): void
}

/** The browser plugin provides this on desktop. Inactive on web or while the plugin is off. */
export const Browser = Contract.define<Browser, "browser">("browser")
