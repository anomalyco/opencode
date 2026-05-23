import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { createEffect, Match, onCleanup, splitProps, Switch, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"

export interface TooltipProps extends ComponentProps<typeof KobalteTooltip> {
  value: JSX.Element
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
  lazyExpand?: boolean
  lazyMount?: boolean
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
  let ref: HTMLDivElement | undefined
  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
    mounted: false,
  })
  const [local, others] = splitProps(props, [
    "children",
    "class",
    "contentClass",
    "contentStyle",
    "inactive",
    "forceOpen",
    "ignoreSafeArea",
    "openDelay",
    "lazyExpand",
    "lazyMount",
    "value",
  ])

  const close = () => setState("open", false)
  const mount = () => setState("mounted", true)

  const inside = () => {
    const active = document.activeElement
    if (!ref || !active) return false
    return ref.contains(active)
  }

  const drop = (expand = state.expand) => {
    if (expand) return
    if (ref?.matches(":hover")) return
    if (inside()) return
    setState("block", false)
  }

  const sync = () => {
    const expand = !!ref?.querySelector('[aria-expanded="true"], [data-expanded]')
    setState("expand", expand)
    if (expand) {
      setState("block", true)
      close()
      return
    }
    drop(expand)
  }

  const arm = () => {
    setState("block", true)
    close()
  }

  const leave = () => {
    if (!inside()) close()
    drop()
  }

  createEffect(() => {
    if (!ref) return
    if (local.lazyExpand && !state.open) {
      setState("expand", false)
      return
    }
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(ref, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    onCleanup(() => obs.disconnect())
  })

  return (
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={local.lazyMount && !local.forceOpen && !state.mounted}>
        <div
          ref={ref}
          data-component="tooltip-trigger"
          data-lazy-mount
          class={local.class}
          onPointerEnter={mount}
          onFocusIn={mount}
          onPointerDown={arm}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return
            mount()
            arm()
          }}
        >
          {local.children}
        </div>
      </Match>
      <Match when={true}>
        <KobalteTooltip
          gutter={4}
          {...others}
          openDelay={local.openDelay}
          closeDelay={0}
          ignoreSafeArea={local.ignoreSafeArea ?? true}
          open={local.forceOpen || state.open}
          onOpenChange={(open) => {
            if (local.forceOpen) return
            if (state.block && open) return
            setState("open", open)
          }}
        >
          <KobalteTooltip.Trigger
            ref={ref}
            as={"div"}
            data-component="tooltip-trigger"
            class={local.class}
            onPointerEnter={mount}
            onFocusIn={mount}
            onPointerDownCapture={arm}
            onKeyDownCapture={(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return
              arm()
            }}
            onPointerLeave={leave}
            onFocusOut={() => requestAnimationFrame(() => drop())}
          >
            {local.children}
          </KobalteTooltip.Trigger>
          <KobalteTooltip.Portal>
            <KobalteTooltip.Content
              data-component="tooltip"
              data-placement={props.placement}
              data-force-open={local.forceOpen}
              class={local.contentClass}
              style={local.contentStyle}
            >
              {local.value}
              {/* <KobalteTooltip.Arrow data-slot="tooltip-arrow" /> */}
            </KobalteTooltip.Content>
          </KobalteTooltip.Portal>
        </KobalteTooltip>
      </Match>
    </Switch>
  )
}
