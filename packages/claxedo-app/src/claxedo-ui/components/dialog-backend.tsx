/**
 * Backend Switcher Dialog (for command palette / keybind access)
 *
 * Shows agent options with sandbox-agent URL configuration.
 */

import { For } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useBackend, AGENT_OPTIONS } from "@claxedo/context/backend"
import { useDialog } from "@opencode-ai/ui/context/dialog"

export function DialogBackend() {
  const backend = useBackend()
  const dialog = useDialog()

  return (
    <Dialog title="Switch Backend" fit>
      <div class="flex flex-col gap-2 px-6 pb-4">
        <For each={AGENT_OPTIONS}>
          {(option) => (
            <button
              type="button"
              class="flex items-center gap-3 p-3 rounded-lg border transition-colors text-left"
              classList={{
                "border-border-accent bg-surface-info-base/10": backend.agent === option.value,
                "border-border-weak hover:bg-surface-raised-base-hover": backend.agent !== option.value,
              }}
              onClick={() => {
                backend.selectAgent(option.value)
                dialog.close()
              }}
            >
              <div
                classList={{
                  "size-2 rounded-full shrink-0": true,
                  "bg-icon-success-base": backend.agent === option.value,
                  "bg-border-weak-base": backend.agent !== option.value,
                }}
              />
              <span class="text-14-medium text-text-base">{option.label}</span>
              <div class="flex-1" />
              {backend.agent === option.value && (
                <Icon name="check" size="small" class="text-icon-accent" />
              )}
            </button>
          )}
        </For>
      </div>
    </Dialog>
  )
}
