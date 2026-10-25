import { batch, createEffect, createSignal, untrack } from "solid-js"
import type { SessionRef } from "@opencode/gui-extensions/sdk"

/**
 * Layout writes find a session's stored layout through its location, which is unknown until the server reports it
 * (for example after a server re-authenticates). `hold` keeps such a write and runs it, in order, once the location is
 * known, so no write is lost.
 */
export function createLocatedWrites() {
  const [pending, setPending] = createSignal<readonly { readonly session: SessionRef; readonly run: () => void }[]>([])
  // Syncs held writes with the session locations the server reports.
  createEffect(() => {
    const held = pending()

    if (held.length === 0) return
    const located = held.filter((item) => item.session.location)

    if (located.length === 0) return
    setPending(held.filter((item) => !located.includes(item)))
    untrack(() => batch(() => located.forEach((item) => item.run())))
  })

  return {
    hold(session: SessionRef, run: () => void) {
      setPending((held) => [...held, { session, run }])
    },
  }
}
