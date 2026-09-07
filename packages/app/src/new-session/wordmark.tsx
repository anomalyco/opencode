import { Wordmark } from "@opencode-ai/ui/wordmark"
import "./wordmark.css"

export function NewSessionWordmark() {
  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px] text-v2-background-bg-inverse"
    >
      <div data-slot="wordmark-reveal" class="relative">
        <Wordmark fade={false} class="block h-auto w-full opacity-60 [[data-color-scheme=dark]_&]:opacity-50" />
        <Wordmark fade={false} muted={false} class="wordmark-shimmer absolute inset-0 h-auto w-full" />
      </div>
    </div>
  )
}
