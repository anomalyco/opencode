import { motionTuning } from "@opencode/ui/motion-tuning"
import { Match, Switch } from "solid-js"
import { createStore } from "solid-js/store"

const meta = {
  group: "Experiments",
  card: "Header separator",
  order: 40,
  description: "The mark between the project and session names in the header.",
  target: '[data-slot="session-title-separator"]',
}

const glyph = motionTuning.choice("sessionHeader.separator", {
  label: "Style",
  ...meta,
  value: "chevron",
  labels: { divider: "Divider", slash: "Slash", chevron: "Chevron", bold: "Bold chevron", dot: "Dot" },
})

const size = motionTuning.number("sessionHeader.separator.size", {
  label: "Size",
  ...meta,
  value: 11,
  min: 6,
  max: 24,
  step: 1,
  unit: "px",
})

const weight = motionTuning.number("sessionHeader.separator.weight", {
  label: "Weight",
  ...meta,
  value: 1,
  min: 0.5,
  max: 3,
  step: 0.25,
  unit: "px",
})

const opacity = motionTuning.number("sessionHeader.separator.opacity", {
  label: "Opacity",
  ...meta,
  value: 1,
  min: 0.2,
  max: 1,
  step: 0.05,
})

const gap = motionTuning.number("sessionHeader.separator.gap", {
  label: "Gap (ink to ink)",
  ...meta,
  value: 10,
  min: 4,
  max: 20,
  step: 0.5,
  unit: "px",
})

const read = () => ({ glyph: glyph(), size: size(), weight: weight(), opacity: opacity(), gap: gap() })

const [tuning, setTuning] = createStore(read())

motionTuning.subscribe(() => setTuning(read()))

/**
 * Sits between breadcrumb segments with `gap` of visible space on both sides. `before` and `after` are the space the
 * neighbouring segments already leave between their ink and this element, so the margins make up the rest.
 */
export function SessionHeaderSeparator(props: { before?: number; after?: number }) {
  // The ink of every glyph fills its box, so the gap is exact; the text beside it keeps ~0.5px of side bearing.
  const width = () => {
    if (tuning.glyph === "divider") return tuning.weight

    if (tuning.glyph === "dot") return tuning.size / 4

    return tuning.size * 0.45
  }

  const stroke = () => tuning.weight * (tuning.glyph === "bold" ? 2 : 1)

  return (
    <span
      data-slot="session-title-separator"
      data-glyph={tuning.glyph}
      class="session-header-separator text-v2-text-text-faint"
      style={{
        "--separator-gap": `${tuning.gap}px`,
        "--separator-before": props.before === undefined ? undefined : `${props.before}px`,
        "--separator-after": props.after === undefined ? undefined : `${props.after}px`,
        opacity: tuning.opacity,
      }}
      aria-hidden="true"
    >
      <Switch>
        <Match when={tuning.glyph === "divider"}>
          <span class="block rounded-full bg-current" style={{ width: `${width()}px`, height: `${tuning.size}px` }} />
        </Match>
        <Match when={tuning.glyph === "dot"}>
          <span class="block rounded-full bg-current" style={{ width: `${width()}px`, height: `${width()}px` }} />
        </Match>
        <Match when={tuning.glyph === "slash"}>
          <span class="session-header-slash" />
        </Match>
        <Match when={true}>
          <svg
            class="block fill-none stroke-current"
            width={width()}
            height={tuning.size}
            viewBox={`0 0 ${width()} ${tuning.size}`}
            stroke-width={stroke()}
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d={`M${stroke() / 2} ${stroke() / 2}L${width() - stroke() / 2} ${tuning.size / 2}L${stroke() / 2} ${tuning.size - stroke() / 2}`}
            />
          </svg>
        </Match>
      </Switch>
    </span>
  )
}
