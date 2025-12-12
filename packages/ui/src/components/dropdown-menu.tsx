import { DropdownMenu as Kobalte } from "@kobalte/core/dropdown-menu"
import { splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"

export interface DropdownMenuProps extends ComponentProps<typeof Kobalte> {}
export interface DropdownMenuTriggerProps extends ComponentProps<typeof Kobalte.Trigger> {}
export interface DropdownMenuIconProps extends ComponentProps<typeof Kobalte.Icon> {}
export interface DropdownMenuPortalProps extends ComponentProps<typeof Kobalte.Portal> {}
export interface DropdownMenuContentProps extends ComponentProps<typeof Kobalte.Content> {}
export interface DropdownMenuArrowProps extends ComponentProps<typeof Kobalte.Arrow> {}
export interface DropdownMenuSeparatorProps extends ComponentProps<typeof Kobalte.Separator> {}
export interface DropdownMenuGroupProps extends ComponentProps<typeof Kobalte.Group> {}
export interface DropdownMenuGroupLabelProps extends ComponentProps<typeof Kobalte.GroupLabel> {}
export interface DropdownMenuItemProps extends ComponentProps<typeof Kobalte.Item> {}
export interface DropdownMenuItemLabelProps extends ComponentProps<typeof Kobalte.ItemLabel> {}
export interface DropdownMenuItemDescriptionProps extends ComponentProps<typeof Kobalte.ItemDescription> {}
export interface DropdownMenuItemIndicatorProps extends ComponentProps<typeof Kobalte.ItemIndicator> {}
export interface DropdownMenuRadioGroupProps extends ComponentProps<typeof Kobalte.RadioGroup> {}
export interface DropdownMenuRadioItemProps extends ComponentProps<typeof Kobalte.RadioItem> {}
export interface DropdownMenuCheckboxItemProps extends ComponentProps<typeof Kobalte.CheckboxItem> {}
export interface DropdownMenuSubProps extends ComponentProps<typeof Kobalte.Sub> {}
export interface DropdownMenuSubTriggerProps extends ComponentProps<typeof Kobalte.SubTrigger> {}
export interface DropdownMenuSubContentProps extends ComponentProps<typeof Kobalte.SubContent> {}

function DropdownMenuRoot(props: DropdownMenuProps) {
  return <Kobalte {...props} data-component="dropdown-menu" />
}

function DropdownMenuTrigger(props: ParentProps<DropdownMenuTriggerProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Trigger
      {...rest}
      data-slot="dropdown-menu-trigger"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Trigger>
  )
}

function DropdownMenuIcon(props: ParentProps<DropdownMenuIconProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Icon
      {...rest}
      data-slot="dropdown-menu-icon"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Icon>
  )
}

function DropdownMenuPortal(props: DropdownMenuPortalProps) {
  return <Kobalte.Portal {...props} />
}

function DropdownMenuContent(props: ParentProps<DropdownMenuContentProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Content
      {...rest}
      data-component="dropdown-menu-content"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Content>
  )
}

function DropdownMenuArrow(props: DropdownMenuArrowProps) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte.Arrow
      {...rest}
      data-slot="dropdown-menu-arrow"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}

function DropdownMenuSeparator(props: DropdownMenuSeparatorProps) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte.Separator
      {...rest}
      data-slot="dropdown-menu-separator"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}

function DropdownMenuGroup(props: ParentProps<DropdownMenuGroupProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Group
      {...rest}
      data-slot="dropdown-menu-group"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Group>
  )
}

function DropdownMenuGroupLabel(props: ParentProps<DropdownMenuGroupLabelProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.GroupLabel
      {...rest}
      data-slot="dropdown-menu-group-label"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.GroupLabel>
  )
}

function DropdownMenuItem(props: ParentProps<DropdownMenuItemProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Item
      {...rest}
      data-slot="dropdown-menu-item"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Item>
  )
}

function DropdownMenuItemLabel(props: ParentProps<DropdownMenuItemLabelProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.ItemLabel
      {...rest}
      data-slot="dropdown-menu-item-label"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.ItemLabel>
  )
}

function DropdownMenuItemDescription(props: ParentProps<DropdownMenuItemDescriptionProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.ItemDescription
      {...rest}
      data-slot="dropdown-menu-item-description"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.ItemDescription>
  )
}

function DropdownMenuItemIndicator(props: ParentProps<DropdownMenuItemIndicatorProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.ItemIndicator
      {...rest}
      data-slot="dropdown-menu-item-indicator"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.ItemIndicator>
  )
}

function DropdownMenuRadioGroup(props: ParentProps<DropdownMenuRadioGroupProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.RadioGroup
      {...rest}
      data-slot="dropdown-menu-radio-group"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.RadioGroup>
  )
}

function DropdownMenuRadioItem(props: ParentProps<DropdownMenuRadioItemProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.RadioItem
      {...rest}
      data-slot="dropdown-menu-radio-item"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.RadioItem>
  )
}

function DropdownMenuCheckboxItem(props: ParentProps<DropdownMenuCheckboxItemProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.CheckboxItem
      {...rest}
      data-slot="dropdown-menu-checkbox-item"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.CheckboxItem>
  )
}

function DropdownMenuSub(props: DropdownMenuSubProps) {
  return <Kobalte.Sub {...props} />
}

function DropdownMenuSubTrigger(props: ParentProps<DropdownMenuSubTriggerProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.SubTrigger
      {...rest}
      data-slot="dropdown-menu-sub-trigger"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.SubTrigger>
  )
}

function DropdownMenuSubContent(props: ParentProps<DropdownMenuSubContentProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.SubContent
      {...rest}
      data-component="dropdown-menu-sub-content"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.SubContent>
  )
}

export const DropdownMenu = Object.assign(DropdownMenuRoot, {
  Trigger: DropdownMenuTrigger,
  Icon: DropdownMenuIcon,
  Portal: DropdownMenuPortal,
  Content: DropdownMenuContent,
  Arrow: DropdownMenuArrow,
  Separator: DropdownMenuSeparator,
  Group: DropdownMenuGroup,
  GroupLabel: DropdownMenuGroupLabel,
  Item: DropdownMenuItem,
  ItemLabel: DropdownMenuItemLabel,
  ItemDescription: DropdownMenuItemDescription,
  ItemIndicator: DropdownMenuItemIndicator,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
})
