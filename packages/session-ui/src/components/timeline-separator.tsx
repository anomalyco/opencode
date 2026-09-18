import { Mark } from "@opencode/ui/logo"
import { Show } from "solid-js"

export function TimelineSeparator(props: { label: string; logo?: boolean; variant?: string }) {
  return (
    <div class="flex h-8 w-full items-center gap-3 text-v2-text-text-faint">
      <span class="h-px min-w-0 flex-1 bg-v2-border-border-strong" />
      <span class="flex min-w-0 items-center gap-1 text-[13px] font-[440] leading-text-compact tracking-[-0.04px]">
        <Show when={props.logo}>
          <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            <Mark class="h-4 w-[13px]" />
          </span>
        </Show>
        <span class="flex min-w-0 items-center gap-1.5">
          <bdi dir="auto" class="truncate" title={props.label}>
            {props.label}
          </bdi>
          <Show when={props.variant && props.variant !== "default" ? props.variant : undefined}>
            {(variant) => (
              <>
                <span class="flex size-1.5 shrink-0 items-center justify-center" aria-hidden="true">
                  <span class="size-[2.25px] rounded-full bg-current" />
                </span>
                <span data-slot="session-timeline-notice-variant" class="shrink-0 capitalize">
                  {variant()}
                </span>
              </>
            )}
          </Show>
        </span>
      </span>
      <span class="h-px min-w-0 flex-1 bg-v2-border-border-strong" />
    </div>
  )
}
