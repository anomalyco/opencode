import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { children, createEffect, createSignal, splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"

export interface TooltipProps extends ComponentProps<typeof KobalteTooltip> {
  value: string | (() => string)
  class?: string
}

export function Tooltip(props: TooltipProps) {
  const [open, setOpen] = createSignal(false)
  const [local, others] = splitProps(props, ["class", "children"])

  const c = children(() => local.children)

  createEffect(() => {
    const childElements = c()
    if (childElements instanceof HTMLElement) {
      childElements.addEventListener("focus", () => setOpen(true))
      childElements.addEventListener("blur", () => setOpen(false))
    } else if (Array.isArray(childElements)) {
      for (const child of childElements) {
        if (child instanceof HTMLElement) {
          child.addEventListener("focus", () => setOpen(true))
          child.addEventListener("blur", () => setOpen(false))
        }
      }
    }
  })

  return (
    <KobalteTooltip forceMount {...others} open={open()} onOpenChange={setOpen}>
      <KobalteTooltip.Trigger as={"div"} class="flex items-center">
        {c()}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content
          classList={{
            "z-[1000] max-w-[320px] rounded-md bg-background-element px-2 py-1": true,
            "text-xs font-medium text-text shadow-md pointer-events-none!": true,
            "transition-all duration-150 ease-out": true,
            "transform-gpu transform-origin-[var(--kb-tooltip-content-transform-origin)]": true,
            "data-closed:opacity-0": true,
            "data-expanded:opacity-100 data-expanded:translate-y-0 data-expanded:translate-x-0": true,
            "data-closed:translate-y-1": props.placement === "top",
            "data-closed:-translate-y-1": props.placement === "bottom",
            "data-closed:translate-x-1": props.placement === "left",
            "data-closed:-translate-x-1": props.placement === "right",
            [local.class ?? ""]: !!local.class,
          }}
        >
          {typeof others.value === "function" ? others.value() : others.value}
          <KobalteTooltip.Arrow size={18} />
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  )
}
