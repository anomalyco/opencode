import { createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { TimelineQuote } from "./quote"

const docs = `### Overview
The toolbar over text selected in the session timeline. **Quote** attaches the selection to the composer and opens its comment editor (see App/Quotes/Quote comment); Alt+click attaches it without opening the editor.

A selection longer than a quote can carry shows **Selection too long** and disables Quote.
`

export default {
  title: "App/Quotes/Timeline quote",
  id: "session-timeline-quote",
  parameters: { docs: { description: { component: docs } } },
}

const base = { truncated: false }

function measure(passage: HTMLElement, selected: HTMLElement) {
  const bounds = passage.getBoundingClientRect()

  const extent = selected.getBoundingClientRect()

  return {
    text: selected.textContent ?? "",
    bounds: { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right },
    extent: {
      top: extent.top,
      bottom: extent.bottom,
      left: extent.left,
      right: extent.right,
      short: true,
      backward: false,
    },
  }
}

export const Toolbar = {
  args: base,
  render: (args: typeof base) => {
    const [view, setView] = createSignal<ReturnType<typeof measure>>()

    const [result, setResult] = createSignal("")

    const [elements, setElements] = createStore<{ passage?: HTMLElement; selected?: HTMLElement }>({})

    onMount(() => {
      if (!elements.passage || !elements.selected) return
      // A real selection, as the timeline shows it under the toolbar.
      const range = document.createRange()

      range.selectNodeContents(elements.selected)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      setView(measure(elements.passage, elements.selected))
    })

    return (
      <div>
        <div
          ref={(element) => setElements("passage", element)}
          class="w-[480px] py-16 text-[14px] leading-[var(--line-height-base)] text-v2-text-text-base"
        >
          The composer clears once the prompt is in flight.{" "}
          <span ref={(element) => setElements("selected", element)}>
            A failed send restores the draft, unless the user typed something new meanwhile.
          </span>{" "}
          Queued prompts appear in the queue on admission.
        </div>
        <output aria-label="Quote result">{result()}</output>
        <TimelineQuote
          controller={{
            toolbar: () => {
              const current = view()

              return current && { ...current, truncated: args.truncated }
            },
            setElement() {},
            add: (skip: boolean) => setResult(skip ? "Quoted without comment" : "Quoted"),
          }}
        />
      </div>
    )
  },
}

/** A selection longer than a quote can carry. */
export const TooLong = { args: { truncated: true }, render: Toolbar.render }
