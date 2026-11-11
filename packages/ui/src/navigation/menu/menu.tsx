import { DropdownMenu, type DropdownMenuTriggerProps } from "@kobalte/core/dropdown-menu"
import { ContextMenu } from "@kobalte/core/context-menu"
import type { PolymorphicProps } from "@kobalte/core/polymorphic"
import {
  createComputed,
  createContext,
  createSignal,
  onCleanup,
  Show,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
  type ParentProps,
  type ValidComponent,
} from "solid-js"
import {
  createMenuState,
  MENU_CLOSE_AUTOFOCUS,
  MENU_DISPOSED,
  MENU_OUTSIDE_INTERACTED,
  openChangedEvent,
  selectMenuRestoreTriggerWithoutRing,
  transitionMenu,
  type MenuEvent,
  type MenuInputGesture,
  type MenuState,
} from "./machine"
import "./menu.css"

const ChevronRight: Component = () => (
  <svg
    data-slot="menu-v2-item-chevron"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M6 4L10 8L6 12V4Z" fill="currentColor" />
  </svg>
)

const CheckMark: Component = () => (
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

export type MenuAppearance = "standard" | "compact"

type MenuContextValue = {
  appearance: Accessor<MenuAppearance>
  state: Accessor<MenuState>
  modal: Accessor<boolean>
  onOutsideInteract: () => void
  onCloseAutoFocus: () => void
}

// Context menus restore focus through Kobalte alone, so they never run the dropdown machine.
const UNTRACKED_MENU: MenuContextValue = {
  appearance: () => "compact",
  state: () => createMenuState(false),
  modal: () => true,
  onOutsideInteract: () => {},
  onCloseAutoFocus: () => {},
}

const MenuAppearanceContext = createContext<MenuContextValue>(UNTRACKED_MENU)

// One set of window listeners serves every mounted menu. Capture runs before the trigger's own handlers, so while an
// input event dispatches, `gesture` names the input that may open a menu. It clears once that event's task ends, so a
// later open without input counts as programmatic.
let trackers = 0

let gesture: MenuInputGesture = "none"

let gestureReset: ReturnType<typeof setTimeout> | undefined

const trackGesture = (event: Event) => {
  if (!event.isTrusted) return
  // Keyboard activation fires a click with no press count.
  gesture =
    event.type === "keydown" || (event instanceof MouseEvent && event.type === "click" && event.detail === 0)
      ? "keyboard"
      : "pointer"

  // A microtask would run between listeners of this same dispatch, before the trigger's handler reads the gesture.
  if (gestureReset !== undefined) return
  gestureReset = setTimeout(() => {
    gestureReset = undefined
    gesture = "none"
  })
}

const GESTURE_EVENTS = ["pointerdown", "click", "keydown"] as const

const GESTURE_LISTENER_OPTIONS = { capture: true, passive: true }

function retainGestureTracker() {
  trackers += 1

  if (trackers === 1)
    GESTURE_EVENTS.forEach((type) => window.addEventListener(type, trackGesture, GESTURE_LISTENER_OPTIONS))
}

function releaseGestureTracker() {
  trackers -= 1

  if (trackers > 0) return
  GESTURE_EVENTS.forEach((type) => window.removeEventListener(type, trackGesture, GESTURE_LISTENER_OPTIONS))
  clearTimeout(gestureReset)
  gestureReset = undefined
  gesture = "none"
}

function useMenuContext() {
  const ctx = useContext(MenuAppearanceContext)

  if (!ctx) throw new Error("Menu components must be used inside Menu or Menu.Context")

  return ctx
}

function ItemBody(
  props: ParentProps<{
    shortcut?: JSX.Element | string
    badge?: JSX.Element | string
    trailing?: JSX.Element
  }>,
) {
  return (
    <>
      <span data-slot="menu-v2-item-content">{props.children}</span>
      <Show when={props.shortcut}>{(shortcut) => <span data-slot="menu-v2-item-shortcut">{shortcut()}</span>}</Show>
      <Show when={props.badge}>{(badge) => <span data-slot="menu-v2-item-badge">{badge()}</span>}</Show>
      {props.trailing}
    </>
  )
}

export interface MenuItemProps extends ComponentProps<typeof DropdownMenu.Item> {
  shortcut?: JSX.Element | string
  badge?: JSX.Element | string
}

function MenuItem(props: ParentProps<MenuItemProps>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList", "children", "shortcut", "badge"])

  return (
    <DropdownMenu.Item
      {...r}
      data-component="menu-v2-item"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <ItemBody shortcut={s.shortcut} badge={s.badge}>
        {s.children}
      </ItemBody>
    </DropdownMenu.Item>
  )
}

export interface MenuCheckboxItemProps extends ComponentProps<typeof DropdownMenu.CheckboxItem> {
  shortcut?: JSX.Element | string
  badge?: JSX.Element | string
}

function MenuCheckboxItem(props: ParentProps<MenuCheckboxItemProps>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList", "children", "shortcut", "badge"])

  return (
    <DropdownMenu.CheckboxItem
      {...r}
      data-component="menu-v2-item"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <ItemBody
        shortcut={s.shortcut}
        badge={s.badge}
        trailing={
          <DropdownMenu.ItemIndicator data-slot="menu-v2-item-indicator" forceMount>
            <CheckMark />
          </DropdownMenu.ItemIndicator>
        }
      >
        {s.children}
      </ItemBody>
    </DropdownMenu.CheckboxItem>
  )
}

export interface MenuRadioItemProps extends ComponentProps<typeof DropdownMenu.RadioItem> {
  shortcut?: JSX.Element | string
  badge?: JSX.Element | string
}

function MenuRadioItem(props: ParentProps<MenuRadioItemProps>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList", "children", "shortcut", "badge"])

  return (
    <DropdownMenu.RadioItem
      {...r}
      data-component="menu-v2-item"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <ItemBody
        shortcut={s.shortcut}
        badge={s.badge}
        trailing={
          <DropdownMenu.ItemIndicator data-slot="menu-v2-item-indicator" forceMount>
            <CheckMark />
          </DropdownMenu.ItemIndicator>
        }
      >
        {s.children}
      </ItemBody>
    </DropdownMenu.RadioItem>
  )
}

export interface MenuSubTriggerProps extends ComponentProps<typeof DropdownMenu.SubTrigger> {
  shortcut?: JSX.Element | string
  badge?: JSX.Element | string
}

export interface MenuSubProps extends ComponentProps<typeof DropdownMenu.Sub> {
  placement?:
    | "top"
    | "top-start"
    | "top-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "left"
    | "left-start"
    | "left-end"
    | "right"
    | "right-start"
    | "right-end"
}

function MenuSub(props: MenuSubProps) {
  return <DropdownMenu.Sub {...props} />
}

function MenuSubTrigger(props: ParentProps<MenuSubTriggerProps>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList", "children", "shortcut", "badge"])

  return (
    <DropdownMenu.SubTrigger
      {...r}
      data-component="menu-v2-item"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <ItemBody shortcut={s.shortcut} badge={s.badge} trailing={<ChevronRight />}>
        {s.children}
      </ItemBody>
    </DropdownMenu.SubTrigger>
  )
}

function MenuSubContent(props: ComponentProps<typeof DropdownMenu.SubContent>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList"])

  return (
    <DropdownMenu.SubContent
      {...r}
      data-kb-top-layer=""
      data-component="menu-v2-content"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

function MenuGroupLabel(props: ComponentProps<typeof DropdownMenu.GroupLabel>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList"])

  return (
    <DropdownMenu.GroupLabel
      {...r}
      data-slot="menu-v2-group-label"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

function MenuSeparator(props: ComponentProps<typeof DropdownMenu.Separator>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList"])

  return (
    <DropdownMenu.Separator
      {...r}
      data-slot="menu-v2-separator"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

// Kobalte drops `data-expanded` as the menu closes but returns focus to the trigger a task later, so for a frame the
// trigger is neither expanded nor focused. `data-closing` covers that gap for UI revealed by either.
function MenuTrigger<T extends ValidComponent = "button">(props: PolymorphicProps<T, DropdownMenuTriggerProps<T>>) {
  const ctx = useMenuContext()

  return <DropdownMenu.Trigger {...props} data-closing={ctx.state().status === "closing" ? "" : undefined} />
}

function MenuContent(props: ComponentProps<typeof DropdownMenu.Content>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList", "onCloseAutoFocus", "onInteractOutside"])

  // Kobalte's own rule for when an outside press keeps focus where it landed.
  const onInteractOutside: NonNullable<typeof s.onInteractOutside> = (event) => {
    s.onInteractOutside?.(event)

    if (!event.defaultPrevented && (!ctx.modal() || event.detail.isContextMenu)) ctx.onOutsideInteract()
  }

  // A menu returns focus to its trigger when it closes. Restore it without the ring after a pointer open and keep the
  // ring for keyboard and programmatic opens.
  const onCloseAutoFocus = (event: Event) => {
    const restore = selectMenuRestoreTriggerWithoutRing(ctx.state())
    ctx.onCloseAutoFocus()
    s.onCloseAutoFocus?.(event)

    if (event.defaultPrevented || !restore) return
    event.preventDefault()
    const active = document.activeElement

    // An outside press already moved focus where it belongs.
    if (active && active !== document.body && !active.closest('[role="menu"]')) return
    const labelledby = event.target instanceof Element ? event.target.getAttribute("aria-labelledby") : null
    const trigger = labelledby ? document.getElementById(labelledby) : null
    trigger?.focus({ preventScroll: true, focusVisible: false })
  }

  return (
    <DropdownMenu.Content
      {...r}
      onCloseAutoFocus={onCloseAutoFocus}
      onInteractOutside={onInteractOutside}
      // A modal dialog hides what's outside it from assistive tech, and a non-modal menu is portaled outside it.
      data-kb-top-layer=""
      data-component="menu-v2-content"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

export interface MenuProps extends ComponentProps<typeof DropdownMenu> {
  appearance?: MenuAppearance
}

function MenuRoot(props: MenuProps) {
  const [local, rest] = splitProps(props, ["appearance", "children", "onOpenChange"])
  const appearance = () => local.appearance ?? "compact"
  const initialOpen = !!props.open || (props.open === undefined && !!props.defaultOpen)
  const [menuState, setMenuState] = createSignal(createMenuState(initialOpen))
  const dispatch = (event: MenuEvent) => setMenuState((state) => transitionMenu(state, event))

  retainGestureTracker()
  onCleanup(() => {
    releaseGestureTracker()
    dispatch(MENU_DISPOSED)
  })

  // Kobalte does not report a controlled open it did not ask for, so a controlled menu follows `open` itself.
  createComputed(() => {
    if (props.open === undefined) return
    dispatch(openChangedEvent(props.open, gesture))
  })

  const context = {
    appearance,
    state: menuState,
    modal: () => props.modal ?? true,
    onOutsideInteract: () => dispatch(MENU_OUTSIDE_INTERACTED),
    onCloseAutoFocus: () => dispatch(MENU_CLOSE_AUTOFOCUS),
  }

  return (
    <MenuAppearanceContext.Provider value={context}>
      <DropdownMenu
        {...rest}
        onOpenChange={(open) => {
          if (props.open === undefined) dispatch(openChangedEvent(open, gesture))
          local.onOpenChange?.(open)
        }}
      >
        {local.children}
      </DropdownMenu>
    </MenuAppearanceContext.Provider>
  )
}

export interface MenuContextProps extends ComponentProps<typeof ContextMenu> {
  appearance?: MenuAppearance
}

function MenuContextRoot(props: MenuContextProps) {
  const [local, rest] = splitProps(props, ["appearance", "children"])
  const appearance = () => local.appearance ?? "compact"

  return (
    <MenuAppearanceContext.Provider value={{ ...UNTRACKED_MENU, appearance }}>
      <ContextMenu {...rest}>{local.children}</ContextMenu>
    </MenuAppearanceContext.Provider>
  )
}

function MenuContextContent(props: ComponentProps<typeof ContextMenu.Content>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList"])

  return (
    <ContextMenu.Content
      {...r}
      data-component="menu-v2-content"
      data-appearance={ctx.appearance()}
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

const MenuContext = Object.assign(MenuContextRoot, {
  Trigger: ContextMenu.Trigger,
  Portal: ContextMenu.Portal,
  Content: MenuContextContent,
})

export const Menu = Object.assign(MenuRoot, {
  Trigger: MenuTrigger,
  Portal: DropdownMenu.Portal,
  Content: MenuContent,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: DropdownMenu.RadioGroup,
  RadioItem: MenuRadioItem,
  Group: DropdownMenu.Group,
  GroupLabel: MenuGroupLabel,
  Separator: MenuSeparator,
  Sub: MenuSub,
  SubTrigger: MenuSubTrigger,
  SubContent: MenuSubContent,
  Context: MenuContext,
})
