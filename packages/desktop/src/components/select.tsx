import { Select as KobalteSelect } from "@kobalte/core/select"
import { createMemo } from "solid-js"
import type { ComponentProps } from "solid-js"
import { Icon } from "@/ui/icon"
import { pipe, groupBy, entries, map } from "remeda"
import { Button, type ButtonProps } from "@/ui"

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
    <KobalteSelect<T, { category: string; options: T[] }>
      value={props.current}
      options={grouped()}
      optionValue={(x) => (props.value ? props.value(x) : (x as string))}
      optionTextValue={(x) => (props.label ? props.label(x) : (x as string))}
      optionGroupChildren="options"
      placeholder={props.placeholder}
      sectionComponent={(props) => (
        <KobalteSelect.Section class="text-xs uppercase text-text-muted/60 font-light mt-3 first:mt-0 ml-2">
          {props.section.rawValue.category}
        </KobalteSelect.Section>
      )}
      itemComponent={(itemProps) => (
        <KobalteSelect.Item
          classList={{
            "relative flex cursor-pointer select-none items-center": true,
            "rounded-sm px-2 py-0.5 text-xs outline-none text-text": true,
            "transition-colors data-[disabled]:pointer-events-none": true,
            "data-[highlighted]:bg-background-element data-[disabled]:opacity-50": true,
            [props.class ?? ""]: !!props.class,
          }}
          {...itemProps}
        >
          <KobalteSelect.ItemLabel>
            {props.label ? props.label(itemProps.item.rawValue) : (itemProps.item.rawValue as string)}
          </KobalteSelect.ItemLabel>
          <KobalteSelect.ItemIndicator class="ml-auto">
            <Icon name="checkmark" size={16} />
          </KobalteSelect.ItemIndicator>
        </KobalteSelect.Item>
      )}
      onChange={(v) => {
        props.onSelect?.(v ?? undefined)
      }}
    >
      <KobalteSelect.Trigger
        as={Button}
        size={props.size || "sm"}
        variant={props.variant || "secondary"}
        classList={{
          ...(props.classList ?? {}),
          [props.class ?? ""]: !!props.class,
        }}
      >
        <KobalteSelect.Value<T>>
          {(state) => {
            const selected = state.selectedOption() ?? props.current
            if (!selected) return props.placeholder || ""
            if (props.label) return props.label(selected)
            return selected as string
          }}
        </KobalteSelect.Value>
        <KobalteSelect.Icon
          classList={{
            "size-fit shrink-0 text-text-muted transition-transform duration-100 data-[expanded]:rotate-180": true,
          }}
        >
          <Icon name="chevron-down" size={24} />
        </KobalteSelect.Icon>
      </KobalteSelect.Trigger>
      <KobalteSelect.Portal>
        <KobalteSelect.Content
          classList={{
            "min-w-32 overflow-hidden rounded-md border border-border-subtle/40": true,
            "bg-background-panel p-1 shadow-md z-50": true,
            "data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95": true,
            "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95": true,
          }}
        >
          <KobalteSelect.Listbox class="overflow-y-auto max-h-48" />
        </KobalteSelect.Content>
      </KobalteSelect.Portal>
    </KobalteSelect>
  )
}
