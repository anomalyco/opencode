import { Select as Kobalte } from "@kobalte/core/select"
import { createMemo, type ComponentProps } from "solid-js"
import { pipe, groupBy, entries, map } from "remeda"
import { Button, ButtonProps } from "./button"
import { Icon } from "./icon"

export interface SelectProps<T> {
  placeholder?: string
  options: T[]
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string
  groupBy?: (x: T) => string
  onSelect?: (value: T | undefined) => void
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
}

export function Select<T>(props: SelectProps<T> & ButtonProps) {
  const grouped = createMemo(() => {
    const result = pipe(
      props.options,
      groupBy((x) => (props.groupBy ? props.groupBy(x) : "")),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
      map(([k, v]) => ({ category: k, options: v })),
    )
    return result
  })

  return (
    <Kobalte<T, { category: string; options: T[] }>
      data-component="select"
      value={props.current}
      options={grouped()}
      optionValue={(x) => (props.value ? props.value(x) : (x as string))}
      optionTextValue={(x) => (props.label ? props.label(x) : (x as string))}
      optionGroupChildren="options"
      placeholder={props.placeholder}
      sectionComponent={(props) => (
        <Kobalte.Section data-slot="select-section">{props.section.rawValue.category}</Kobalte.Section>
      )}
      itemComponent={(itemProps) => (
        <Kobalte.Item
          data-slot="select-select-item"
          classList={{
            ...(props.classList ?? {}),
            [props.class ?? ""]: !!props.class,
          }}
          {...itemProps}
        >
          <Kobalte.ItemLabel data-slot="select-select-item-label">
            {props.label ? props.label(itemProps.item.rawValue) : (itemProps.item.rawValue as string)}
          </Kobalte.ItemLabel>
          <Kobalte.ItemIndicator data-slot="select-select-item-indicator">
            <Icon name="check-small" size="small" />
          </Kobalte.ItemIndicator>
        </Kobalte.Item>
      )}
      onChange={(v) => {
        props.onSelect?.(v ?? undefined)
      }}
    >
      <Kobalte.Trigger
        data-slot="select-select-trigger"
        as={Button}
        size={props.size}
        variant={props.variant}
        classList={{
          ...(props.classList ?? {}),
          [props.class ?? ""]: !!props.class,
        }}
      >
        <Kobalte.Value<T> data-slot="select-select-trigger-value">
          {(state) => {
            const selected = state.selectedOption() ?? props.current
            if (!selected) return props.placeholder || ""
            if (props.label) return props.label(selected)
            return selected as string
          }}
        </Kobalte.Value>
        <Kobalte.Icon data-slot="select-select-trigger-icon">
          <Icon name="chevron-down" size="small" />
        </Kobalte.Icon>
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          classList={{
            ...(props.classList ?? {}),
            [props.class ?? ""]: !!props.class,
          }}
          data-component="select-content"
        >
          <Kobalte.Listbox data-slot="select-select-content-list" />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
