import { Show } from "solid-js"
import { clearBrowserAnnotations } from "@/context/annotation-actions"
import { useAnnotationStore } from "@/context/annotation-store"

export function AnnotationCapsule() {
  const annotations = useAnnotationStore()
  const count = () => annotations.store.annotations.length
  const label = () => (count() === 1 ? "1 anotación" : `${count()} anotaciones`)

  return (
    <Show when={count() > 0}>
      <div class="px-3 pt-3">
        <div
          data-component="prompt-annotation-capsule"
          class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-[6px] bg-background-stronger pl-2 pr-1 text-11-regular font-medium text-text-weak shadow-xs-border"
        >
          <span class="truncate">{label()}</span>
          <button
            type="button"
            class="flex size-4.5 items-center justify-center rounded-[4px] text-text-weaker transition-colors hover:bg-surface-interactive-hover hover:text-text-strong focus:outline-none focus-visible:bg-surface-interactive-hover focus-visible:text-text-strong focus-visible:shadow-xs-border-focus"
            onClick={() => clearBrowserAnnotations(annotations)}
            aria-label="Clear annotations"
          >
            ×
          </button>
        </div>
      </div>
    </Show>
  )
}
