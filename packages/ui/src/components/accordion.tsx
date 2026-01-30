import { Accordion as Kobalte } from "@kobalte/core/accordion"
import { Accessor, createContext, splitProps, useContext } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"
import { MorphChevron } from "./morph-chevron"

export interface AccordionProps extends ComponentProps<typeof Kobalte> {}
export interface AccordionItemProps extends ComponentProps<typeof Kobalte.Item> {}
export interface AccordionHeaderProps extends ComponentProps<typeof Kobalte.Header> {}
export interface AccordionTriggerProps extends ComponentProps<typeof Kobalte.Trigger> {}
export interface AccordionContentProps extends ComponentProps<typeof Kobalte.Content> {}

const AccordionItemContext = createContext<Accessor<boolean>>()

function AccordionRoot(props: AccordionProps) {
  const [split, rest] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-component="accordion"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

function AccordionItem(props: AccordionItemProps & { expanded?: boolean }) {
  const [split, rest] = splitProps(props, ["class", "classList", "expanded"])
  return (
    <AccordionItemContext.Provider value={() => split.expanded ?? false}>
      <Kobalte.Item
        {...rest}
        data-slot="accordion-item"
        classList={{
          ...(split.classList ?? {}),
          [split.class ?? ""]: !!split.class,
        }}
      />
    </AccordionItemContext.Provider>
  )
}

function AccordionHeader(props: ParentProps<AccordionHeaderProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Header
      {...rest}
      data-slot="accordion-header"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Kobalte.Header>
  )
}

function AccordionTrigger(props: ParentProps<AccordionTriggerProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Trigger
      {...rest}
      data-slot="accordion-trigger"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Kobalte.Trigger>
  )
}

function AccordionContent(props: ParentProps<AccordionContentProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Content
      {...rest}
      data-slot="accordion-content"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Kobalte.Content>
  )
}

export interface AccordionArrowProps extends ComponentProps<"div"> {
  expanded?: boolean
}

function AccordionArrow(props: AccordionArrowProps = {}) {
  const [local, rest] = splitProps(props, ["expanded"])
  const contextExpanded = useContext(AccordionItemContext)
  const isExpanded = () => local.expanded ?? contextExpanded?.() ?? false
  return (
    <div data-slot="accordion-arrow" {...rest}>
      <MorphChevron expanded={isExpanded()} />
    </div>
  )
}

export const Accordion = Object.assign(AccordionRoot, {
  Item: AccordionItem,
  Header: AccordionHeader,
  Trigger: AccordionTrigger,
  Content: AccordionContent,
  Arrow: AccordionArrow,
})
