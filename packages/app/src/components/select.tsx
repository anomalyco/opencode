import { Select as KobalteSelect } from "@kobalte/core/select"
import { createEffect, createMemo, Show } from "solid-js"
import type { ComponentProps } from "solid-js"
import { Icon } from "@/ui/icon"
import fuzzysort from "fuzzysort"
import { pipe, groupBy, entries, map } from "remeda"
import { createStore } from "solid-js/store"

export interface SelectProps<T> {
  variant?: "default" | "outline"
  size?: "sm" | "md" | "lg"
  placeholder?: string
  filter?:
    | false
    | {
        placeholder?: string
        keys: string[]
      }
  options: T[]
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string
  groupBy?: (x: T) => string
  onFilter?: (query: string) => void
  onSelect?: (value: T | undefined) => void
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
}

export function Select<T>(props: SelectProps<T>) {
  let inputRef: HTMLInputElement | undefined = undefined
  let listboxRef: HTMLUListElement | undefined = undefined
  const [store, setStore] = createStore({
    filter: "",
  })
  const grouped = createMemo(() => {
    const needle = store.filter.toLowerCase()
    const result = pipe(
      props.options,
      (x) =>
        !needle || !props.filter
          ? x
          : fuzzysort.go(needle, x, { keys: props.filter && props.filter.keys }).map((x) => x.obj),
      groupBy((x) => (props.groupBy ? props.groupBy(x) : "")),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
      map(([k, v]) => ({ category: k, options: v })),
    )
    return result
  })
  // const flat = createMemo(() => {
  //   return pipe(
  //     grouped(),
  //     flatMap(({ options }) => options),
  //   )
  // })

  createEffect(() => {
    store.filter
    listboxRef?.scrollTo(0, 0)
    // setStore("selected", 0)
    // scroll.scrollTo(0)
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
          <KobalteSelect.ItemIndicator
            classList={{
              "ml-auto": true,
            }}
          >
            <Icon name="checkmark" size={16} />
          </KobalteSelect.ItemIndicator>
        </KobalteSelect.Item>
      )}
      onChange={(v) => {
        if (props.onSelect) props.onSelect(v ?? undefined)
        if (v !== null) {
          // close the select
        }
      }}
      onOpenChange={(v) => v || setStore("filter", "")}
    >
      <KobalteSelect.Trigger
        classList={{
          ...(props.classList ?? {}),
          "flex w-full items-center justify-between rounded-md transition-colors": true,
          "focus-visible:outline-none focus-visible:ring focus-visible:ring-border-active/30": true,
          "disabled:cursor-not-allowed disabled:opacity-50": true,
          "data-[placeholder-shown]:text-text-muted cursor-pointer": true,
          "hover:bg-background-element focus-visible:ring-border-active": true,
          "bg-background-element text-text": props.variant === "default" || !props.variant,
          "border-2 border-border bg-transparent text-text": props.variant === "outline",
          "h-6 pl-2 text-xs": props.size === "sm",
          "h-8 pl-3 text-sm": props.size === "md" || !props.size,
          "h-10 pl-4 text-base": props.size === "lg",
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
          onKeyDown={(e) => {
            if (!props.filter) return
            if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
              return
            }
            inputRef?.focus()
          }}
          classList={{
            "min-w-32 overflow-hidden rounded-md border border-border-subtle/40": true,
            "bg-background-panel p-1 shadow-md z-50": true,
            "data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95": true,
            "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95": true,
          }}
        >
          <Show when={props.filter}>
            <input
              ref={(el) => (inputRef = el)}
              id="select-filter"
              type="text"
              placeholder={props.filter ? props.filter.placeholder : "Filter items"}
              value={store.filter}
              onInput={(e) => setStore("filter", e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
                  e.preventDefault()
                  e.stopPropagation()
                  listboxRef?.focus()
                }
              }}
              classList={{
                "w-full": true,
                "px-2 pb-2 text-text font-light placeholder-text-muted/70 text-xs focus:outline-none": true,
              }}
            />
          </Show>
          <KobalteSelect.Listbox
            ref={(el) => (listboxRef = el)}
            classList={{
              "overflow-y-auto max-h-48 no-scrollbar": true,
            }}
          />
        </KobalteSelect.Content>
      </KobalteSelect.Portal>
    </KobalteSelect>
  )
}
