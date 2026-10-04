import { Contract, type SessionRef } from "../sdk"

export interface Browser {
  /** The desktop browser pane exists for this session (the session is attached to a pane). */
  attached(session: SessionRef): boolean
  /** A workspace file (relative path) or http(s) URL can open in the pane for this session. */
  canOpen(session: SessionRef, path?: string): boolean
  /** Opens a URL (http(s) or file://) as a browser tab in the session's side panel. */
  open(session: SessionRef, url: string): void
  /** Opens a workspace file (relative path) as a file:// browser tab. Check `canOpen(session, path)` first. */
  openFile(session: SessionRef, path: string): void
}

/** The browser extension provides this on desktop. Inactive on web or while the extension is off. */
export const Browser = Contract.define<Browser, "browser">("browser")
