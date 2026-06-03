import type { JSX } from "solid-js"
import { WordmarkV2 } from "@opencode-ai/ui/v2/components/wordmark-v2.jsx"

export function NewSessionDesignView(props: { children: JSX.Element }) {
  return (
    <div data-component="session-new-design" class="relative size-full overflow-hidden bg-v2-background-bg-deep">
      <div class="absolute inset-x-0 flex justify-center px-6" style={{ top: "clamp(3.5rem, 18vh, 9.5rem)" }}>
        <div class="w-full max-w-[720px]">
          <WordmarkV2 aria-hidden="true" class="h-auto w-full select-none text-v2-icon-icon-base opacity-[0.06]" />
          <div class="mt-5">{props.children}</div>
        </div>
      </div>
    </div>
  )
}
