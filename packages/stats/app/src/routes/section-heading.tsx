export function SectionHeading(props: {
  href: string
  title: string
  description: string
  as?: "h2" | "p"
  slot?: string
}) {
  const content = (
    <>
      <strong>
        <a data-slot="heading-link" href={props.href}>
          <span data-slot="heading-anchor" aria-hidden="true">
            #
          </span>
          {props.title}.
        </a>
      </strong>{" "}
      <span>{props.description}</span>
    </>
  )

  if (props.as === "h2") return <h2 data-slot={props.slot ?? "section-title"}>{content}</h2>
  return <p data-slot={props.slot ?? "section-title"}>{content}</p>
}
