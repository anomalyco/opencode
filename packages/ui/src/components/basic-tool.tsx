import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
  Switch,
  type JSX,
} from "solid-js"
import { animate, type AnimationPlaybackControls, tunableSpringValue, COLLAPSIBLE_SPRING } from "./motion"
import { Collapsible } from "./collapsible"
import { TextShimmer } from "./text-shimmer"
import { hold } from "./tool-utils"

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

interface ToolCallPanelBaseProps {
  icon: string
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  status?: string
  animate?: boolean
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  defer?: boolean
  locked?: boolean
  watchDetails?: boolean
  springContent?: boolean
  onSubtitleClick?: () => void
}

function ToolCallTriggerBody(props: {
  trigger: TriggerTitle | JSX.Element
  pending: boolean
  onSubtitleClick?: () => void
  arrow?: boolean
}) {
  return (
    <div data-component="tool-trigger" data-arrow={props.arrow ? "" : undefined}>
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
                      <TextShimmer text={trigger().title} active={props.pending} />
                    </span>
                    <Show when={!props.pending}>
                      <Show when={trigger().subtitle}>
                        <span
                          data-slot="basic-tool-tool-subtitle"
                          classList={{
                            [trigger().subtitleClass ?? ""]: !!trigger().subtitleClass,
                            clickable: !!props.onSubtitleClick,
                          }}
                          onClick={(e) => {
                            if (!props.onSubtitleClick) return
                            e.stopPropagation()
                            props.onSubtitleClick()
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
                  <Show when={!props.pending && trigger().action}>{trigger().action}</Show>
                </div>
              )}
            </Match>
            <Match when={true}>{props.trigger as JSX.Element}</Match>
          </Switch>
        </div>
      </div>
      <Show when={props.arrow}>
        <Collapsible.Arrow />
      </Show>
    </div>
  )
}

function ToolCallPanel(props: ToolCallPanelBaseProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)
  const [ready, setReady] = createSignal(open())
  const pendingRaw = () => props.status === "pending" || props.status === "running"
  const pending = hold(pendingRaw, 1000)
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
        if (!props.defer || props.springContent) return
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
  const initialOpen = open()
  const heightSpring = tunableSpringValue<number>(0, COLLAPSIBLE_SPRING)

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
    fadeAnim = animate(bodyRef, { opacity: 1, filter: "blur(0px)" }, COLLAPSIBLE_SPRING)
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
    fadeAnim = animate(bodyRef, { opacity: 0, filter: "blur(2px)" }, COLLAPSIBLE_SPRING)
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
    if (!props.springContent || props.animate === false || !contentRef || !bodyRef) return

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
    let mountFrame: number | undefined = requestAnimationFrame(() => {
      mountFrame = undefined
      if (!open()) return
      doOpen()
    })
    onCleanup(() => {
      if (mountFrame !== undefined) cancelAnimationFrame(mountFrame)
    })
  })

  createEffect(
    on(
      open,
      (isOpen) => {
        if (!props.springContent || props.animate === false || !contentRef) return
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
        <ToolCallTriggerBody
          trigger={props.trigger}
          pending={pending()}
          onSubtitleClick={props.onSubtitleClick}
          arrow={!!props.children && !props.hideDetails && !props.locked && !pending()}
        />
      </Collapsible.Trigger>
      <Show when={props.springContent && props.animate !== false && props.children && !props.hideDetails}>
        <div
          ref={contentRef}
          data-slot="collapsible-content"
          data-spring-content
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
      <Show when={(!props.springContent || props.animate === false) && props.children && !props.hideDetails}>
        <Collapsible.Content>
          <Show when={!props.defer || ready()}>
            <div data-slot="basic-tool-content-inner">{props.children}</div>
          </Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

function label(input: Record<string, unknown> | undefined) {
  const keys = ["description", "query", "url", "filePath", "path", "pattern", "name"]
  return keys.map((key) => input?.[key]).find((value): value is string => typeof value === "string" && value.length > 0)
}

function args(input: Record<string, unknown> | undefined) {
  if (!input) return []
  const skip = new Set(["description", "query", "url", "filePath", "path", "pattern", "name"])
  return Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") return [`${key}=${value}`]
      if (typeof value === "number") return [`${key}=${value}`]
      if (typeof value === "boolean") return [`${key}=${value}`]
      return []
    })
    .slice(0, 3)
}

export interface ToolCallRowProps {
  variant: "row"
  icon: string
  trigger: TriggerTitle | JSX.Element
  status?: string
  animate?: boolean
  onSubtitleClick?: () => void
  open?: boolean
  showArrow?: boolean
  onOpenChange?: (value: boolean) => void
}
export interface ToolCallPanelProps extends Omit<ToolCallPanelBaseProps, "hideDetails"> {
  variant: "panel"
}
export type ToolCallProps = ToolCallRowProps | ToolCallPanelProps
function ToolCallRoot(props: ToolCallProps) {
  const pending = () => props.status === "pending" || props.status === "running"
  if (props.variant === "row") {
    return (
      <Show
        when={props.onOpenChange}
        fallback={
          <div data-component="collapsible" data-variant="normal" class="tool-collapsible">
            <div data-slot="collapsible-trigger">
              <ToolCallTriggerBody
                trigger={props.trigger}
                pending={pending()}
                onSubtitleClick={props.onSubtitleClick}
              />
            </div>
          </div>
        }
      >
        {(onOpenChange) => (
          <Collapsible open={props.open ?? true} onOpenChange={onOpenChange()} class="tool-collapsible">
            <Collapsible.Trigger>
              <ToolCallTriggerBody
                trigger={props.trigger}
                pending={pending()}
                onSubtitleClick={props.onSubtitleClick}
                arrow={!!props.showArrow}
              />
            </Collapsible.Trigger>
          </Collapsible>
        )}
      </Show>
    )
  }

  const [, rest] = splitProps(props, ["variant"])
  return <ToolCallPanel {...rest} />
}
export const ToolCall = ToolCallRoot

export function GenericTool(props: {
  tool: string
  status?: string
  hideDetails?: boolean
  input?: Record<string, unknown>
}) {
  return (
    <ToolCall
      variant={props.hideDetails ? "row" : "panel"}
      icon="mcp"
      status={props.status}
      trigger={{
        title: `Called \`${props.tool}\``,
        subtitle: label(props.input),
        args: args(props.input),
      }}
    />
  )
}
