import { Collapsible as KobalteCollapsible } from "@kobalte/core/collapsible"
import { splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"
import { Icon, type IconProps } from "@opencode-ai/ui"

export interface CollapsibleProps extends ComponentProps<typeof KobalteCollapsible> {}
export interface CollapsibleTriggerProps extends ComponentProps<typeof KobalteCollapsible.Trigger> {}
export interface CollapsibleContentProps extends ComponentProps<typeof KobalteCollapsible.Content> {}

function CollapsibleRoot(props: CollapsibleProps) {
  return <KobalteCollapsible forceMount {...props} />
}

function CollapsibleTrigger(props: CollapsibleTriggerProps) {
  const [local, others] = splitProps(props, ["class"])
  return (
    <KobalteCollapsible.Trigger
      classList={{
        "w-full group/collapsible": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}

function CollapsibleContent(props: ParentProps<CollapsibleContentProps>) {
  const [local, others] = splitProps(props, ["class", "children"])
  return (
    <KobalteCollapsible.Content
      classList={{
        "h-0 overflow-hidden transition-all duration-100 ease-out": true,
        "data-expanded:h-fit": true,
        [local.class]: !!local.class,
      }}
      {...others}
    >
      {local.children}
    </KobalteCollapsible.Content>
  )
}

function CollapsibleArrow(props: Partial<IconProps>) {
  const [local, others] = splitProps(props, ["class", "name"])
  return (
    <Icon
      name={local.name ?? "chevron-right"}
      classList={{
        "flex-none text-text-muted transition-transform duration-100": true,
        "group-data-[expanded]/collapsible:rotate-90": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}

export const Collapsible = Object.assign(CollapsibleRoot, {
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
  Arrow: CollapsibleArrow,
})
