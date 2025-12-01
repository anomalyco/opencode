import { Tabs as Kobalte } from "@kobalte/core/tabs"
import { Show, splitProps, type JSX } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"

export interface TabsProps extends ComponentProps<typeof Kobalte> {}
export interface TabsListProps extends ComponentProps<typeof Kobalte.List> {}
export interface TabsTriggerProps extends ComponentProps<typeof Kobalte.Trigger> {
  classes?: {
    button?: string
  }
  hideCloseButton?: boolean
  closeButton?: JSX.Element
}
export interface TabsContentProps extends ComponentProps<typeof Kobalte.Content> {}

function TabsRoot(props: TabsProps) {
  const [split, rest] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-component="tabs"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

function TabsList(props: TabsListProps) {
  const [split, rest] = splitProps(props, ["class", "classList"])
  return (
    <Kobalte.List
      {...rest}
      data-slot="tabs-tabs-list"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

function TabsTrigger(props: ParentProps<TabsTriggerProps>) {
  const [split, rest] = splitProps(props, [
    "class",
    "classList",
    "classes",
    "children",
    "closeButton",
    "hideCloseButton",
  ])
  return (
    <div
      data-slot="tabs-tabs-trigger-wrapper"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Kobalte.Trigger
        {...rest}
        data-slot="tabs-tabs-trigger"
        classList={{ "group/tab": true, [split.classes?.button ?? ""]: split.classes?.button }}
      >
        {split.children}
      </Kobalte.Trigger>
      <Show when={split.closeButton}>
        {(closeButton) => (
          <div data-slot="tabs-tabs-trigger-close-button" data-hidden={split.hideCloseButton}>
            {closeButton()}
          </div>
        )}
      </Show>
    </div>
  )
}

function TabsContent(props: ParentProps<TabsContentProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Content
      {...rest}
      data-slot="tabs-tabs-content"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Kobalte.Content>
  )
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
})
