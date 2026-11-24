import { For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Predicate } from "effect"
import type { ActiveKey } from "@opentui/keymap"
import { Keybind } from "@opencode/ui/keybind"
import { useCommand } from "@/shell/commands/command"

/** While a chord is in progress, lists the keys that continue it and what each runs. */
export function KeySequenceHint() {
  const command = useCommand()

  const label = (key: ActiveKey) =>
    Predicate.isString(key.command) ? (command.title(key.command) ?? key.command) : undefined

  return (
    <Show when={command.pending.sequence.length > 0}>
      <Portal>
        <div
          data-component="key-sequence-hint"
          role="status"
          class="pointer-events-none fixed bottom-6 left-1/2 z-50 flex max-h-[60vh] min-w-[240px] -translate-x-1/2 flex-col gap-2 overflow-hidden rounded-xl bg-v2-background-bg-base p-3 text-[13px] leading-[var(--line-height-compact)] shadow-[var(--v2-elevation-floating)]"
        >
          <Keybind keys={command.pending.sequence.flatMap((part) => command.strokeParts(part))} variant="neutral" />
          <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            <For each={command.pending.next}>
              {(key) => (
                <>
                  <Keybind keys={command.strokeParts(key)} variant="ghost" />
                  <span class="truncate text-v2-text-text-base">{key.continues ? "…" : (label(key) ?? "")}</span>
                </>
              )}
            </For>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
