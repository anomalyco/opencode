import { Accordion } from "./accordion"
import { splitProps, type ParentProps } from "solid-js"

export function StickyAccordionHeader(
  props: ParentProps<{
    ref?: (el: HTMLDivElement) => void
    class?: string
    classList?: Record<string, boolean | undefined>
  }>,
) {
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
