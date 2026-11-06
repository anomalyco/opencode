import {
  Content,
  Item,
  ItemIndicator,
  ItemLabel,
  Listbox,
  Portal,
  Root,
  Section,
  Trigger,
  Value,
} from "@kobalte/core/select"
import {
  Show,
  createComputed,
  createMemo,
  on,
  onCleanup,
  splitProps,
  untrack,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { MenuScroll } from "../../components/menu-scroll"
import { createSelectHighlightState, transitionSelectHighlight, type SelectHighlightEvent } from "./machine"
import "./select.css"

function groupOptions<T>(options: T[], groupBy?: (x: T) => string): { category: string; options: T[] }[] {
  if (!groupBy) {
    return [{ category: "", options }]
  }

  const map = new Map<string, T[]>()

  for (const opt of options) {
    const key = groupBy(opt)
    const arr = map.get(key)

    if (arr) arr.push(opt)
    else map.set(key, [opt])
  }

  return [...map.entries()].map(([category, opts]) => ({ category, options: opts }))
}

const ChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M11 9.5L8 6.5L5 9.5"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

const CheckSmall = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

export type SelectProps<T> = Omit<
  ComponentProps<typeof Root<T, { category: string; options: T[] }>>,
  "value" | "onSelect" | "children" | "options" | "itemComponent" | "sectionComponent" | "defaultValue" | "multiple"
> & {
  placeholder?: string
  options: T[]
  /** Selected option (single selection). */
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string
  groupBy?: (x: T) => string
  onSelect?: (value: T | null) => void
  onHighlight?: (value: T | undefined) => void | (() => void)
  invalid?: boolean
  numeric?: boolean
  /** `inline` is the borderless settings trigger; `small`, `base` and `large` are 24px, 28px and 32px input fields. */
  appearance?: "inline" | "small" | "base" | "large"
  /** Background surface of an input field; invisible gains a fill on hover. */
  surface?: "base" | "layer-1" | "invisible"
  children?: (item: T) => JSX.Element
  valueClass?: string
  contentClass?: string
}

export function Select<T>(props: SelectProps<T>) {
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
    "onHighlight",
    "onOpenChange",
    "children",
    "invalid",
    "numeric",
    "appearance",
    "surface",
    "disabled",
    "valueClass",
    "contentClass",
    "placement",
    "gutter",
    "sameWidth",
    "flip",
    "slide",
    "fitViewport",
  ])

  let highlight = createSelectHighlightState(untrack(() => others.open ?? others.defaultOpen ?? false))
  // The highlighted item and the undo its preview returned; the machine decides when each runs.
  let highlighted: T | undefined
  let revert: void | (() => void)

  let scroller: HTMLDivElement | undefined

  const dispatch = (event: SelectHighlightEvent) => {
    const next = transitionSelectHighlight(highlight, event)
    highlight = next.state
    next.effects.forEach((effect) => {
      if (effect.type === "preview.revert") {
        const undo = revert
        revert = undefined

        return undo?.()
      }

      revert = highlighted === undefined ? undefined : local.onHighlight?.(highlighted)
    })
  }

  const keyFor = (item: T) => (local.value ? local.value(item) : String(item))

  const move = (item: T) => {
    highlighted = item
    dispatch({ type: "highlight.changed", key: keyFor(item), previewable: !!local.onHighlight })
  }

  // A controlled menu closed by its owner does not call onOpenChange.
  createComputed(
    on(
      () => others.open,
      (open) => {
        if (open !== undefined) dispatch({ type: "open.changed", open })
      },
    ),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  const grouped = createMemo(() => groupOptions(local.options, local.groupBy))

  return (
    <Root<T, { category: string; options: T[] }>
      {...others}
      multiple={false}
      allowDuplicateSelectionEvents={false}
      disabled={local.disabled}
      data-component="select-v2-root"
      placement={local.placement ?? "bottom-end"}
      gutter={local.gutter ?? 4}
      sameWidth={local.sameWidth ?? false}
      flip={local.flip ?? true}
      slide={local.slide ?? true}
      fitViewport={local.fitViewport ?? false}
      value={local.current}
      options={grouped()}
      optionValue={(x) => (local.value ? local.value(x) : String(x))}
      optionTextValue={(x) => (local.label ? local.label(x) : String(x))}
      optionGroupChildren="options"
      placeholder={local.placeholder}
      sectionComponent={(sectionProps) => (
        <Section>
          <Show when={sectionProps.section.rawValue.category}>
            <div data-slot="menu-v2-group-label">{sectionProps.section.rawValue.category}</div>
          </Show>
        </Section>
      )}
      itemComponent={(itemProps) => (
        <Item
          {...itemProps}
          data-component="menu-v2-item"
          onPointerEnter={() => move(itemProps.item.rawValue)}
          onPointerMove={() => move(itemProps.item.rawValue)}
          onFocus={() => move(itemProps.item.rawValue)}
        >
          <ItemLabel data-slot="menu-v2-item-content" as="span">
            {local.children
              ? local.children(itemProps.item.rawValue)
              : local.label
                ? local.label(itemProps.item.rawValue)
                : String(itemProps.item.rawValue)}
          </ItemLabel>
          <ItemIndicator data-slot="menu-v2-item-indicator" forceMount>
            <CheckSmall />
          </ItemIndicator>
        </Item>
      )}
      onChange={(next) => {
        const v = next == null ? null : Array.isArray(next) ? (next[0] ?? null) : next
        dispatch({
          type: "option.selected",
          key: v === null ? undefined : keyFor(v),
          closing: others.closeOnSelection ?? true,
        })
        local.onSelect?.(v)
      }}
      onOpenChange={(open) => {
        if (others.open === undefined) dispatch({ type: "open.changed", open })
        local.onOpenChange?.(open)
      }}
    >
      <Trigger
        as="div"
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        data-component="select-v2"
        data-appearance={local.appearance ?? "inline"}
        data-surface={local.appearance && local.appearance !== "inline" ? (local.surface ?? "base") : undefined}
        data-invalid={local.invalid ? "" : undefined}
        data-numeric={local.numeric ? "" : undefined}
        disabled={local.disabled}
        data-disabled={local.disabled ? "" : undefined}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        <div data-slot="select-v2-value">
          <Value<T> data-slot="select-v2-value-text" class={local.valueClass}>
            {(st) => {
              const selected = st.selectedOption()

              if (local.label && selected != null) return local.label(selected)

              return selected != null ? String(selected) : ""
            }}
          </Value>
        </div>
        <span data-slot="select-v2-chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      </Trigger>
      <Portal>
        <Content class={local.contentClass} data-component="menu-v2-content" data-slot="select-v2-content">
          <MenuScroll viewportRef={(element) => (scroller = element)}>
            <Listbox data-slot="select-v2-listbox" scrollRef={() => scroller} />
          </MenuScroll>
        </Content>
      </Portal>
    </Root>
  )
}
