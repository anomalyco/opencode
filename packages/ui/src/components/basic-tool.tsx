import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
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
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  defer?: boolean
  locked?: boolean
  onSubtitleClick?: () => void
}

export function BasicTool(props: BasicToolProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)
  const [ready, setReady] = createSignal(open())
  const pending = () => props.status === "pending" || props.status === "running"

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
                          <Show when={pending()} fallback={trigger().title}>
                            <TextShimmer text={trigger().title} />
                          </Show>
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
      <Show when={props.children && !props.hideDetails}>
        <Collapsible.Content>
          <Show when={!props.defer || ready()}>{props.children}</Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

export function GenericTool(props: { tool: string; status?: string; hideDetails?: boolean }) {
  return <BasicTool icon="mcp" status={props.status} trigger={{ title: props.tool }} hideDetails={props.hideDetails} />
}
