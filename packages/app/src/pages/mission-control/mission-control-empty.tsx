import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Show } from "solid-js"
import type { MissionControlController } from "./mission-control-controller"

export function MissionControlEmpty(props: { controller: MissionControlController }) {
  const filtering = () => props.controller.data.total() > 0

  return (
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p class="text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-base [font-weight:530]">
        {filtering() ? "Nothing matches this filter" : "No agent sessions yet"}
      </p>
      <p class="max-w-[360px] text-[13px] leading-5 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
        {filtering()
          ? "No agent work matches this search. Clear it to see the full operational queue."
          : "Start a session in any project and it will show up here with its live status, approvals, and changes."}
      </p>
      <Show when={filtering()}>
        <ButtonV2 size="normal" variant="neutral" onClick={() => props.controller.filter.setQuery("")}>
          Clear filters
        </ButtonV2>
      </Show>
    </div>
  )
}
