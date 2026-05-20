import {
  createContext,
  createMemo,
  createSignal,
  mergeProps,
  splitProps,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"
import type { ComponentProps } from "solid-js"
import "./segmented-control-v2.css"

type OnChange = (value: string | null) => void

type SegmentedControlContextValue = {
  selected: Accessor<string | null>
  groupDisabled: Accessor<boolean>
  select: (value: string) => void
  clearIfAllowed: (value: string) => void
  focusNext: (from: HTMLButtonElement, direction: 1 | -1) => void
}

const SegmentedControlContext = createContext<SegmentedControlContextValue>()

function useSegmentedControlContext() {
  const ctx = useContext(SegmentedControlContext)
  if (!ctx) throw new Error("SegmentedControlItemV2 must be used inside SegmentedControlV2")
  return ctx
}

export type SegmentedControlV2Props = Omit<ComponentProps<"div">, "onChange"> &
  ParentProps<{
    /** Selected value when controlled (including `null` when empty). Omit key for uncontrolled. */
    value?: string | null
    /** Initial value when uncontrolled. */
    defaultValue?: string
    onChange?: OnChange
    /** When true, clicking the active segment clears selection (`onChange(null)`). Default false. */
    allowDeselect?: boolean
    disabled?: boolean
  }>

export function SegmentedControlV2(props: SegmentedControlV2Props) {
  const isControlled = createMemo(() => Object.hasOwn(props as object, "value"))
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
    "ref",
  ])

  const [internal, setInternal] = createSignal<string | null>(local.defaultValue ?? null)

  const selected = createMemo(() => (isControlled() ? local.value ?? null : internal()))

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
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(`button[data-slot="segmented-control-v2-item"]`)).filter(
      (b) => !b.disabled,
    )
    const i = buttons.indexOf(from)
    const next = buttons[i + direction]
    next?.focus()
  }

  const ctx: SegmentedControlContextValue = {
    selected,
    groupDisabled: () => !!local.disabled,
    select,
    clearIfAllowed,
    focusNext,
  }

  const assignRef = (el: HTMLDivElement | undefined) => {
    const r = local.ref
    if (typeof r === "function") (r as (el: HTMLDivElement | undefined) => void)(el)
    else if (r != null && typeof r === "object" && "value" in r) (r as { value: HTMLDivElement | undefined }).value = el
  }

  return (
    <SegmentedControlContext.Provider value={ctx}>
      <div
        {...rest}
        ref={assignRef}
        role="group"
        data-component="segmented-control-v2"
        data-slot="segmented-control-v2"
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        {local.children}
      </div>
    </SegmentedControlContext.Provider>
  )
}

export type SegmentedControlItemV2Props = Omit<ComponentProps<"button">, "type" | "children"> &
  ParentProps<{
    value: string
    children: JSX.Element
  }>

function invokeButtonHandler<E extends Event>(
  handler: JSX.EventHandlerUnion<HTMLButtonElement, E> | undefined,
  e: E & { currentTarget: HTMLButtonElement },
) {
  if (typeof handler === "function") (handler as (ev: typeof e) => void)(e)
}

export function SegmentedControlItemV2(props: SegmentedControlItemV2Props) {
  const merged = mergeProps({ disabled: false }, props)
  const [local, rest] = splitProps(merged, ["class", "classList", "children", "value", "disabled", "onClick", "onKeyDown"])
  const ctx = useSegmentedControlContext()

  const pressed = createMemo(() => ctx.selected() === local.value)
  const disabled = createMemo(() => ctx.groupDisabled() || !!local.disabled)

  const onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (e) => {
    invokeButtonHandler(local.onClick, e)
    if (e.defaultPrevented || disabled()) return
    if (pressed()) ctx.clearIfAllowed(local.value)
    else ctx.select(local.value)
  }

  const onKeyDown: JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent> = (e) => {
    invokeButtonHandler(local.onKeyDown, e)
    if (e.defaultPrevented || disabled()) return
    const t = e.currentTarget
    
    if (e.key === "ArrowRight") {
      e.preventDefault()
      ctx.focusNext(t, 1)
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      ctx.focusNext(t, -1)
    } 
    
    // accessibility stuff
    else if (e.key === "Home") {
      e.preventDefault()
      const root = t.closest(`[data-slot="segmented-control-v2"]`)
      const first = root?.querySelector<HTMLButtonElement>(`button[data-slot="segmented-control-v2-item"]:not(:disabled)`)
      first?.focus()
    } else if (e.key === "End") {
      e.preventDefault()
      const root = t.closest(`[data-slot="segmented-control-v2"]`)
      const buttons = root?.querySelectorAll<HTMLButtonElement>(`button[data-slot="segmented-control-v2-item"]:not(:disabled)`)
      const last = buttons?.[buttons.length - 1]
      last?.focus()
    }
  }

  return (
    <button
      {...rest}
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
