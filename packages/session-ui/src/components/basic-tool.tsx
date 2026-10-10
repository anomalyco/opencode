import { createMemo, For, Match, Show, Switch, type Accessor, type JSX } from "solid-js"
import { Option, Schema } from "effect"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { ToolElapsed } from "./tool-elapsed"
import { animate, type AnimationPlaybackControls } from "motion"
import { useI18n } from "@opencode/ui/context/i18n"
import { Collapsible } from "@opencode/ui/collapsible"
import type { IconProps } from "@opencode/ui/icon"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createDisclosure } from "./disclosure"

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
  time?: SessionMessageAssistantTool["time"]
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
  /** Rendered beside the trigger rather than inside it, so it can be its own button. Shown on hover or focus. */
  action?: JSX.Element
}

export function BasicTool(props: BasicToolProps) {
  const pending = () => props.status === "streaming" || props.status === "running"
  const hasChildren = () => props.hasContent ?? (props.defer ? "children" in props : props.children)

  const disclosure = createDisclosure({
    open: () => props.open,
    defaultOpen: () => props.defaultOpen ?? false,
    forceOpen: () => props.forceOpen ?? false,
    defer: () => props.defer ?? false,
    queue: "deferred",
    locked: () => props.locked ?? false,
    pending,
    allowOpenWhilePending: () => props.allowOpenWhilePending ?? false,
    onOpenChange: (open) => props.onOpenChange?.(open),
  })

  const open = disclosure.open

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
          <ToolElapsed time={props.time} running={props.status === "running"} />
        </div>
      </div>
      <Show when={hasChildren() && !props.hideDetails && disclosure.canToggle()}>
        <Collapsible.Arrow />
      </Show>
    </div>
  )

  return (
    <Collapsible
      open={open()}
      onOpenChange={props.locked ? undefined : disclosure.setOpen}
      class="tool-collapsible"
      data-compact={props.compact ? "true" : undefined}
      data-rail={props.rail === false ? "false" : undefined}
      data-has-action={props.action ? "true" : undefined}
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
      <Show when={props.action}>{(action) => <span data-slot="basic-tool-action">{action()}</span>}</Show>
      <Show when={hasChildren() && !props.hideDetails}>
        <Show
          when={props.locked && open() && !props.defer}
          fallback={
            <Collapsible.Content>
              <Show when={!props.defer || disclosure.mounted()}>{props.children}</Show>
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

export function GenericTool(props: {
  tool: string
  time?: SessionMessageAssistantTool["time"]
  status?: string
  hideDetails?: boolean
  input?: GenericToolInput
}) {
  const i18n = useI18n()

  return (
    <BasicTool
      icon="mcp"
      status={props.status}
      time={props.time}
      trigger={{
        title: i18n.t("ui.basicTool.called", { tool: props.tool }),
        subtitle: label(props.input),
        args: args(props.input),
      }}
      hideDetails={props.hideDetails}
    />
  )
}
