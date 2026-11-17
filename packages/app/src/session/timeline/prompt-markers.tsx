import { createMemo, For, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"

/** A user prompt's place in the timeline, drawn as one mark on the rail beside the scrollbar. */
export type PromptMarker = {
  /** The row that aligns at the top when this prompt is chosen. */
  index: number
  /** The user message's ID, which marks the prompt the view currently rests on. */
  id: string
  /** The prompt's own number among the session's prompts, which a mark shared by several still reports. */
  ordinal: number
}

type PromptMarkersProps = {
  /** Top of the rail, below the header the timeline keeps over its rows. */
  top: number
  markers: Accessor<readonly PromptMarker[]>
  /** Where the prompt's row starts in the timeline's content, from 0 at the top to 1 at the bottom. */
  fraction: (id: string) => number
  /** The prompt whose turn the view currently shows. */
  activeID: Accessor<string | undefined>
  /** The prompt's text as the timeline shows it, read only for the preview. */
  text: (id: string) => string
  onJump: (index: number) => void
}

/**
 * The prompts of a long session, drawn as a rail beside the scrollbar: hovering one previews it, and choosing one
 * scrolls the timeline to it. Positions come from the rows' measured starts, so the rail survives streaming rows and
 * never measures the DOM.
 */
export function PromptMarkers(props: PromptMarkersProps) {
  const language = useLanguage()
  // SAFETY: widens the initial `undefined` so the store can name the prompt under the pointer later.
  const [state, setState] = createStore({ preview: undefined as string | undefined })

  const preview = createMemo(() => {
    if (!state.preview) return
    const marker = props.markers().find((marker) => marker.id === state.preview)

    if (!marker) return
    const text = props.text(marker.id)

    return text ? { marker, text } : undefined
  })

  return (
    <div
      data-slot="session-prompt-markers"
      role="group"
      aria-label={language.t("session.timeline.markers.label")}
      class="pointer-events-none absolute z-[90]"
      // Clear of the scrollbar's 12px lane: the pill sits where the rows' content padding ends.
      style={{ top: `${props.top + 8}px`, bottom: "8px", "inset-inline-end": "10px", width: "12px" }}
      onPointerLeave={() => setState("preview", undefined)}
    >
      <For each={props.markers()}>
        {(marker) => {
          const active = () => props.activeID() === marker.id

          return (
            <button
              type="button"
              class="group pointer-events-auto absolute grid h-2 w-full -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
              style={{ top: `${props.fraction(marker.id) * 100}%` }}
              aria-label={language.t("session.timeline.markers.goto", { index: marker.ordinal })}
              aria-current={active() ? "true" : undefined}
              onPointerEnter={() => setState("preview", marker.id)}
              onFocusIn={() => setState("preview", marker.id)}
              onFocusOut={() => setState("preview", undefined)}
              onClick={() => {
                setState("preview", undefined)
                props.onJump(marker.index)
              }}
            >
              <span
                class="block rounded-full transition-[width,height,background-color] duration-150 ease-out group-hover:h-2.5 group-hover:bg-v2-text-text-base group-focus-visible:h-2.5 group-focus-visible:bg-v2-text-text-base"
                classList={{
                  "h-1.5 w-[3px] bg-v2-text-text-muted": !active(),
                  "h-2.5 w-1 bg-v2-text-text-base": active(),
                }}
              />
            </button>
          )
        }}
      </For>
      <Show when={preview()}>
        {(item) => (
          <div
            data-slot="session-prompt-markers-preview"
            class="pointer-events-none absolute w-64 rounded-md border-[0.5px] border-v2-border-border-muted p-2 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-base"
            style={{
              // Kept inside the rail's own height, so the first and last prompts still preview in view.
              top: `clamp(45px, ${props.fraction(item().marker.id) * 100}%, calc(100% - 45px))`,
              "inset-inline-end": "100%",
              "margin-inline-end": "10px",
              transform: "translateY(-50%)",
              "background-color": "var(--v2-background-bg-layer-01)",
              "box-shadow": "var(--v2-elevation-floating)",
            }}
          >
            <p dir="auto" class="line-clamp-3 break-words">
              {item().text}
            </p>
          </div>
        )}
      </Show>
    </div>
  )
}
