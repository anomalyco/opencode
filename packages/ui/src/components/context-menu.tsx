import { ContextMenu as Kobalte } from "@kobalte/core/context-menu"
import { splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"

export interface ContextMenuProps extends ComponentProps<typeof Kobalte> {}
export interface ContextMenuTriggerProps extends ComponentProps<typeof Kobalte.Trigger> {}
export interface ContextMenuIconProps extends ComponentProps<typeof Kobalte.Icon> {}
export interface ContextMenuPortalProps extends ComponentProps<typeof Kobalte.Portal> {}
export interface ContextMenuContentProps extends ComponentProps<typeof Kobalte.Content> {}
export interface ContextMenuArrowProps extends ComponentProps<typeof Kobalte.Arrow> {}
export interface ContextMenuSeparatorProps extends ComponentProps<typeof Kobalte.Separator> {}
export interface ContextMenuGroupProps extends ComponentProps<typeof Kobalte.Group> {}
export interface ContextMenuGroupLabelProps extends ComponentProps<typeof Kobalte.GroupLabel> {}
export interface ContextMenuItemProps extends ComponentProps<typeof Kobalte.Item> {}
export interface ContextMenuItemLabelProps extends ComponentProps<typeof Kobalte.ItemLabel> {}
export interface ContextMenuItemDescriptionProps extends ComponentProps<typeof Kobalte.ItemDescription> {}
export interface ContextMenuItemIndicatorProps extends ComponentProps<typeof Kobalte.ItemIndicator> {}
export interface ContextMenuRadioGroupProps extends ComponentProps<typeof Kobalte.RadioGroup> {}
export interface ContextMenuRadioItemProps extends ComponentProps<typeof Kobalte.RadioItem> {}
export interface ContextMenuCheckboxItemProps extends ComponentProps<typeof Kobalte.CheckboxItem> {}
export interface ContextMenuSubProps extends ComponentProps<typeof Kobalte.Sub> {}
export interface ContextMenuSubTriggerProps extends ComponentProps<typeof Kobalte.SubTrigger> {}
export interface ContextMenuSubContentProps extends ComponentProps<typeof Kobalte.SubContent> {}

function ContextMenuRoot(props: ContextMenuProps) {
  return <Kobalte {...props} data-component="context-menu" />
}

function ContextMenuTrigger(props: ParentProps<ContextMenuTriggerProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Trigger
      {...rest}
      data-slot="context-menu-trigger"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Trigger>
  )
}

function ContextMenuIcon(props: ParentProps<ContextMenuIconProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Icon
      {...rest}
      data-slot="context-menu-icon"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Icon>
  )
}

function ContextMenuPortal(props: ContextMenuPortalProps) {
  return <Kobalte.Portal {...props} />
}

function ContextMenuContent(props: ParentProps<ContextMenuContentProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Content
      {...rest}
      data-component="context-menu-content"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Content>
  )
}

function ContextMenuArrow(props: ContextMenuArrowProps) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte.Arrow
      {...rest}
      data-slot="context-menu-arrow"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}

function ContextMenuSeparator(props: ContextMenuSeparatorProps) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte.Separator
      {...rest}
      data-slot="context-menu-separator"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}

function ContextMenuGroup(props: ParentProps<ContextMenuGroupProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Group
      {...rest}
      data-slot="context-menu-group"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Group>
  )
}

function ContextMenuGroupLabel(props: ParentProps<ContextMenuGroupLabelProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.GroupLabel
      {...rest}
      data-slot="context-menu-group-label"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.GroupLabel>
  )
}

function ContextMenuItem(props: ParentProps<ContextMenuItemProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Item
      {...rest}
      data-slot="context-menu-item"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.Item>
  )
}

function ContextMenuItemLabel(props: ParentProps<ContextMenuItemLabelProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.ItemLabel
      {...rest}
      data-slot="context-menu-item-label"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.ItemLabel>
  )
}

function ContextMenuItemDescription(props: ParentProps<ContextMenuItemDescriptionProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.ItemDescription
      {...rest}
      data-slot="context-menu-item-description"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.ItemDescription>
  )
}

function ContextMenuItemIndicator(props: ParentProps<ContextMenuItemIndicatorProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.ItemIndicator
      {...rest}
      data-slot="context-menu-item-indicator"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.ItemIndicator>
  )
}

function ContextMenuRadioGroup(props: ParentProps<ContextMenuRadioGroupProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.RadioGroup
      {...rest}
      data-slot="context-menu-radio-group"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.RadioGroup>
  )
}

function ContextMenuRadioItem(props: ParentProps<ContextMenuRadioItemProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.RadioItem
      {...rest}
      data-slot="context-menu-radio-item"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.RadioItem>
  )
}

function ContextMenuCheckboxItem(props: ParentProps<ContextMenuCheckboxItemProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.CheckboxItem
      {...rest}
      data-slot="context-menu-checkbox-item"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.CheckboxItem>
  )
}

function ContextMenuSub(props: ContextMenuSubProps) {
  return <Kobalte.Sub {...props} />
}

function ContextMenuSubTrigger(props: ParentProps<ContextMenuSubTriggerProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.SubTrigger
      {...rest}
      data-slot="context-menu-sub-trigger"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.SubTrigger>
  )
}

function ContextMenuSubContent(props: ParentProps<ContextMenuSubContentProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.SubContent
      {...rest}
      data-component="context-menu-sub-content"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Kobalte.SubContent>
  )
}

export const ContextMenu = Object.assign(ContextMenuRoot, {
  Trigger: ContextMenuTrigger,
  Icon: ContextMenuIcon,
  Portal: ContextMenuPortal,
  Content: ContextMenuContent,
  Arrow: ContextMenuArrow,
  Separator: ContextMenuSeparator,
  Group: ContextMenuGroup,
  GroupLabel: ContextMenuGroupLabel,
  Item: ContextMenuItem,
  ItemLabel: ContextMenuItemLabel,
  ItemDescription: ContextMenuItemDescription,
  ItemIndicator: ContextMenuItemIndicator,
  RadioGroup: ContextMenuRadioGroup,
  RadioItem: ContextMenuRadioItem,
  CheckboxItem: ContextMenuCheckboxItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
})
