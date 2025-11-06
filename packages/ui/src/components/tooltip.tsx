import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { children, createEffect, createSignal, splitProps, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"

export interface TooltipProps extends ComponentProps<typeof KobalteTooltip> {
  value: JSX.Element
  class?: string
}

export function Tooltip(props: TooltipProps) {
  const [open, setOpen] = createSignal(false)
  const [local, others] = splitProps(props, ["children", "class"])

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
    <KobalteTooltip forceMount gutter={4} {...others} open={open()} onOpenChange={setOpen}>
      <KobalteTooltip.Trigger as={"div"} data-component="tooltip-trigger" class={local.class}>
        {c()}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content data-component="tooltip" data-placement={props.placement}>
          {others.value}
          {/* <KobalteTooltip.Arrow data-slot="arrow" /> */}
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  )
}
