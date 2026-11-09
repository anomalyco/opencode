import { Slash } from "@opencode/ui/slash"

/**
 * The slash between breadcrumb segments, with `gap` px of visible space on both sides. `before` and `after` are the
 * space the neighbouring segments already leave between their ink and this element, so the margins make up the rest.
 */
export function SessionHeaderSeparator(props: { gap: number; before: number; after: number }) {
  return (
    <span
      data-slot="session-title-separator"
      class="session-header-separator"
      style={{
        "--separator-gap": `${props.gap}px`,
        "--separator-before": `${props.before}px`,
        "--separator-after": `${props.after}px`,
      }}
      aria-hidden="true"
    >
      <Slash gap={0} />
    </span>
  )
}
