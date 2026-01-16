import { HoverCard as Kobalte } from "@kobalte/core/hover-card"
import { ComponentProps, JSXElement, ParentProps, splitProps } from "solid-js"

export interface HoverCardProps extends ParentProps, Omit<ComponentProps<typeof Kobalte>, "children"> {
  trigger: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
}

export function HoverCard(props: HoverCardProps) {
  const [local, rest] = splitProps(props, ["trigger", "class", "classList", "children"])

  return (
    <Kobalte gutter={4} {...rest}>
      <Kobalte.Trigger as="div" data-slot="hover-card-trigger">
        {local.trigger}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          data-component="hover-card-content"
          classList={{
            ...(local.classList ?? {}),
            [local.class ?? ""]: !!local.class,
          }}
        >
          <div data-slot="hover-card-body">{local.children}</div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
