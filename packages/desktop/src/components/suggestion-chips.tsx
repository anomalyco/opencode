import { For } from "solid-js"

interface SuggestionChipsProps {
  suggestions: string[]
  onSelect: (suggestion: string) => void
  class?: string
}

export default function SuggestionChips(props: SuggestionChipsProps) {
  return (
    <div class={`flex flex-wrap gap-2 justify-center ${props.class ?? ""}`}>
      <For each={props.suggestions}>
        {(suggestion) => (
          <button
            onClick={() => props.onSelect(suggestion)}
            class="px-3 py-1.5 text-xs rounded-full bg-background-element/50 text-text-muted
                   hover:bg-background-element hover:text-text border border-border-subtle/40
                   hover:border-border-active transition-all duration-200"
          >
            {suggestion}
          </button>
        )}
      </For>
    </div>
  )
}
