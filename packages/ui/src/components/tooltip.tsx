import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { children, createSignal, Match, onMount, splitProps, Switch, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"

export interface TooltipProps extends ComponentProps<typeof KobalteTooltip> {
  value: JSX.Element
  class?: string
  inactive?: boolean
}

export interface TooltipKeybindProps extends Omit<TooltipProps, "value"> {
  title: string
  keybind: string
}

export function TooltipKeybind(props: TooltipKeybindProps) {
  const [local, others] = splitProps(props, ["title", "keybind"])
  return (
    <Tooltip
      {...others}
      value={
        <div data-slot="tooltip-keybind">
          <span>{local.title}</span>
          <span data-slot="tooltip-keybind-key">{local.keybind}</span>
        </div>
      }
    />
  )
}

export function Tooltip(props: TooltipProps) {
  const [open, setOpen] = createSignal(false)
  const [local, others] = splitProps(props, ["children", "class", "inactive"])

  const c = children(() => local.children)

  onMount(() => {
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
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={true}>
        <KobalteTooltip forceMount gutter={4} {...others} open={open()} onOpenChange={setOpen}>
          <KobalteTooltip.Trigger as={"div"} data-component="tooltip-trigger" class={local.class}>
            {c()}
          </KobalteTooltip.Trigger>
          <KobalteTooltip.Portal>
            <KobalteTooltip.Content data-component="tooltip" data-placement={props.placement}>
              {others.value}
              {/* <KobalteTooltip.Arrow data-slot="tooltip-arrow" /> */}
            </KobalteTooltip.Content>
          </KobalteTooltip.Portal>
        </KobalteTooltip>
      </Match>
    </Switch>
  )
}
