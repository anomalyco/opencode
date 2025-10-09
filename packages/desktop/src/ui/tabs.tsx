import { Tabs as KobalteTabs } from "@kobalte/core/tabs"
import { splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"

export interface TabsProps extends ComponentProps<typeof KobalteTabs> {}
export interface TabsListProps extends ComponentProps<typeof KobalteTabs.List> {}
export interface TabsTriggerProps extends ComponentProps<typeof KobalteTabs.Trigger> {}
export interface TabsContentProps extends ComponentProps<typeof KobalteTabs.Content> {}

function TabsRoot(props: TabsProps) {
  return <KobalteTabs {...props} />
}

function TabsList(props: TabsListProps) {
  const [local, others] = splitProps(props, ["class"])
  return (
    <KobalteTabs.List
      classList={{
        "relative flex items-center bg-background overflow-x-auto no-scrollbar": true,
        "divide-x divide-border-subtle/40": true,
        "after:content-[''] after:block after:grow after:h-8": true,
        "after:border-l empty:after:border-l-0! after:border-b after:border-border-subtle/40": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}

function TabsTrigger(props: ParentProps<TabsTriggerProps>) {
  const [local, others] = splitProps(props, ["class", "children"])
  return (
    <KobalteTabs.Trigger
      classList={{
        "relative px-3 h-8 flex items-center": true,
        "text-sm font-medium text-text-muted/60 cursor-pointer": true,
        "whitespace-nowrap shrink-0 border-b border-border-subtle/40": true,
        "disabled:pointer-events-none disabled:opacity-50": true,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring": true,
        "data-[selected]:text-text data-[selected]:bg-background-panel": true,
        "data-[selected]:!border-b-transparent": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      {local.children}
    </KobalteTabs.Trigger>
  )
}

function TabsContent(props: ParentProps<TabsContentProps>) {
  const [local, others] = splitProps(props, ["class", "children"])
  return (
    <KobalteTabs.Content
      classList={{
        "bg-background-panel overflow-y-auto h-full no-scrollbar": true,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      {local.children}
    </KobalteTabs.Content>
  )
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
})
