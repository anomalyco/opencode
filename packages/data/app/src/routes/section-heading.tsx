import type { JSX } from "solid-js"

export function SectionHeading(props: {
  href: string
  title: string
  description?: string
  slot?: string
  action?: JSX.Element
  share?: JSX.Element
}) {
  const heading = (
    <h2 data-slot={props.slot ?? "section-title"}>
      <strong>
        <a data-slot="heading-link" href={props.href}>
          <span data-slot="heading-anchor" aria-hidden="true">
            #
          </span>
          {props.title}
          {props.description && <span data-slot="heading-stop">.</span>}
        </a>
      </strong>
      {props.description && (
        <>
          {" "}
          <span>{props.description}</span>
        </>
      )}
    </h2>
  )
  // Read once: every read of a JSX prop renders it again.
  const action = props.action
  const share = props.share
  if (!action && !share) return heading
  return (
    <div data-slot="section-heading-row">
      {heading}
      {share ? (
        <div data-slot="section-actions">
          {action}
          {share}
        </div>
      ) : (
        action
      )}
    </div>
  )
}
