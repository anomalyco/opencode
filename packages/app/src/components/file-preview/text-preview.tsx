import { Show } from "solid-js"
import type { TextPreviewProps } from "./types"

export function TextPreview(props: TextPreviewProps) {
  return (
    <div
      data-component="text-preview"
      class={props.class ?? ""}
    >
      {props.content}
      <Show when={props.truncated}>
        <div data-slot="truncation-notice">
          Content truncated. Showing first 100KB.
        </div>
      </Show>
    </div>
  )
}
