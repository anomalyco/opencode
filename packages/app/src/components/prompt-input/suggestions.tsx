import { For, Show, createMemo } from "solid-js"
import { useSync } from "@/context/sync"

export function PromptSuggestions(props: {
  visible: boolean
  onSelect: (text: string) => void
}) {
  const sync = useSync()
  const prompts = createMemo(() => {
    const cfg = sync.data.config as { prompts?: { label: string; text: string }[] }
    return cfg.prompts ?? []
  })

  return (
    <Show when={props.visible && prompts().length > 0}>
      <div
        data-component="prompt-suggestions"
        class="flex gap-1.5 px-3 pb-1.5 pt-0.5 overflow-x-auto no-scrollbar"
      >
        <For each={prompts()}>
          {(item) => (
            <button
              type="button"
              class="shrink-0 px-2.5 py-1 rounded-full border border-border-weak-base bg-surface-raised-base text-12-regular text-text-base hover:bg-surface-raised-stronger hover:text-text-strong transition-colors cursor-pointer truncate max-w-[200px]"
              title={item.text}
              onClick={() => props.onSelect(item.text)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
