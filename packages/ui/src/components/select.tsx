import { Select as Kobalte } from "@kobalte/core/select"
import { createMemo, splitProps, type ComponentProps, type JSX } from "solid-js"
import { pipe, groupBy, entries, map } from "remeda"
import { Button, ButtonProps } from "./button"
import { Icon } from "./icon"

export type SelectProps<T> = Omit<ComponentProps<typeof Kobalte<T>>, "value" | "onSelect" | "children"> & {
  placeholder?: string
  options: T[]
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string
  groupBy?: (x: T) => string
  onSelect?: (value: T | undefined) => void
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  children?: (item: T | undefined) => JSX.Element
}

export function Select<T>(props: SelectProps<T> & ButtonProps) {
  const [local, others] = splitProps(props, [
    "class",
    "classList",
    "placeholder",
    "options",
    "current",
    "value",
    "label",
    "groupBy",
    "onSelect",
    "children",
  ])
  const grouped = createMemo(() => {
    const result = pipe(
      local.options,
      groupBy((x) => (local.groupBy ? local.groupBy(x) : "")),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
      map(([k, v]) => ({ category: k, options: v })),
    )
    return result
  })

  return (
    // @ts-ignore
    <Kobalte<T, { category: string; options: T[] }>
      {...others}
      data-component="select"
      placement="bottom-start"
      value={local.current}
      options={grouped()}
      optionValue={(x) => (local.value ? local.value(x) : (x as string))}
      optionTextValue={(x) => (local.label ? local.label(x) : (x as string))}
      optionGroupChildren="options"
      placeholder={local.placeholder}
      sectionComponent={(local) => (
        <Kobalte.Section data-slot="select-section">{local.section.rawValue.category}</Kobalte.Section>
      )}
      itemComponent={(itemProps) => (
        <Kobalte.Item
          data-slot="select-select-item"
          classList={{
            ...(local.classList ?? {}),
            [local.class ?? ""]: !!local.class,
          }}
          {...itemProps}
        >
          <Kobalte.ItemLabel data-slot="select-select-item-label">
            {local.children
              ? local.children(itemProps.item.rawValue)
              : local.label
                ? local.label(itemProps.item.rawValue)
                : (itemProps.item.rawValue as string)}
          </Kobalte.ItemLabel>
          <Kobalte.ItemIndicator data-slot="select-select-item-indicator">
            <Icon name="check-small" size="small" />
          </Kobalte.ItemIndicator>
        </Kobalte.Item>
      )}
      onChange={(v) => {
        local.onSelect?.(v ?? undefined)
      }}
    >
      <Kobalte.Trigger
        disabled={props.disabled}
        data-slot="select-select-trigger"
        as={Button}
        size={props.size}
        variant={props.variant}
        classList={{
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
      >
        <Kobalte.Value<T> data-slot="select-select-trigger-value">
          {(state) => {
            const selected = state.selectedOption() ?? local.current
            if (!selected) return local.placeholder || ""
            if (local.label) return local.label(selected)
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
            ...(local.classList ?? {}),
            [local.class ?? ""]: !!local.class,
          }}
          data-component="select-content"
        >
          <Kobalte.Listbox data-slot="select-select-content-list" />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
