import type { JSX } from "solid-js"
import { ScrollView } from "./scroll-view"

/** A full error in a scrollable, selectable block, above the actions that resolve it. */
export function ErrorDetails(props: { error: string; children: JSX.Element }) {
  return (
    <div data-component="error-details">
      <ScrollView data-slot="error-details-scroll">
        <pre data-slot="error-details-text">{props.error}</pre>
      </ScrollView>
      <div data-slot="error-details-actions">{props.children}</div>
    </div>
  )
}
