import { Switch as Kobalte } from "@kobalte/core/switch"
import { Show, splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"

export interface SwitchProps extends ParentProps<ComponentProps<typeof Kobalte>> {
  hideLabel?: boolean
  description?: string
}

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ["children", "class", "hideLabel", "description"])
  return (
    <Kobalte {...others} data-component="switch">
      <Kobalte.Input data-slot="switch-input" />
      <Show when={local.children}>
        <Kobalte.Label data-slot="switch-label" classList={{ "sr-only": local.hideLabel }}>
          {local.children}
        </Kobalte.Label>
      </Show>
      <Show when={local.description}>
        <Kobalte.Description data-slot="switch-description">{local.description}</Kobalte.Description>
      </Show>
      <Kobalte.ErrorMessage data-slot="switch-error" />
      <Kobalte.Control data-slot="switch-control">
        <Kobalte.Thumb data-slot="switch-thumb" />
      </Kobalte.Control>
    </Kobalte>
  )
}
