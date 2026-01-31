import { Collapsible as Kobalte, CollapsibleRootProps } from "@kobalte/core/collapsible"
import { Accessor, ComponentProps, createContext, createSignal, ParentProps, splitProps, useContext } from "solid-js"
import { MorphChevron } from "./morph-chevron"

const CollapsibleContext = createContext<Accessor<boolean>>()

export interface CollapsibleProps extends ParentProps<CollapsibleRootProps> {
  class?: string
  classList?: ComponentProps<"div">["classList"]
  variant?: "normal" | "ghost"
}

function CollapsibleRoot(props: CollapsibleProps) {
  const [local, others] = splitProps(props, ["class", "classList", "variant", "open", "onOpenChange", "children"])
  const [internalOpen, setInternalOpen] = createSignal(local.open ?? false)

  const handleOpenChange = (open: boolean) => {
    setInternalOpen(open)
    local.onOpenChange?.(open)
  }

  return (
    <CollapsibleContext.Provider value={internalOpen}>
      <Kobalte
        data-component="collapsible"
        data-variant={local.variant || "normal"}
        open={local.open}
        onOpenChange={handleOpenChange}
        classList={{
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
        {...others}
      >
        {local.children}
      </Kobalte>
    </CollapsibleContext.Provider>
  )
}

function CollapsibleTrigger(props: ComponentProps<typeof Kobalte.Trigger>) {
  return <Kobalte.Trigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent(props: ComponentProps<typeof Kobalte.Content>) {
  return <Kobalte.Content data-slot="collapsible-content" {...props} />
}

function CollapsibleArrow(props?: ComponentProps<"div">) {
  const isOpen = useContext(CollapsibleContext)
  return (
    <div data-slot="collapsible-arrow" {...(props || {})}>
      <MorphChevron expanded={isOpen?.() ?? false} />
    </div>
  )
}

export const Collapsible = Object.assign(CollapsibleRoot, {
  Arrow: CollapsibleArrow,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
})
