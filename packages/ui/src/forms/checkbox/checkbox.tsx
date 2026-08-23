import { Control, Description, ErrorMessage, Indicator, Input, Label, Root } from "@kobalte/core/checkbox"
import { Show, splitProps } from "solid-js"
import type { ComponentProps, JSX, ParentProps } from "solid-js"

export interface CheckboxProps extends ParentProps<ComponentProps<typeof Root>> {
  hideLabel?: boolean
  description?: string
  icon?: JSX.Element
}

export function Checkbox(props: CheckboxProps) {
  const [local, others] = splitProps(props, ["children", "class", "label", "hideLabel", "description", "icon"])
  return (
    <Root {...others} data-component="checkbox">
      <Input data-slot="checkbox-checkbox-input" />
      <Control data-slot="checkbox-checkbox-control">
        <Indicator data-slot="checkbox-checkbox-indicator">
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
        </Indicator>
      </Control>
      <div data-slot="checkbox-checkbox-content">
        <Show when={props.children}>
          <Label data-slot="checkbox-checkbox-label" classList={{ "sr-only": local.hideLabel }}>
            {props.children}
          </Label>
        </Show>
        <Show when={local.description}>
          <Description data-slot="checkbox-checkbox-description">{local.description}</Description>
        </Show>
        <ErrorMessage data-slot="checkbox-checkbox-error" />
      </div>
    </Root>
  )
}
