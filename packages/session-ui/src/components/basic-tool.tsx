import {
  createEffect,
  createMemo,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  type Accessor,
  type JSX,
} from "solid-js"
import { Option, Schema } from "effect"
import { useI18n } from "@opencode/ui/context/i18n"
import { createStore } from "solid-js/store"
import { Collapsible } from "@opencode/ui/collapsible"
import type { IconProps } from "@opencode/ui/icon"
import { TextShimmer } from "@opencode/ui/text-shimmer"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  action?: JSX.Element
}

const isTriggerTitle = (value: TriggerTitle | JSX.Element): value is TriggerTitle =>
  value instanceof Object && !("nodeType" in value) && "title" in value

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element | ((open: Accessor<boolean>) => JSX.Element)
  children?: JSX.Element
  /** Declare known content without constructing lazy JSX to test its presence. */
  hasContent?: boolean
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  forceOpen?: boolean
  allowOpenWhilePending?: boolean
  defer?: boolean
  locked?: boolean
  rail?: boolean
  onSubtitleClick?: () => void
  onTriggerClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>
  onTriggerKeyDown?: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent>
  triggerHref?: string
  triggerAsLink?: boolean
  clickable?: boolean
  compact?: boolean
}

const deferredMounts: Array<{ active: boolean; fn: () => void }> = []

let deferredFrame: number | undefined

function flushDeferredMounts() {
  while (deferredMounts.length > 0) {
    // Timeline tools are mounted top-to-bottom, but the viewport starts at the latest turn.
    // Pop from the end so heavy default-open bodies near the bottom become interactive first.
    const item = deferredMounts.pop()!

    if (item.active) {
      deferredFrame = deferredMounts.length > 0 ? requestAnimationFrame(flushDeferredMounts) : undefined
      item.fn()

      return
    }
  }

  deferredFrame = undefined
}

function scheduleDeferredFlush() {
  if (deferredFrame !== undefined) return
  deferredFrame = requestAnimationFrame(() => {
    deferredFrame = requestAnimationFrame(flushDeferredMounts)
  })
}

function scheduleDeferredMount(fn: () => void) {
  const item = { active: true, fn }
  deferredMounts.push(item)
  scheduleDeferredFlush()

  return () => {
    item.active = false
  }
}

function scheduleFrameMount(fn: () => void) {
  const frame = requestAnimationFrame(fn)

  return () => cancelAnimationFrame(frame)
}

export function BasicTool(props: BasicToolProps) {
  const [state, setState] = createStore({
    open: props.defaultOpen ?? false,
    ready: !props.defer && (props.defaultOpen ?? false),
  })

  const open = () => props.open ?? state.open
  const ready = () => state.ready
  const pending = () => props.status === "streaming" || props.status === "running"
  const hasChildren = () => props.hasContent ?? (props.defer ? "children" in props : props.children)

  const triggerContent = createMemo(() => {
    const value = props.trigger

    return value instanceof Function ? value(open) : value
  })

  const triggerTitle = createMemo(() => {
    const value = triggerContent()

    return isTriggerTitle(value) ? value : undefined
  })

  const triggerElement = () => {
    const value = triggerContent()

    return isTriggerTitle(value) ? undefined : value
  }

  let cancelReady: (() => void) | undefined

  const cancel = () => {
    cancelReady?.()
    cancelReady = undefined
  }

  const scheduleReady = (initial = false) => {
    cancel()
    cancelReady = (initial ? scheduleDeferredMount : scheduleFrameMount)(() => {
      cancelReady = undefined

      if (!open()) return
      setState("ready", true)
    })
  }

  onCleanup(cancel)

  onMount(() => {
    if (props.defer && open()) scheduleReady(true)
  })

  const setOpen = (value: boolean) => {
    if (props.open === undefined) setState("open", value)
    props.onOpenChange?.(value)
  }

  createEffect(() => {
    if (!props.forceOpen) return

    if (open()) return
    setOpen(true)
  })

  createEffect(
    on(
      open,
      (value) => {
        if (!props.defer) return

        if (!value) {
          cancel()
          setState("ready", false)

          return
        }

        scheduleReady()
      },
      { defer: true },
    ),
  )

  const handleOpenChange = (value: boolean) => {
    if (pending() && !props.allowOpenWhilePending) return

    if (props.locked && !value) return
    setOpen(value)
  }

  const trigger = () => (
    <div
      data-component="tool-trigger"
      data-clickable={props.clickable ? "true" : undefined}
      data-hide-details={props.hideDetails ? "true" : undefined}
    >
      <div data-slot="basic-tool-tool-trigger-content">
        <div data-slot="basic-tool-tool-info">
          <Switch>
            <Match when={triggerTitle()}>
              {(title) => (
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span
                      data-slot="basic-tool-tool-title"
                      classList={{
                        [title().titleClass ?? ""]: !!title().titleClass,
                      }}
                    >
                      <TextShimmer text={title().title} active={pending()} />
                    </span>
                    <Show when={!pending() || title().subtitle || title().args?.length}>
                      <Show when={title().subtitle}>
                        <span
                          data-slot="basic-tool-tool-subtitle"
                          classList={{
                            [title().subtitleClass ?? ""]: !!title().subtitleClass,
                            clickable: !!props.onSubtitleClick,
                          }}
                          onClick={(e) => {
                            if (props.onSubtitleClick) {
                              e.stopPropagation()
                              props.onSubtitleClick()
                            }
                          }}
                        >
                          {title().subtitle}
                        </span>
                      </Show>
                      <Show when={title().args?.length}>
                        <For each={title().args}>
                          {(arg) => (
                            <span
                              data-slot="basic-tool-tool-arg"
                              classList={{
                                [title().argsClass ?? ""]: !!title().argsClass,
                              }}
                            >
                              {arg}
                            </span>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                  <Show when={!pending() && title().action}>
                    <span data-slot="basic-tool-tool-action">{title().action}</span>
                  </Show>
                </div>
              )}
            </Match>
            <Match when={true}>{triggerElement()}</Match>
          </Switch>
        </div>
      </div>
      <Show when={hasChildren() && !props.hideDetails && !props.locked && (!pending() || props.allowOpenWhilePending)}>
        <Collapsible.Arrow />
      </Show>
    </div>
  )

  return (
    <Collapsible
      open={open()}
      onOpenChange={props.locked ? undefined : handleOpenChange}
      class="tool-collapsible"
      data-compact={props.compact ? "true" : undefined}
      data-rail={props.rail === false ? "false" : undefined}
    >
      <Show
        when={!props.locked && (props.triggerAsLink || props.triggerHref)}
        fallback={
          <Show
            when={!props.locked}
            fallback={
              <div
                data-slot="collapsible-trigger"
                data-locked
                data-hide-details={props.hideDetails ? "true" : undefined}
              >
                {trigger()}
              </div>
            }
          >
            <Collapsible.Trigger
              data-hide-details={props.hideDetails ? "true" : undefined}
              onClick={props.onTriggerClick}
            >
              {trigger()}
            </Collapsible.Trigger>
          </Show>
        }
      >
        <Collapsible.Trigger
          as="a"
          href={props.triggerHref}
          role={!props.triggerHref && props.clickable ? "button" : undefined}
          tabIndex={!props.triggerHref && props.clickable ? 0 : undefined}
          data-hide-details={props.hideDetails ? "true" : undefined}
          onClick={props.onTriggerClick}
          onKeyDown={props.onTriggerKeyDown}
        >
          {trigger()}
        </Collapsible.Trigger>
      </Show>
      <Show when={hasChildren() && !props.hideDetails}>
        <Show
          when={props.locked && open() && !props.defer}
          fallback={
            <Collapsible.Content>
              <Show when={!props.defer || ready()}>{props.children}</Show>
            </Collapsible.Content>
          }
        >
          <div data-slot="collapsible-content" data-expanded="">
            {props.children}
          </div>
        </Show>
      </Show>
    </Collapsible>
  )
}

// SAFETY: tool input is an open per-tool record. GenericTool shows arbitrary keys and decodes each value it reads.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- see SAFETY above
type GenericToolInput = Record<string, unknown>

const labelKeys = ["description", "query", "url", "path", "pattern", "name"]

const labelValue = Schema.decodeUnknownOption(Schema.NonEmptyString)

const argValue = Schema.decodeUnknownOption(Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))

function label(input: GenericToolInput | undefined) {
  return labelKeys.flatMap((key) => Option.toArray(labelValue(input?.[key])))[0]
}

function args(input: GenericToolInput | undefined) {
  if (!input) return []

  return Object.entries(input)
    .filter(([key]) => !labelKeys.includes(key))
    .flatMap(([key, value]) => Option.toArray(argValue(value)).map((arg) => `${key}=${arg}`))
    .slice(0, 3)
}

export function GenericTool(props: { tool: string; status?: string; hideDetails?: boolean; input?: GenericToolInput }) {
  const i18n = useI18n()

  return (
    <BasicTool
      icon="mcp"
      status={props.status}
      trigger={{
        title: i18n.t("ui.basicTool.called", { tool: props.tool }),
        subtitle: label(props.input),
        args: args(props.input),
      }}
      hideDetails={props.hideDetails}
    />
  )
}
