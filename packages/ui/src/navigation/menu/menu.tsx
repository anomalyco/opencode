import { DropdownMenu } from "@kobalte/core/dropdown-menu"
import { ContextMenu } from "@kobalte/core/context-menu"
import {
  createContext,
  Show,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
  type ParentProps,
} from "solid-js"
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

const MenuAppearanceContext = createContext<{ appearance: Accessor<MenuAppearance> }>({
  appearance: (): MenuAppearance => "compact",
})

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

function MenuContent(props: ComponentProps<typeof DropdownMenu.Content>) {
  const ctx = useMenuContext()
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <DropdownMenu.Content
      {...r}
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
  const [local, rest] = splitProps(props, ["appearance", "children"])
  const appearance = () => local.appearance ?? "compact"
  return (
    <MenuAppearanceContext.Provider value={{ appearance }}>
      <DropdownMenu {...rest}>{local.children}</DropdownMenu>
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
    <MenuAppearanceContext.Provider value={{ appearance }}>
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
  Trigger: DropdownMenu.Trigger,
  Portal: DropdownMenu.Portal,
  Content: MenuContent,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: DropdownMenu.RadioGroup,
  RadioItem: MenuRadioItem,
  Group: DropdownMenu.Group,
  GroupLabel: MenuGroupLabel,
  Separator: MenuSeparator,
  Sub: DropdownMenu.Sub,
  SubTrigger: MenuSubTrigger,
  SubContent: MenuSubContent,
  Context: MenuContext,
})
