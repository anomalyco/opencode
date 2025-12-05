import { TextField as Kobalte } from "@kobalte/core/text-field"
import { Show, splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"

export interface InputProps
  extends ComponentProps<typeof Kobalte.Input>,
    Partial<Pick<ComponentProps<typeof Kobalte>, "value" | "onChange" | "onKeyDown">> {
  label?: string
  hideLabel?: boolean
  description?: string
}

export function Input(props: InputProps) {
  const [local, others] = splitProps(props, [
    "class",
    "label",
    "hideLabel",
    "description",
    "value",
    "onChange",
    "onKeyDown",
  ])
  return (
    <Kobalte data-component="input" value={local.value} onChange={local.onChange} onKeyDown={local.onKeyDown}>
      <Show when={local.label}>
        <Kobalte.Label data-slot="input-label" classList={{ "sr-only": local.hideLabel }}>
          {local.label}
        </Kobalte.Label>
      </Show>
      <Kobalte.Input {...others} data-slot="input-input" class={local.class} />
      <Show when={local.description}>
        <Kobalte.Description data-slot="input-description">{local.description}</Kobalte.Description>
      </Show>
      <Kobalte.ErrorMessage data-slot="input-error" />
    </Kobalte>
  )
}
