import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import {
  createContext,
  createEffect,
  Match,
  onCleanup,
  splitProps,
  Switch,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import "./tooltip-v2.css"

export interface TooltipV2Props extends ComponentProps<typeof KobalteTooltip> {
  value: JSX.Element
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
}

const Group = createContext<{ triggers: Set<HTMLElement>; active?: HTMLElement; closedAt: number }>()

export function TooltipV2Group(props: ParentProps) {
  return <Group.Provider value={{ triggers: new Set(), closedAt: 0 }}>{props.children}</Group.Provider>
}

export function TooltipV2(props: TooltipV2Props) {
  let ref: HTMLDivElement | undefined
  const group = useContext(Group)
  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
    instant: false,
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
    "value",
  ])

  const warm = () =>
    !!group && ((group.active !== undefined && group.active !== ref) || Date.now() - group.closedAt < 300)

  const close = () => {
    if (group && group.active === ref) {
      group.active = undefined
      if (state.open) group.closedAt = Date.now()
    }
    setState("open", false)
  }

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

  const leave = (event: PointerEvent) => {
    if (!inside()) {
      // Kobalte invokes this handler before its own close callback.
      if (group && state.open) {
        setState(
          "instant",
          [...group.triggers].some(
            (trigger) =>
              trigger !== ref && event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget),
          ),
        )
      }
      close()
    }
    drop()
  }

  createEffect(() => {
    const trigger = ref
    if (!trigger) return
    group?.triggers.add(trigger)
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(trigger, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    onCleanup(() => {
      obs.disconnect()
      group?.triggers.delete(trigger)
      if (group && group.active === trigger) group.active = undefined
    })
  })

  let justClickedTrigger = false

  return (
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={true}>
        <KobalteTooltip
          gutter={4}
          skipDelayDuration={300}
          {...others}
          // Controlled pointer-leave closes bypass Kobalte's global skip-delay timer.
          openDelay={warm() ? 0 : (local.openDelay ?? 400)}
          closeDelay={0}
          ignoreSafeArea={local.ignoreSafeArea ?? true}
          open={local.forceOpen || state.open}
          onOpenChange={(open) => {
            if (local.forceOpen) return
            if (state.block && open) return
            if (justClickedTrigger) {
              justClickedTrigger = false
              return
            }
            if (group) {
              setState(
                "instant",
                open ? warm() : [...group.triggers].some((trigger) => trigger !== ref && trigger.matches(":hover")),
              )
              if (open) group.active = ref
              if (!open && group.active === ref) group.active = undefined
              if (!open && state.open) group.closedAt = Date.now()
            }
            setState("open", open)
          }}
        >
          <KobalteTooltip.Trigger
            ref={ref}
            as="div"
            data-component="tooltip-v2-trigger"
            class={local.class}
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
              ref={(el) => {
                const theme = ref?.closest("[data-theme]")?.getAttribute("data-theme")
                if (theme) el.setAttribute("data-theme", theme)
              }}
              data-component="tooltip-v2"
              data-placement={props.placement}
              data-force-open={local.forceOpen}
              data-instant={state.instant || undefined}
              class={local.contentClass}
              style={local.contentStyle}
              onPointerDownOutside={(e) => {
                if (ref === e.target || (e.target instanceof Node && ref?.contains(e.target))) {
                  justClickedTrigger = true
                }
                e.preventDefault()
              }}
            >
              {local.value}
            </KobalteTooltip.Content>
          </KobalteTooltip.Portal>
        </KobalteTooltip>
      </Match>
    </Switch>
  )
}
