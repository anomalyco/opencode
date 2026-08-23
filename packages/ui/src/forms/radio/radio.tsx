import {
  Description,
  ErrorMessage,
  Item,
  ItemControl,
  ItemIndicator,
  ItemInput,
  ItemLabel,
  Label,
  Root,
} from "@kobalte/core/radio-group"
import { Show, splitProps, type JSX } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"
import "./radio.css"

export interface RadioGroupProps extends ParentProps<ComponentProps<typeof Root>> {
  label?: JSX.Element
  description?: JSX.Element
  hideLabel?: boolean
}

export function RadioGroup(props: RadioGroupProps) {
  const [local, others] = splitProps(props, ["class", "classList", "children", "label", "description", "hideLabel"])
  return (
    <Root
      {...others}
      data-component="radio-v2"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={local.label}>
        {(label) => (
          <Label data-slot="radio-v2-label" classList={{ "sr-only": local.hideLabel }}>
            {label()}
          </Label>
        )}
      </Show>
      <Show when={local.description}>
        {(description) => <Description data-slot="radio-v2-description">{description()}</Description>}
      </Show>
      <div data-slot="radio-v2-items">{local.children}</div>
      <ErrorMessage data-slot="radio-v2-error" />
    </Root>
  )
}

export interface RadioItemProps extends ComponentProps<typeof Item> {
  label: JSX.Element
  description?: JSX.Element
  hideLabel?: boolean
}

export function RadioItem(props: RadioItemProps) {
  const [local, others] = splitProps(props, ["class", "classList", "label", "description", "hideLabel"])
  return (
    <Item
      {...others}
      data-slot="radio-v2-item"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <ItemInput data-slot="radio-v2-item-input" />
      <div data-slot="radio-v2-item-control-stack">
        <ItemControl data-slot="radio-v2-item-control">
          <ItemIndicator data-slot="radio-v2-item-indicator" />
        </ItemControl>
      </div>
      <ItemLabel data-slot="radio-v2-item-label" classList={{ "sr-only": local.hideLabel }}>
        <div data-slot="radio-v2-item-text">
          <span data-slot="radio-v2-item-label-text">{local.label}</span>
          <Show when={local.description}>
            {(description) => <span data-slot="radio-v2-item-description">{description()}</span>}
          </Show>
        </div>
      </ItemLabel>
    </Item>
  )
}
