import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { children, createSignal, Match, onMount, Show, splitProps, Switch, type JSX } from "solid-js"
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
  // Include forceMount in local to strip it out - we never want forceMount on tooltips
  const [local, others] = splitProps(props, ["children", "class", "inactive", "forceMount"])

  const c = children(() => local.children)

  // Treat empty/falsy values as inactive to prevent ghost tooltips
  const isInactive = () => {
    if (local.inactive) return true
    const value = others.value
    // Check for falsy values (null, undefined, empty string, false)
    if (!value) return true
    // Check for empty string specifically
    if (typeof value === "string" && value.trim() === "") return true
    return false
  }

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
      <Match when={isInactive()}>{local.children}</Match>
      <Match when={true}>
        <KobalteTooltip gutter={4} {...others} open={open()} onOpenChange={setOpen}>
          <KobalteTooltip.Trigger as={"div"} data-component="tooltip-trigger" class={local.class}>
            {c()}
          </KobalteTooltip.Trigger>
          <Show when={open()}>
            <KobalteTooltip.Portal>
              <KobalteTooltip.Content data-component="tooltip" data-placement={props.placement}>
                {others.value}
              </KobalteTooltip.Content>
            </KobalteTooltip.Portal>
          </Show>
        </KobalteTooltip>
      </Match>
    </Switch>
  )
}
