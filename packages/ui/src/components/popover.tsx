import { Popover as Kobalte } from "@kobalte/core/popover"
import { ComponentProps, JSXElement, ParentProps, Show, splitProps } from "solid-js"
import { IconButton } from "./icon-button"

export interface PopoverProps extends ParentProps, Omit<ComponentProps<typeof Kobalte>, "children"> {
  trigger: JSXElement
  title?: JSXElement
  description?: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
}

export function Popover(props: PopoverProps) {
  const [local, rest] = splitProps(props, ["trigger", "title", "description", "class", "classList", "children"])

  return (
    <Kobalte gutter={4} {...rest}>
      <Kobalte.Trigger as="div" data-slot="popover-trigger">
        {local.trigger}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          data-component="popover-content"
          classList={{
            ...(local.classList ?? {}),
            [local.class ?? ""]: !!local.class,
          }}
        >
          {/* <Kobalte.Arrow data-slot="popover-arrow" /> */}
          <Show when={local.title}>
            <div data-slot="popover-header">
              <Kobalte.Title data-slot="popover-title">{local.title}</Kobalte.Title>
              <Kobalte.CloseButton data-slot="popover-close-button" as={IconButton} icon="close" variant="ghost" />
            </div>
          </Show>
          <Show when={local.description}>
            <Kobalte.Description data-slot="popover-description">{local.description}</Kobalte.Description>
          </Show>
          <div data-slot="popover-body">{local.children}</div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
