import { Slash } from "@opencode/ui/slash"
import { Show } from "solid-js"

// The chevron's height and stroke, and the visible space on each side of a separator, in px.
const size = 11

const stroke = 1

const gap = 10

// The chevron's ink fills its box, so the gap is exact; the text beside it keeps ~0.5px of side bearing.
const width = size * 0.45

/**
 * Sits between breadcrumb segments with `gap` of visible space on both sides. `before` and `after` are the space the
 * neighbouring segments already leave between their ink and this element, so the margins make up the rest.
 */
export function SessionHeaderSeparator(props: {
  before?: number
  after?: number
  glyph?: "chevron" | "slash"
  gap?: number
}) {
  return (
    <span
      data-slot="session-title-separator"
      data-glyph={props.glyph ?? "chevron"}
      class="session-header-separator text-v2-text-text-faint"
      style={{
        "--separator-gap": `${props.gap ?? gap}px`,
        "--separator-before": props.before === undefined ? undefined : `${props.before}px`,
        "--separator-after": props.after === undefined ? undefined : `${props.after}px`,
      }}
      aria-hidden="true"
    >
      <Show when={props.glyph !== "slash"} fallback={<Slash gap={0} />}>
        <svg
          class="block fill-none stroke-current"
          width={width}
          height={size}
          viewBox={`0 0 ${width} ${size}`}
          stroke-width={stroke}
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d={`M${stroke / 2} ${stroke / 2}L${width - stroke / 2} ${size / 2}L${stroke / 2} ${size - stroke / 2}`}
          />
        </svg>
      </Show>
    </span>
  )
}
