import { Collapsible as Kobalte, CollapsibleRootProps, useCollapsibleContext } from "@kobalte/core/collapsible"
import { ComponentProps, createEffect, onCleanup, ParentProps, Show, splitProps } from "solid-js"
import { Icon } from "@opencode/ui/icon"

export interface CollapsibleProps extends ParentProps<CollapsibleRootProps> {
  class?: string
  classList?: ComponentProps<"div">["classList"]
  variant?: "normal" | "ghost"
}

function CollapsibleRoot(props: CollapsibleProps) {
  const [local, others] = splitProps(props, ["class", "classList", "variant"])

  return (
    <Kobalte
      data-component="collapsible"
      data-variant={local.variant || "normal"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}

function CollapsibleTrigger(props: ComponentProps<typeof Kobalte.Trigger>) {
  return <Kobalte.Trigger data-slot="collapsible-trigger" {...props} />
}

// Kobalte's content reads its own animation and size each time it opens or closes so a CSS animation can play, which
// forces a style and layout pass per collapsible: a group of tool calls opening forced one for each tool in it. No
// collapsible here animates its content, so it mounts and unmounts with the open state.
function CollapsibleContent(props: ComponentProps<"div">) {
  const context = useCollapsibleContext()
  const [local, others] = splitProps(props, ["id"])
  const id = () => local.id ?? context.generateId("content")

  createEffect(() => onCleanup(context.registerContentId(id())))

  return (
    <Show when={context.shouldMount()}>
      <div id={id()} data-slot="collapsible-content" {...context.dataset()} {...others} />
    </Show>
  )
}

function CollapsibleArrow(props?: ComponentProps<"div">) {
  return (
    <div data-slot="collapsible-arrow" {...(props || {})}>
      <span data-slot="collapsible-arrow-icon">
        <Icon name="fill-triangle-down" />
      </span>
    </div>
  )
}

export const Collapsible = Object.assign(CollapsibleRoot, {
  Arrow: CollapsibleArrow,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
})
