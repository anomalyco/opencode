/**
 * CLI Selector for Prompt Toolbar
 *
 * Dropdown with CLI options: OpenCode, Claude Code, Codex, Amp.
 * Shows a spinner while connecting to sandbox-agent.
 */

import { Show } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useBackend, AGENT_OPTIONS } from "@claxedo/context/backend"

export function BackendSelectorButton() {
  const backend = useBackend()

  return (
    <Show
      when={!backend.connecting}
      fallback={
        <div class="flex items-center gap-1.5 h-6 px-2 text-12-regular text-text-weak">
          <Spinner class="size-3.5" />
          <span class="truncate">Connecting…</span>
        </div>
      }
    >
      <Select
        options={AGENT_OPTIONS}
        current={AGENT_OPTIONS.find((o) => o.value === backend.agent)}
        value={(o) => o.value}
        label={(o) => o.label}
        onSelect={(option) => {
          if (option) backend.selectAgent(option.value)
        }}
        class="max-w-[120px]"
        valueClass="truncate"
        variant="ghost"
      />
    </Show>
  )
}
