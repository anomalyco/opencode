import { SegmentedControl as Kobalte } from "@kobalte/core/segmented-control"
import { For, splitProps } from "solid-js"
import type { ComponentProps, JSX } from "solid-js"

export type RadioGroupProps<T> = Omit<
  ComponentProps<typeof Kobalte>,
  "value" | "defaultValue" | "onChange" | "children"
> & {
  options: T[]
  current?: T
  defaultValue?: T
  value?: (x: T) => string
  label?: (x: T) => JSX.Element | string
  onSelect?: (value: T | undefined) => void
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  size?: "small" | "medium"
}

export function RadioGroup<T>(props: RadioGroupProps<T>) {
  const [local, others] = splitProps(props, [
    "class",
    "classList",
    "options",
    "current",
    "defaultValue",
    "value",
    "label",
    "onSelect",
    "size",
  ])

  const getValue = (item: T): string => {
    if (local.value) return local.value(item)
    return String(item)
  }

  const getLabel = (item: T): JSX.Element | string => {
    if (local.label) return local.label(item)
    return String(item)
  }

  const findOption = (v: string): T | undefined => {
    return local.options.find((opt) => getValue(opt) === v)
  }

  return (
    <Kobalte
      {...others}
      data-component="radio-group"
      data-size={local.size ?? "medium"}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      value={local.current ? getValue(local.current) : undefined}
      defaultValue={local.defaultValue ? getValue(local.defaultValue) : undefined}
      onChange={(v) => local.onSelect?.(findOption(v))}
    >
      <div role="presentation" data-slot="radio-group-wrapper">
        <Kobalte.Indicator data-slot="radio-group-indicator" />
        <div role="presentation" data-slot="radio-group-items">
          <For each={local.options}>
            {(option) => (
              <Kobalte.Item value={getValue(option)} data-slot="radio-group-item">
                <Kobalte.ItemInput data-slot="radio-group-item-input" />
                <Kobalte.ItemLabel data-slot="radio-group-item-label">{getLabel(option)}</Kobalte.ItemLabel>
              </Kobalte.Item>
            )}
          </For>
        </div>
      </div>
    </Kobalte>
  )
}
