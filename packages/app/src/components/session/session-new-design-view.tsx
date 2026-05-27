import type { JSX } from "solid-js"
import { WordmarkV2 } from "@opencode-ai/ui/v2/components/wordmark-v2.jsx"

export function NewSessionDesignView(props: { children: JSX.Element }) {
  return (
    <div data-component="session-new-design" class="relative size-full overflow-hidden bg-v2-background-bg-deep">
      <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
        <div class="w-full max-w-[720px]">
          <WordmarkV2 class="h-auto w-full text-v2-icon-icon-base" />
          <div class="mt-8">{props.children}</div>
        </div>
      </div>
    </div>
  )
}
