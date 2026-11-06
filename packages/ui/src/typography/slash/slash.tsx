import "./slash.css"

/**
 * The "/" between path segments, such as project / session or provider / model: the neighbouring text's height in its
 * regular weight, with `gap` px of visible space on each side (6 by default). `gap={0}` leaves the spacing to the parent.
 */
export function Slash(props: { gap?: number; class?: string }) {
  return (
    <span
      data-component="slash"
      class={props.class}
      style={props.gap === undefined ? undefined : { "--slash-gap": `${props.gap}px` }}
      aria-hidden="true"
    />
  )
}
