import { Portal } from "solid-js/web"
import { Icon } from "./icon"

export function FileSearchBar(props: {
  pos: () => { top: number; right: number }
  query: () => string
  index: () => number
  count: () => number
  setInput: (el: HTMLInputElement) => void
  onInput: (value: string) => void
  onKeyDown: (event: KeyboardEvent) => void
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <Portal>
      <div
        class="fixed z-50 flex h-8 items-center gap-2 rounded-md border border-border-base bg-background-base px-3 shadow-md"
        style={{
          top: `${props.pos().top}px`,
          right: `${props.pos().right}px`,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Icon name="magnifying-glass" size="small" class="text-text-weak shrink-0" />
        <input
          ref={props.setInput}
          placeholder="Find"
          value={props.query()}
          class="w-40 bg-transparent outline-none text-14-regular text-text-strong placeholder:text-text-weak"
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={(e) => props.onKeyDown(e as KeyboardEvent)}
        />
        <div class="shrink-0 text-12-regular text-text-weak tabular-nums text-right" style={{ width: "10ch" }}>
          {props.count() ? `${props.index() + 1}/${props.count()}` : "0/0"}
        </div>
        <div class="flex items-center">
          <button
            type="button"
            class="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong disabled:opacity-40 disabled:pointer-events-none"
            disabled={props.count() === 0}
            aria-label="Previous match"
            onClick={props.onPrev}
          >
            <Icon name="chevron-down" size="small" class="rotate-180" />
          </button>
          <button
            type="button"
            class="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong disabled:opacity-40 disabled:pointer-events-none"
            disabled={props.count() === 0}
            aria-label="Next match"
            onClick={props.onNext}
          >
            <Icon name="chevron-down" size="small" />
          </button>
        </div>
        <button
          type="button"
          class="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong"
          aria-label="Close search"
          onClick={props.onClose}
        >
          <Icon name="close-small" size="small" />
        </button>
      </div>
    </Portal>
  )
}
