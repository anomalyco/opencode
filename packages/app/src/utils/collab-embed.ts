/**
 * Helpers for detecting when the opencode UI is rendered inside the collab
 * iframe (packages/app/src/pages/collab/session.tsx renders an <iframe> that
 * points back at this same app with `?embed=collab&cs=<collabSessionId>`).
 *
 * When embedded:
 *   - The opencode-internal prompt input ("Ask anything…") is hidden — the
 *     collab page's own prompt box is the authoritative input.
 *   - The project sidebar is replaced with the list of collab sessions, so
 *     clicking the hamburger lets the user switch between collab sessions.
 *
 * SSR-safe: returns false when `window` is unavailable.
 */

const EMBED_KEY = "embed"
const EMBED_VALUE = "collab"
const COLLAB_SESSION_KEY = "cs"

// sessionStorage keys — sessionStorage is scoped per-tab, so the iframe gets
// its own copy independent of the parent collab page.
const SS_EMBED = "opencode.collab.embed"
const SS_SESSION = "opencode.collab.embedSession"

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window
}

function searchParams(): URLSearchParams | null {
  const w = safeWindow()
  return w ? new URLSearchParams(w.location.search) : null
}

/**
 * Read the embed flag from the URL on first call and remember it in
 * sessionStorage, so subsequent in-iframe navigations (which may drop the
 * query string) still see the embed mode.
 */
function syncEmbedFlag(): boolean {
  const w = safeWindow()
  if (!w) return false
  const params = new URLSearchParams(w.location.search)
  if (params.get(EMBED_KEY) === EMBED_VALUE) {
    try {
      w.sessionStorage.setItem(SS_EMBED, "1")
      const cs = params.get(COLLAB_SESSION_KEY)
      if (cs) w.sessionStorage.setItem(SS_SESSION, cs)
    } catch {
      // sessionStorage may be unavailable in sandboxed contexts; ignore.
    }
    return true
  }
  try {
    return w.sessionStorage.getItem(SS_EMBED) === "1"
  } catch {
    return false
  }
}

/** True when the current page is rendered inside the collab iframe. */
export function isCollabEmbed(): boolean {
  return syncEmbedFlag()
}

/** The collab session ID we're embedded inside, if any. */
export function collabEmbedSessionId(): string | null {
  const w = safeWindow()
  if (!w) return null
  const fromUrl = searchParams()?.get(COLLAB_SESSION_KEY)
  if (fromUrl) return fromUrl
  try {
    return w.sessionStorage.getItem(SS_SESSION)
  } catch {
    return null
  }
}

/**
 * Navigate the *top* window (out of the iframe) to a collab session URL.
 * Use this when the user picks a different collab session from the
 * embedded sidebar — we want to replace the whole collab page, not the
 * iframe contents.
 */
export function navigateTopToCollabSession(collabSessionId: string): void {
  const top = window.top ?? window
  top.location.href = `/collab/${collabSessionId}`
}
