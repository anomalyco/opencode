import { Control, Description, ErrorMessage, Indicator, Input, Label, Root } from "@kobalte/core/checkbox"
import { Match, Show, Switch, splitProps } from "solid-js"
import type { ComponentProps, JSX, ParentProps } from "solid-js"
import "./checkbox-compact.css"

export interface CheckboxProps extends ParentProps<ComponentProps<typeof Root>> {
  /** `compact` is the design system checkbox; `standard` keeps the legacy look. */
  appearance?: "standard" | "compact"
  /** Background of the compact control. */
  surface?: "base" | "layer-1"
  hideLabel?: boolean
  description?: JSX.Element
  icon?: JSX.Element
}

export function Checkbox(props: CheckboxProps) {
  const [local, others] = splitProps(props, [
    "children",
    "class",
    "label",
    "appearance",
    "surface",
    "hideLabel",
    "description",
    "icon",
  ])

  return (
    <Switch>
      <Match when={local.appearance === "compact"}>
        <Root {...others} class={local.class} data-slot="checkbox-v2" data-surface={local.surface ?? "base"}>
          <div data-slot="checkbox-v2-row">
            <Input data-slot="checkbox-v2-input" />
            <div data-slot="checkbox-v2-control-stack">
              <Control data-slot="checkbox-v2-control">
                <Indicator data-slot="checkbox-v2-indicator">
                  <svg
                    class="checkbox-v2-icon checkbox-v2-icon--check"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25" stroke="currentColor" stroke-width="1" />
                  </svg>
                  <svg
                    class="checkbox-v2-icon checkbox-v2-icon--minus"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M12.75 8H3.25" stroke="currentColor" stroke-linejoin="round" stroke-width="1" />
                  </svg>
                </Indicator>
              </Control>
            </div>
            <div data-slot="checkbox-v2-text">
              <Show when={local.children}>
                <Label data-slot="checkbox-v2-label" classList={{ "sr-only": local.hideLabel }}>
                  {local.children}
                </Label>
              </Show>
              <Show when={local.description}>
                <Description data-slot="checkbox-v2-description">{local.description}</Description>
              </Show>
            </div>
          </div>
          <ErrorMessage data-slot="checkbox-v2-error" />
        </Root>
      </Match>
      <Match when={true}>
        <Root {...others} class={local.class} data-component="checkbox">
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
      </Match>
    </Switch>
  )
}
