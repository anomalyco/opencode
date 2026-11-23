import type { JSX } from "solid-js"

/** A full error in a scrollable, selectable block, above the actions that resolve it. */
export function ErrorDetails(props: { error: string; children: JSX.Element }) {
  return (
    <div data-component="error-details">
      <pre data-slot="error-details-text" tabIndex={0}>
        {props.error}
      </pre>
      <div data-slot="error-details-actions">{props.children}</div>
    </div>
  )
}
