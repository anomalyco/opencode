export function SectionHeading(props: { href: string; title: string; description?: string; slot?: string }) {
  return (
    <h2 data-slot={props.slot ?? "section-title"}>
      <strong>
        <a data-slot="heading-link" href={props.href}>
          <span data-slot="heading-anchor" aria-hidden="true">
            #
          </span>
          {props.title}
          {props.description ? "." : ""}
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
}
