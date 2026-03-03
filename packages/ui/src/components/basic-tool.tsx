import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { animate, type AnimationPlaybackControls, springValue, TOOL_HEIGHT_SPRING, FADE_SPRING } from "./motion"
import { Collapsible } from "./collapsible"
import type { IconProps } from "./icon"
import { TextShimmer } from "./text-shimmer"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  action?: JSX.Element
}

const isTriggerTitle = (val: any): val is TriggerTitle => {
  return (
    typeof val === "object" && val !== null && "title" in val && (typeof Node === "undefined" || !(val instanceof Node))
  )
}

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  status?: string
  debugID?: string
  animate?: boolean
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  defer?: boolean
  locked?: boolean
  watchDetails?: boolean
  animated?: boolean
  animateIn?: boolean
  onSubtitleClick?: () => void
}

export function BasicTool(props: BasicToolProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)
  const [ready, setReady] = createSignal(open())
  const pending = () => props.status === "pending" || props.status === "running"
  const watchDetails = () => props.watchDetails !== false

  let frame: number | undefined

  const cancel = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }

  onCleanup(cancel)

  createEffect(() => {
    if (props.forceOpen) setOpen(true)
  })

  createEffect(
    on(
      open,
      (value) => {
        if (!props.defer) return
        if (!value) {
          cancel()
          setReady(false)
          return
        }

        cancel()
        frame = requestAnimationFrame(() => {
          frame = undefined
          if (!open()) return
          setReady(true)
        })
      },
      { defer: true },
    ),
  )

  // Animated content height — single springValue drives all height changes
  let contentRef: HTMLDivElement | undefined
  let bodyRef: HTMLDivElement | undefined
  let fadeAnim: AnimationPlaybackControls | undefined
  let observer: ResizeObserver | undefined
  let resizeFrame: number | undefined
  const initialOpen = props.animateIn ? false : open()
  const heightSpring = springValue<number>(0, TOOL_HEIGHT_SPRING)

  const read = () => Math.max(0, Math.ceil(bodyRef?.getBoundingClientRect().height ?? 0))

  const doOpen = () => {
    if (!contentRef || !bodyRef) return
    contentRef.style.display = ""
    // Ensure fade starts from 0 if content was hidden (first open or after close cleared styles)
    if (bodyRef.style.opacity === "") {
      bodyRef.style.opacity = "0"
      bodyRef.style.filter = "blur(2px)"
    }
    const next = read()
    fadeAnim?.stop()
    fadeAnim = animate(bodyRef, { opacity: 1, filter: "blur(0px)" }, FADE_SPRING)
    fadeAnim.finished.then(() => {
      if (!bodyRef) return
      bodyRef.style.opacity = ""
      bodyRef.style.filter = ""
    })
    heightSpring.set(next)
  }

  const doClose = () => {
    if (!contentRef || !bodyRef) return
    fadeAnim?.stop()
    fadeAnim = animate(bodyRef, { opacity: 0, filter: "blur(2px)" }, FADE_SPRING)
    fadeAnim.finished.then(() => {
      if (!contentRef || open()) return
      contentRef.style.display = "none"
    })
    heightSpring.set(0)
  }

  const grow = () => {
    if (!contentRef || !open()) return
    const next = read()
    if (Math.abs(next - heightSpring.get()) < 1) return
    heightSpring.set(next)
  }

  onMount(() => {
    if (!props.animated || props.animate === false || !contentRef || !bodyRef) return

    const offChange = heightSpring.on("change", (v) => {
      if (!contentRef) return
      contentRef.style.height = `${Math.max(0, Math.ceil(v))}px`
    })
    onCleanup(() => {
      offChange()
    })

    if (watchDetails()) {
      observer = new ResizeObserver(() => {
        if (resizeFrame !== undefined) return
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          grow()
        })
      })
      observer.observe(bodyRef)
    }

    if (!open()) return
    if (contentRef.style.display !== "none") {
      const next = read()
      heightSpring.jump(next)
      contentRef.style.height = `${next}px`
      return
    }
    requestAnimationFrame(() => {
      if (!open()) return
      doOpen()
    })
  })

  createEffect(
    on(
      open,
      (isOpen) => {
        if (!props.animated || props.animate === false || !contentRef) return
        if (isOpen) doOpen()
        else doClose()
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    observer?.disconnect()
    fadeAnim?.stop()
    heightSpring.destroy()
  })

  const handleOpenChange = (value: boolean) => {
    if (pending()) return
    if (props.locked && !value) return
    setOpen(value)
  }

  return (
    <Collapsible open={open()} onOpenChange={handleOpenChange} class="tool-collapsible">
      <Collapsible.Trigger>
        <div data-component="tool-trigger">
          <div data-slot="basic-tool-tool-trigger-content">
            <div data-slot="basic-tool-tool-info">
              <Switch>
                <Match when={isTriggerTitle(props.trigger) && props.trigger}>
                  {(trigger) => (
                    <div data-slot="basic-tool-tool-info-structured">
                      <div data-slot="basic-tool-tool-info-main">
                        <span
                          data-slot="basic-tool-tool-title"
                          classList={{
                            [trigger().titleClass ?? ""]: !!trigger().titleClass,
                          }}
                        >
                          <TextShimmer text={trigger().title} active={pending()} />
                        </span>
                        <Show when={!pending()}>
                          <Show when={trigger().subtitle}>
                            <span
                              data-slot="basic-tool-tool-subtitle"
                              classList={{
                                [trigger().subtitleClass ?? ""]: !!trigger().subtitleClass,
                                clickable: !!props.onSubtitleClick,
                              }}
                              onClick={(e) => {
                                if (props.onSubtitleClick) {
                                  e.stopPropagation()
                                  props.onSubtitleClick()
                                }
                              }}
                            >
                              {trigger().subtitle}
                            </span>
                          </Show>
                          <Show when={trigger().args?.length}>
                            <For each={trigger().args}>
                              {(arg) => (
                                <span
                                  data-slot="basic-tool-tool-arg"
                                  classList={{
                                    [trigger().argsClass ?? ""]: !!trigger().argsClass,
                                  }}
                                >
                                  {arg}
                                </span>
                              )}
                            </For>
                          </Show>
                        </Show>
                      </div>
                      <Show when={!pending() && trigger().action}>{trigger().action}</Show>
                    </div>
                  )}
                </Match>
                <Match when={true}>{props.trigger as JSX.Element}</Match>
              </Switch>
            </div>
          </div>
          <Show when={props.children && !props.hideDetails && !props.locked && !pending()}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={props.animated && props.animate !== false && props.children && !props.hideDetails}>
        <div
          ref={contentRef}
          data-slot="collapsible-content"
          data-animated
          style={{
            height: initialOpen ? "auto" : "0px",
            overflow: "hidden",
            display: initialOpen ? undefined : "none",
          }}
        >
          <div ref={bodyRef} data-slot="basic-tool-content-inner">
            {props.children}
          </div>
        </div>
      </Show>
      <Show when={(!props.animated || props.animate === false) && props.children && !props.hideDetails}>
        <Collapsible.Content>
          <Show when={!props.defer || ready()}>
            <div data-slot="basic-tool-content-inner">{props.children}</div>
          </Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

export function GenericTool(props: { tool: string; status?: string; hideDetails?: boolean }) {
  return <BasicTool icon="mcp" status={props.status} trigger={{ title: props.tool }} hideDetails={props.hideDetails} />
}
