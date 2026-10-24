import type { Accessor } from "solid-js"

/**
 * The single polite live region that names the running turn's phase. It stays mounted while the
 * session is routed, so a screen reader announces the phase each time the text changes.
 */
export function TurnStatusAnnouncer(props: { status: Accessor<string> }) {
  return (
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {props.status()}
    </p>
  )
}
