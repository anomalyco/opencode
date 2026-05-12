import { Select as Kobalte } from "@kobalte/core/select"
import { createMemo, onCleanup, splitProps, type ComponentProps, type JSX } from "solid-js"
import { pipe, groupBy, entries, map } from "remeda"
import { Button, ButtonProps } from "./button"
import { Icon } from "./icon"

function debug() {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem("opencode.ui.debug") === "1"
  } catch {
    return false
  }
}

function log(_kind: string, _fields: Record<string, string | number | boolean | undefined>) {
}

function stage(_name: string | undefined, _stage: string, _fields: Record<string, string | number | boolean | undefined>) {
}

export type SelectProps<T> = Omit<ComponentProps<typeof Kobalte<T>>, "value" | "onSelect" | "children"> & {
  placeholder?: string
  options: T[]
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string
  groupBy?: (x: T) => string
  valueClass?: ComponentProps<"div">["class"]
  onSelect?: (value: T | undefined) => void
  onHighlight?: (value: T | undefined) => (() => void) | void
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  children?: (item: T | undefined) => JSX.Element
  triggerStyle?: JSX.CSSProperties
  contentStyle?: JSX.CSSProperties
  triggerVariant?: "settings"
  triggerProps?: Record<string, unknown>
  debugName?: string
}

export function Select<T>(props: SelectProps<T> & Omit<ButtonProps, "children">) {
  const [local, others] = splitProps(props, [
    "class",
    "classList",
    "placeholder",
    "options",
    "current",
    "value",
    "label",
    "groupBy",
    "valueClass",
    "onSelect",
    "onHighlight",
    "onOpenChange",
    "children",
    "triggerStyle",
    "contentStyle",
    "triggerVariant",
    "triggerProps",
    "debugName",
  ])

  const state = {
    key: undefined as string | undefined,
    cleanup: undefined as (() => void) | void,
  }
  let triggerRef: HTMLElement | undefined
  let contentRef: HTMLElement | undefined
  let stageAt = 0

  const stop = () => {
    state.cleanup?.()
    state.cleanup = undefined
    state.key = undefined
  }

  const keyFor = (item: T) => (local.value ? local.value(item) : (item as string))

  const move = (item: T | undefined) => {
    if (!local.onHighlight) return
    if (!item) {
      stop()
      return
    }

    const key = keyFor(item)
    if (state.key === key) return
    state.cleanup?.()
    state.cleanup = local.onHighlight(item)
    state.key = key
  }

  onCleanup(stop)

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
      data-trigger-style={local.triggerVariant}
      placement={local.triggerVariant === "settings" ? "bottom-end" : "bottom-start"}
      gutter={4}
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
          {...itemProps}
          data-slot="select-select-item"
          classList={{
            ...(local.classList ?? {}),
            [local.class ?? ""]: !!local.class,
          }}
          onPointerEnter={local.onHighlight ? () => move(itemProps.item.rawValue) : undefined}
          onPointerMove={local.onHighlight ? () => move(itemProps.item.rawValue) : undefined}
          onFocus={local.onHighlight ? () => move(itemProps.item.rawValue) : undefined}
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
        stop()
      }}
      onOpenChange={(open) => {
        const trace = debug()
        if (trace && open && stageAt === 0) stageAt = performance.now()
        if (trace && !open) stageAt = 0
        if (trace) {
          log("toggle", {
            open,
            options: local.options.length,
            groups: grouped().length,
            trigger: !!triggerRef,
            content: !!contentRef,
          })
          stage(local.debugName, "open-change", {
            ms: stageAt ? Math.round(performance.now() - stageAt) : 0,
            open,
            trigger: !!triggerRef,
            content: !!contentRef,
            options: local.options.length,
            groups: grouped().length,
          })
        }
        local.onOpenChange?.(open)
        if (!open) stop()
        if (!trace || !open) return
        requestAnimationFrame(() => {
          const trigger = triggerRef
          const content = contentRef
          const first = content
            ? {
                width: Math.round(content.getBoundingClientRect().width),
                height: Math.round(content.getBoundingClientRect().height),
                top: Math.round(content.getBoundingClientRect().top),
                left: Math.round(content.getBoundingClientRect().left),
              }
            : undefined
          log("frame", {
            options: local.options.length,
            groups: grouped().length,
            triggerWidth: trigger ? Math.round(trigger.getBoundingClientRect().width) : "none",
            triggerHeight: trigger ? Math.round(trigger.getBoundingClientRect().height) : "none",
            contentWidth: content ? Math.round(content.getBoundingClientRect().width) : "none",
            contentHeight: content ? Math.round(content.getBoundingClientRect().height) : "none",
            contentNodes: content ? content.querySelectorAll("*").length : "none",
            items: content ? content.querySelectorAll('[data-slot="select-select-item"]').length : "none",
          })
          stage(local.debugName, "frame-1", {
            ms: stageAt ? Math.round(performance.now() - stageAt) : "none",
            options: local.options.length,
            groups: grouped().length,
            width: first?.width ?? "none",
            height: first?.height ?? "none",
            top: first?.top ?? "none",
            left: first?.left ?? "none",
            nodes: content ? content.querySelectorAll("*").length : "none",
            items: content ? content.querySelectorAll('[data-slot="select-select-item"]').length : "none",
          })
          requestAnimationFrame(() => {
            const next = contentRef
              ? {
                  width: Math.round(contentRef.getBoundingClientRect().width),
                  height: Math.round(contentRef.getBoundingClientRect().height),
                  top: Math.round(contentRef.getBoundingClientRect().top),
                  left: Math.round(contentRef.getBoundingClientRect().left),
                }
              : undefined
            stage(local.debugName, "frame-2", {
              ms: stageAt ? Math.round(performance.now() - stageAt) : "none",
              options: local.options.length,
              groups: grouped().length,
              width: next?.width ?? "none",
              height: next?.height ?? "none",
              top: next?.top ?? "none",
              left: next?.left ?? "none",
              nodes: contentRef ? contentRef.querySelectorAll("*").length : "none",
              items: contentRef ? contentRef.querySelectorAll('[data-slot="select-select-item"]').length : "none",
            })
            if (first && next) {
              stage(local.debugName, "jump", {
                ms: stageAt ? Math.round(performance.now() - stageAt) : "none",
                dWidth: next.width - first.width,
                dHeight: next.height - first.height,
                dTop: next.top - first.top,
                dLeft: next.left - first.left,
              })
            }
          })
        })
      }}
    >
      <Kobalte.Trigger
        ref={(el: HTMLElement | undefined) => {
          triggerRef = el
        }}
        {...local.triggerProps}
        disabled={props.disabled}
        data-slot="select-select-trigger"
        as={Button}
        size={props.size}
        variant={props.variant}
        style={local.triggerStyle}
        classList={{
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
      >
        <Kobalte.Value<T> data-slot="select-select-trigger-value" class={local.valueClass}>
          {(state) => {
            const selected = state.selectedOption() ?? local.current
            if (!selected) return local.placeholder || ""
            if (local.label) return local.label(selected)
            return selected as string
          }}
        </Kobalte.Value>
        <Kobalte.Icon data-slot="select-select-trigger-icon">
          <Icon name={local.triggerVariant === "settings" ? "selector" : "chevron-down"} size="small" />
        </Kobalte.Icon>
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          ref={(el: HTMLElement | undefined) => {
            contentRef = el
            if (!debug()) return
            if (el) stageAt = performance.now()
            stage(local.debugName, "content-mount", {
              ms: stageAt ? Math.round(performance.now() - stageAt) : "none",
              mounted: !!el,
              width: el ? Math.round(el.getBoundingClientRect().width) : "none",
              height: el ? Math.round(el.getBoundingClientRect().height) : "none",
              top: el ? Math.round(el.getBoundingClientRect().top) : "none",
              left: el ? Math.round(el.getBoundingClientRect().left) : "none",
            })
          }}
          classList={{
            ...(local.classList ?? {}),
            [local.class ?? ""]: !!local.class,
          }}
          data-component="select-content"
          data-trigger-style={local.triggerVariant}
          style={local.contentStyle}
        >
          <Kobalte.Listbox data-slot="select-select-content-list" />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
