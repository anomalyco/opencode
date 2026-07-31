import { createMemo, For, Show } from "solid-js"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { useLocal } from "@/context/local"

const MODES = ["build", "plan"] as const

export function AgentModeBar() {
  const local = useLocal()

  const modes = createMemo(() => {
    const names = new Set(local.agent.list().map((agent) => agent.name))
    return MODES.filter((mode) => names.has(mode))
  })

  const current = createMemo(() => local.agent.current()?.name)
  const visible = createMemo(() => modes().length > 0)

  return (
    <Show when={visible()}>
      <div data-component="agent-mode-bar" class="flex w-full items-center">
        <SegmentedControlV2
          value={current()}
          onChange={(value) => {
            if (value === "build" || value === "plan") local.agent.set(value)
          }}
          class="gap-0.5 rounded-[6px] bg-v2-overlay-simple-overlay p-0.5"
          aria-label="Agent mode"
        >
          <For each={modes()}>
            {(mode) => (
              <SegmentedControlItemV2
                value={mode}
                class="h-6 min-w-14 rounded-[4px] px-2 text-[12px] font-medium uppercase tracking-[0.06em] text-v2-text-text-muted transition-colors data-[pressed]:bg-v2-background-bg-base data-[pressed]:text-v2-text-text-base data-[pressed]:shadow-[var(--v2-elevation-raised)]"
              >
                {mode}
              </SegmentedControlItemV2>
            )}
          </For>
        </SegmentedControlV2>
      </div>
    </Show>
  )
}
