import { animate, motion, useMotionValue, type Transition } from "@kitlangton/solid-motion"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  mergeProps,
  onCleanup,
  onMount,
  Show,
  splitProps,
  useContext,
  type Accessor,
  type ComponentProps,
  type JSX,
  type ParentProps,
} from "solid-js"
import "./segmented-control.css"

type OnChange = (value: string | null) => void

export const SEGMENTED_CONTROL_SPRING: Transition = {
  type: "spring",
  visualDuration: 0.15,
  bounce: 0,
}

type SegmentedControlContextValue = {
  selected: Accessor<string | null>
  groupDisabled: Accessor<boolean>
  select: (value: string) => void
  clearIfAllowed: (value: string) => void
  focusNext: (from: HTMLButtonElement, direction: 1 | -1) => void
  registerItem: (value: string, el: HTMLButtonElement) => () => void
}

const SegmentedControlContext = createContext<SegmentedControlContextValue>()

function useSegmentedControlContext() {
  const ctx = useContext(SegmentedControlContext)

  if (!ctx) throw new Error("SegmentedControlItem must be used inside SegmentedControl")

  return ctx
}

export type OffsetElement = {
  offsetLeft: number
  offsetWidth: number
  offsetParent: Element | OffsetElement | null
  getBoundingClientRect: () => { left: number }
}

function isOffsetElement(node: Element | OffsetElement | null): node is OffsetElement {
  return node !== null && "offsetLeft" in node && "offsetParent" in node
}

export function measureOffset(root: OffsetElement, button: OffsetElement) {
  let offset = 0
  let node: OffsetElement | null = button

  while (node && node !== root) {
    offset += node.offsetLeft
    node = isOffsetElement(node.offsetParent) ? node.offsetParent : null
  }

  if (node !== root) {
    offset = button.getBoundingClientRect().left - root.getBoundingClientRect().left
  }

  return { x: offset, width: button.offsetWidth }
}

export type SegmentedControlProps = Omit<ComponentProps<"div">, "onChange"> &
  ParentProps<{
    /** Selected value when controlled (including `null` when empty). Omit key for uncontrolled. */
    value?: string | null
    /** Initial value when uncontrolled. */
    defaultValue?: string
    onChange?: OnChange
    /** When true, clicking the active segment clears selection (`onChange(null)`). Default false. */
    allowDeselect?: boolean
    disabled?: boolean
    /** Motion transition for the active indicator pill. */
    transition?: Transition
  }>

export function SegmentedControl(props: SegmentedControlProps) {
  const isControlled = createMemo(() => Object.hasOwn(props, "value"))
  const merged = mergeProps({ allowDeselect: false, disabled: false }, props)

  const [local, rest] = splitProps(merged, [
    "class",
    "classList",
    "children",
    "value",
    "defaultValue",
    "onChange",
    "allowDeselect",
    "disabled",
    "transition",
    "ref",
  ])

  const [internal, setInternal] = createSignal<string | null>(local.defaultValue ?? null)
  const [layoutVersion, setLayoutVersion] = createSignal(0)
  const [ready, setReady] = createSignal(false)

  const selected = createMemo(() => (isControlled() ? (local.value ?? null) : internal()))
  const reducedMotion = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)")?.matches === true

  const x = useMotionValue(0)
  const width = useMotionValue(0)

  let rootEl: HTMLDivElement | undefined
  let observer: ResizeObserver | undefined
  const items = new Map<string, HTMLButtonElement>()
  let target = { x: 0, width: 0 }
  let lastSelected: string | null = null

  const syncIndicator = (shouldAnimate: boolean) => {
    const current = selected()
    const button = current !== null ? items.get(current) : undefined

    if (!rootEl || !button) {
      setReady(false)

      return
    }

    const next = measureOffset(rootEl, button)

    if (next.width === 0) return

    target = next

    if (!ready() || !shouldAnimate || reducedMotion()) {
      x.jump(next.x)
      width.jump(next.width)
      setReady(true)

      return
    }

    const transition = local.transition ?? SEGMENTED_CONTROL_SPRING
    animate(x, next.x, transition)
    animate(width, next.width, transition)
  }

  onMount(() => {
    if (!("ResizeObserver" in globalThis)) return

    observer = new ResizeObserver(() => {
      const current = selected()
      const button = current !== null ? items.get(current) : undefined

      if (!rootEl || !button) return

      const next = measureOffset(rootEl, button)

      if (next.width === 0) return

      if (ready() && next.x === target.x && next.width === target.width) return

      syncIndicator(false)
    })

    if (rootEl) observer.observe(rootEl)

    items.forEach((button) => observer?.observe(button))
    onCleanup(() => observer?.disconnect())
  })

  createEffect(() => {
    const current = selected()
    layoutVersion()
    const shouldAnimate = ready() && lastSelected !== null && current !== null && current !== lastSelected
    lastSelected = current
    syncIndicator(shouldAnimate)
  })

  const setSelected = (next: string | null) => {
    if (!isControlled()) setInternal(next)
    local.onChange?.(next)
  }

  const select = (value: string) => {
    setSelected(value)
  }

  const clearIfAllowed = (value: string) => {
    if (!local.allowDeselect || selected() !== value) return
    setSelected(null)
  }

  const focusNext = (from: HTMLButtonElement, direction: 1 | -1) => {
    const root = from.closest(`[data-slot="segmented-control-v2"]`)

    if (!root) return

    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>(`button[data-slot="segmented-control-v2-item"]`),
    ).filter((b) => !b.disabled)

    const i = buttons.indexOf(from)
    const next = buttons[i + direction]
    next?.focus()
  }

  const registerItem = (value: string, el: HTMLButtonElement) => {
    items.set(value, el)
    observer?.observe(el)
    setLayoutVersion((v) => v + 1)

    return () => {
      if (items.get(value) === el) items.delete(value)
      observer?.unobserve(el)
      setLayoutVersion((v) => v + 1)
    }
  }

  const ctx: SegmentedControlContextValue = {
    selected,
    groupDisabled: () => !!local.disabled,
    select,
    clearIfAllowed,
    focusNext,
    registerItem,
  }

  const assignRef = (el: HTMLDivElement) => {
    rootEl = el
    const r = local.ref

    if (r instanceof Function) r(el)
  }

  return (
    <SegmentedControlContext.Provider value={ctx}>
      <div
        {...rest}
        ref={assignRef}
        role="group"
        data-component="segmented-control-v2"
        data-slot="segmented-control-v2"
        data-ready={ready() ? "" : undefined}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        <Show when={ready() && selected() !== null}>
          <motion.span data-slot="segmented-control-v2-indicator" aria-hidden="true" style={{ x, width }} />
        </Show>
        {local.children}
      </div>
    </SegmentedControlContext.Provider>
  )
}

export type SegmentedControlItemProps = Omit<ComponentProps<"button">, "type" | "children"> &
  ParentProps<{
    value: string
    children: JSX.Element
  }>

function invokeButtonHandler<E extends Event>(
  handler: JSX.EventHandlerUnion<HTMLButtonElement, E> | undefined,
  e: Parameters<JSX.EventHandler<HTMLButtonElement, E>>[0],
) {
  if (handler instanceof Function) {
    handler(e)

    return
  }

  if (Array.isArray(handler)) {
    handler[0](handler[1], e)
  }
}

export function SegmentedControlItem(props: SegmentedControlItemProps) {
  const merged = mergeProps({ disabled: false }, props)

  const [local, rest] = splitProps(merged, [
    "class",
    "classList",
    "children",
    "value",
    "disabled",
    "onClick",
    "onKeyDown",
    "ref",
  ])

  const ctx = useSegmentedControlContext()

  let buttonEl: HTMLButtonElement | undefined
  createEffect(() => {
    if (!buttonEl) return
    const cleanup = ctx.registerItem(local.value, buttonEl)
    onCleanup(cleanup)
  })

  const pressed = createMemo(() => ctx.selected() === local.value)
  const disabled = createMemo(() => ctx.groupDisabled() || !!local.disabled)

  const onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (e) => {
    invokeButtonHandler(local.onClick, e)

    if (e.defaultPrevented || disabled()) return

    if (pressed()) {
      ctx.clearIfAllowed(local.value)

      return
    }

    ctx.select(local.value)
  }

  const onKeyDown: JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent> = (e) => {
    invokeButtonHandler(local.onKeyDown, e)

    if (e.defaultPrevented || disabled()) return

    const t = e.currentTarget
    const horizontal = t.closest(`[data-slot="segmented-control-v2"]`)?.matches(":dir(rtl)") ? -1 : 1

    if (e.key === "ArrowRight") {
      e.preventDefault()
      ctx.focusNext(t, horizontal)

      return
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault()
      ctx.focusNext(t, horizontal === 1 ? -1 : 1)

      return
    }

    if (e.key === "Home") {
      e.preventDefault()
      const root = t.closest(`[data-slot="segmented-control-v2"]`)

      const first = root?.querySelector<HTMLButtonElement>(
        `button[data-slot="segmented-control-v2-item"]:not(:disabled)`,
      )

      first?.focus()

      return
    }

    if (e.key === "End") {
      e.preventDefault()
      const root = t.closest(`[data-slot="segmented-control-v2"]`)

      const buttons = root?.querySelectorAll<HTMLButtonElement>(
        `button[data-slot="segmented-control-v2-item"]:not(:disabled)`,
      )

      const last = buttons?.[buttons.length - 1]
      last?.focus()
    }
  }

  const assignRef = (el: HTMLButtonElement) => {
    buttonEl = el
    const r = local.ref

    if (r instanceof Function) r(el)
  }

  return (
    <button
      {...rest}
      ref={assignRef}
      type="button"
      data-slot="segmented-control-v2-item"
      data-pressed={pressed() ? "" : undefined}
      aria-pressed={pressed()}
      disabled={disabled()}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span data-slot="segmented-control-v2-item-label">{local.children}</span>
    </button>
  )
}

export const SegmentedControlV2 = SegmentedControl

export const SegmentedControlItemV2 = SegmentedControlItem

export type SegmentedControlV2Props = SegmentedControlProps

export type SegmentedControlItemV2Props = SegmentedControlItemProps
