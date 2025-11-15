import { Accordion } from "@opencode-ai/ui"
import { ParentProps } from "solid-js"

export function StickyAccordionHeader(props: ParentProps<{ class?: string }>) {
  return (
    <Accordion.Header
      classList={{
        "sticky top-0 data-expanded:z-10": true,
        "data-expanded:before:content-[''] data-expanded:before:z-[-10]": true,
        "data-expanded:before:absolute data-expanded:before:inset-0 data-expanded:before:bg-background-stronger": true,
        [props.class ?? ""]: !!props.class,
      }}
    >
      {props.children}
    </Accordion.Header>
  )
}
