import { Content, Header, Item, Root, Trigger } from "@kobalte/core/accordion"
import { splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"

export interface AccordionProps extends Omit<ComponentProps<typeof Root>, "value"> {
  /** Controlled expanded items. Kobalte reads this iterable into its own selection; it never mutates this array. */
  value?: readonly string[]
}

export interface AccordionItemProps extends ComponentProps<typeof Item> {}

export interface AccordionHeaderProps extends ComponentProps<typeof Header> {}

export interface AccordionTriggerProps extends ComponentProps<typeof Trigger> {}

export interface AccordionContentProps extends ComponentProps<typeof Content> {}

function AccordionRoot(props: AccordionProps) {
  const [split, rest] = splitProps(props, ["class", "classList", "value"])

  // SAFETY: Kobalte's createMultipleSelectionState copies selectedKeys into a Selection before changing it.
  return (
    <Root
      {...rest}
      value={split.value as string[] | undefined}
      data-component="accordion"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

function AccordionItem(props: AccordionItemProps) {
  const [split, rest] = splitProps(props, ["class", "classList"])

  return (
    <Item
      {...rest}
      data-slot="accordion-item"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

function AccordionHeader(props: ParentProps<AccordionHeaderProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <Header
      {...rest}
      data-slot="accordion-header"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Header>
  )
}

function AccordionTrigger(props: ParentProps<AccordionTriggerProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <Trigger
      {...rest}
      data-slot="accordion-trigger"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Trigger>
  )
}

function AccordionContent(props: ParentProps<AccordionContentProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <Content
      {...rest}
      data-slot="accordion-content"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Content>
  )
}

export const Accordion = Object.assign(AccordionRoot, {
  Item: AccordionItem,
  Header: AccordionHeader,
  Trigger: AccordionTrigger,
  Content: AccordionContent,
})
