import { Accordion as Kobalte } from "@kobalte/core/accordion"
import { Show, splitProps, type Component, type ComponentProps, type ParentProps } from "solid-js"
import "./accordion-v2.css"

const ChevronDown: Component = () => (
  <svg
    data-slot="accordion-v2-chevron"
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M4 5.5L7 8.5L10 5.5" stroke="currentColor" />
  </svg>
)

export interface AccordionV2Props extends ComponentProps<typeof Kobalte> {}
export interface AccordionV2ItemProps extends ComponentProps<typeof Kobalte.Item> {}
export interface AccordionV2HeaderProps extends ComponentProps<typeof Kobalte.Header> {}
export interface AccordionV2TriggerProps extends ComponentProps<typeof Kobalte.Trigger> {
  hideChevron?: boolean
}
export interface AccordionV2ContentProps extends ComponentProps<typeof Kobalte.Content> {}

function AccordionV2Root(props: ParentProps<AccordionV2Props>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte
      {...r}
      data-component="accordion-v2"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

function AccordionV2Item(props: ParentProps<AccordionV2ItemProps>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte.Item
      {...r}
      data-component="accordion-v2-item"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

function AccordionV2Header(props: ParentProps<AccordionV2HeaderProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Header
      {...r}
      data-slot="accordion-v2-header"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      {s.children}
    </Kobalte.Header>
  )
}

function AccordionV2Trigger(props: ParentProps<AccordionV2TriggerProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children", "hideChevron"])
  return (
    <Kobalte.Trigger
      {...r}
      data-component="accordion-v2-trigger"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <span data-slot="accordion-v2-trigger-content">{s.children}</span>
      <Show when={!s.hideChevron}>
        <ChevronDown />
      </Show>
    </Kobalte.Trigger>
  )
}

function AccordionV2Content(props: ParentProps<AccordionV2ContentProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Content
      {...r}
      data-component="accordion-v2-content"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <div data-slot="accordion-v2-content-inner">{s.children}</div>
    </Kobalte.Content>
  )
}

export const AccordionV2 = Object.assign(AccordionV2Root, {
  Item: AccordionV2Item,
  Header: AccordionV2Header,
  Trigger: AccordionV2Trigger,
  Content: AccordionV2Content,
})
