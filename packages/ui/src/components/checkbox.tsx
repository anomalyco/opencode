import { Checkbox as Kobalte } from "@kobalte/core/checkbox"
import { Show, splitProps } from "solid-js"
import type { ComponentProps, JSX, ParentProps } from "solid-js"

export interface CheckboxProps extends ParentProps<ComponentProps<typeof Kobalte>> {
  hideLabel?: boolean
  description?: string
  icon?: JSX.Element
}

export function Checkbox(props: CheckboxProps) {
  const [local, others] = splitProps(props, ["children", "class", "label", "hideLabel", "description", "icon"])
  return (
    <Kobalte {...others} data-component="checkbox">
      <Kobalte.Input data-slot="checkbox-checkbox-input" />
      <Kobalte.Control data-slot="checkbox-checkbox-control">
        <Kobalte.Indicator data-slot="checkbox-checkbox-indicator">
          {local.icon || (
            <svg viewBox="0 0 12 12" fill="none" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M3 7.17905L5.02703 8.85135L9 3.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="square"
              />
            </svg>
          )}
        </Kobalte.Indicator>
      </Kobalte.Control>
      <div data-slot="checkbox-checkbox-content">
        <Show when={props.children}>
          <Kobalte.Label data-slot="checkbox-checkbox-label" classList={{ "sr-only": local.hideLabel }}>
            {props.children}
          </Kobalte.Label>
        </Show>
        <Show when={local.description}>
          <Kobalte.Description data-slot="checkbox-checkbox-description">{local.description}</Kobalte.Description>
        </Show>
        <Kobalte.ErrorMessage data-slot="checkbox-checkbox-error" />
      </div>
    </Kobalte>
  )
}
