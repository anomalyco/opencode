import { Popover as Kobalte } from "@kobalte/core/popover"
import { ComponentProps, JSXElement, ParentProps, Show, splitProps, ValidComponent } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

export interface PopoverProps<T extends ValidComponent = "div">
  extends ParentProps,
    Omit<ComponentProps<typeof Kobalte>, "children"> {
  trigger?: JSXElement
  triggerAs?: T
  triggerProps?: ComponentProps<T>
  title?: JSXElement
  description?: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  portal?: boolean
}

export function Popover<T extends ValidComponent = "div">(props: PopoverProps<T>) {
  const i18n = useI18n()
  const [local, rest] = splitProps(props, [
    "trigger",
    "triggerAs",
    "triggerProps",
    "title",
    "description",
    "class",
    "classList",
    "children",
    "portal",
  ])

  const content = () => (
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
          <Kobalte.CloseButton
            data-slot="popover-close-button"
            as={IconButton}
            icon="close"
            variant="ghost"
            aria-label={i18n.t("ui.common.close")}
          />
        </div>
      </Show>
      <Show when={local.description}>
        <Kobalte.Description data-slot="popover-description">{local.description}</Kobalte.Description>
      </Show>
      <div data-slot="popover-body">{local.children}</div>
    </Kobalte.Content>
  )

  return (
    <Kobalte gutter={4} {...rest}>
      <Kobalte.Trigger as={local.triggerAs ?? "div"} data-slot="popover-trigger" {...(local.triggerProps as any)}>
        {local.trigger}
      </Kobalte.Trigger>
      <Show when={local.portal ?? true} fallback={content()}>
        <Kobalte.Portal>{content()}</Kobalte.Portal>
      </Show>
    </Kobalte>
  )
}
