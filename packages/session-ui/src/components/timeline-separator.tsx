import { ProviderIcon } from "@opencode/ui/provider-icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Show } from "solid-js"

export function TimelineSeparator(props: {
  label: string
  value?: string
  tooltip?: string
  providerID?: string
  variant?: string
}) {
  const label = () => (
    <bdi
      data-slot="session-timeline-notice-label"
      dir="auto"
      class="block truncate"
      classList={{ "shrink-0": !!props.value }}
      title={props.tooltip ? undefined : props.label}
    >
      {props.label}
    </bdi>
  )

  return (
    <div class="flex h-8 w-full items-center gap-3 text-v2-text-text-faint">
      <span class="h-px min-w-0 flex-1 bg-v2-border-border-strong" />
      <span class="flex min-w-0 items-center gap-1 text-[13px] font-[440] leading-text-compact tracking-[-0.04px]">
        <Show when={props.providerID}>
          {(providerID) => <ProviderIcon id={providerID()} class="text-v2-icon-icon-faint" aria-hidden="true" />}
        </Show>
        <span class="flex min-w-0 items-center gap-1.5">
          <Show when={props.tooltip} fallback={label()}>
            {(tooltip) => (
              <Tooltip
                appearance="compact"
                placement="top"
                value={tooltip()}
                class={props.value ? "min-w-0 shrink-0" : "min-w-0"}
                triggerTabIndex={0}
              >
                {label()}
              </Tooltip>
            )}
          </Show>
          <Show when={props.value}>
            {(value) => (
              <bdi data-slot="session-timeline-notice-value" dir="ltr" class="min-w-0 truncate" title={value()}>
                {value()}
              </bdi>
            )}
          </Show>
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
