import { TablerIcon } from "../../components/tabler-icon"
import { Checkbox as Kobalte } from "@kobalte/core/checkbox"
import { Show, splitProps, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import "./checkbox-v2.css"

export interface CheckboxV2Props extends ComponentProps<typeof Kobalte> {
  label: JSX.Element
  description?: JSX.Element
  hideLabel?: boolean
}

export function CheckboxV2(props: CheckboxV2Props) {
  const [local, others] = splitProps(props, ["class", "classList", "label", "description", "hideLabel"])
  return (
    <Kobalte
      {...others}
      data-slot="checkbox-v2"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <div data-slot="checkbox-v2-row">
        <Kobalte.Input data-slot="checkbox-v2-input" />
        <div data-slot="checkbox-v2-control-stack">
          <Kobalte.Control data-slot="checkbox-v2-control">
            <Kobalte.Indicator data-slot="checkbox-v2-indicator">
              <TablerIcon
                name="check"
                class="checkbox-v2-icon checkbox-v2-icon--check"
                width="16"
                height="16"
                aria-hidden="true"
                style={{ color: "#fff" }}
              />
              <TablerIcon
                name="dash"
                class="checkbox-v2-icon checkbox-v2-icon--minus"
                width="16"
                height="16"
                aria-hidden="true"
                style={{ color: "#fff" }}
              />
            </Kobalte.Indicator>
          </Kobalte.Control>
        </div>
        <Kobalte.Label data-slot="checkbox-v2-label" classList={{ "sr-only": local.hideLabel }}>
          <div data-slot="checkbox-v2-text">
            <span data-slot="checkbox-v2-label-text">{local.label}</span>
            <Show when={local.description}>
              {(description) => <span data-slot="checkbox-v2-description">{description()}</span>}
            </Show>
          </div>
        </Kobalte.Label>
      </div>
      <Kobalte.ErrorMessage data-slot="checkbox-v2-error" />
    </Kobalte>
  )
}
