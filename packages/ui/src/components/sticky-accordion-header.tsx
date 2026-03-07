import { Accordion, type AccordionHeaderProps } from "./accordion"
import { splitProps, type ParentProps } from "solid-js"

export function StickyAccordionHeader(props: ParentProps<AccordionHeaderProps & { ref?: (el: HTMLElement) => void }>) {
  const [local, rest] = splitProps(props, ["ref", "class", "classList", "children"])

  return (
    <Accordion.Header
      ref={local.ref}
      data-component="sticky-accordion-header"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...rest}
    >
      {local.children}
    </Accordion.Header>
  )
}
