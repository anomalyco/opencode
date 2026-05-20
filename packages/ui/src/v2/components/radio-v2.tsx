import { RadioGroup as Kobalte } from "@kobalte/core/radio-group"
import { Show, splitProps, type JSX } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"
import "./radio-v2.css"

export interface RadioGroupV2Props extends ParentProps<ComponentProps<typeof Kobalte>> {
  label?: JSX.Element
  description?: JSX.Element
  hideLabel?: boolean
}

export function RadioGroupV2(props: RadioGroupV2Props) {
  const [local, others] = splitProps(props, ["class", "classList", "children", "label", "description", "hideLabel"])
  return (
    <Kobalte
      {...others}
      data-component="radio-v2"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={local.label}>
        {(label) => (
          <Kobalte.Label data-slot="radio-v2-label" classList={{ "sr-only": local.hideLabel }}>
            {label()}
          </Kobalte.Label>
        )}
      </Show>
      <Show when={local.description}>
        {(description) => (
          <Kobalte.Description data-slot="radio-v2-description">{description()}</Kobalte.Description>
        )}
      </Show>
      <div data-slot="radio-v2-items">{local.children}</div>
      <Kobalte.ErrorMessage data-slot="radio-v2-error" />
    </Kobalte>
  )
}

export interface RadioItemV2Props extends ComponentProps<typeof Kobalte.Item> {
  label: JSX.Element
  description?: JSX.Element
  hideLabel?: boolean
}

export function RadioItemV2(props: RadioItemV2Props) {
  const [local, others] = splitProps(props, ["class", "classList", "label", "description", "hideLabel"])
  return (
    <Kobalte.Item
      {...others}
      data-slot="radio-v2-item"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Kobalte.ItemInput data-slot="radio-v2-item-input" />
      <div data-slot="radio-v2-item-control-stack">
        <Kobalte.ItemControl data-slot="radio-v2-item-control">
          <Kobalte.ItemIndicator data-slot="radio-v2-item-indicator" />
        </Kobalte.ItemControl>
      </div>
      <Kobalte.ItemLabel data-slot="radio-v2-item-label" classList={{ "sr-only": local.hideLabel }}>
        <div data-slot="radio-v2-item-text">
          <span data-slot="radio-v2-item-label-text">{local.label}</span>
          <Show when={local.description}>
            {(description) => (
              <span data-slot="radio-v2-item-description">{description()}</span>
            )}
          </Show>
        </div>
      </Kobalte.ItemLabel>
    </Kobalte.Item>
  )
}

