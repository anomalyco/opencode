import { TextField as Kobalte } from "@kobalte/core/text-field"
import { Show, splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"

export interface InputProps extends ComponentProps<typeof Kobalte> {
  label?: string
  hideLabel?: boolean
  description?: string
}

export function Input(props: InputProps) {
  const [local, others] = splitProps(props, ["class", "label", "hideLabel", "description", "placeholder"])
  return (
    <Kobalte {...others} data-component="input">
      <Show when={local.label}>
        <Kobalte.Label data-slot="label" classList={{ "sr-only": local.hideLabel }}>
          {local.label}
        </Kobalte.Label>
      </Show>
      <Kobalte.Input data-slot="input" class={local.class} placeholder={local.placeholder} />
      <Show when={local.description}>
        <Kobalte.Description data-slot="description">{local.description}</Kobalte.Description>
      </Show>
      <Kobalte.ErrorMessage data-slot="error" />
    </Kobalte>
  )
}
