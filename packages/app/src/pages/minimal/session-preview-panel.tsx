import { Show } from "solid-js"
import { createSessionPreview } from "@/pages/session/session-preview"

export function SessionPreviewPanel() {
  const { previewSrc } = createSessionPreview()

  return (
    <Show when={previewSrc()}>
      {(src) => (
        <div class="flex-1 min-w-0 h-full bg-background-base border-l border-border-weaker-base">
          <iframe
            src={src()}
            class="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      )}
    </Show>
  )
}
