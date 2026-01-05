import { createEffect, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { Collapsible } from "./collapsible"
import { Icon, IconProps } from "./icon"

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
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  onSubtitleClick?: () => void
}

export function BasicTool(props: BasicToolProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)

  createEffect(() => {
    if (props.forceOpen) setOpen(true)
  })

  return (
    <Collapsible open={open()} onOpenChange={setOpen}>
      <Collapsible.Trigger>
        <div data-component="tool-trigger">
          <div data-slot="basic-tool-tool-trigger-content">
            <Icon name={props.icon} size="small" />
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
                          {trigger().title}
                        </span>
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
                      </div>
                      <Show when={trigger().action}>{trigger().action}</Show>
                    </div>
                  )}
                </Match>
                <Match when={true}>{props.trigger as JSX.Element}</Match>
              </Switch>
            </div>
          </div>
          <Show when={props.children && !props.hideDetails}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={props.children && !props.hideDetails}>
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

export function GenericTool(props: {
  tool: string
  input?: Record<string, any>
  output?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
}) {
  const hasContent = () => (props.input && Object.keys(props.input).length > 0) || props.output

  return (
    <BasicTool
      icon="mcp"
      trigger={{ title: props.tool }}
      hideDetails={props.hideDetails}
      defaultOpen={props.defaultOpen}
      forceOpen={props.forceOpen}
    >
      <Show when={hasContent()}>
        <div data-component="tool-output" data-scrollable>
          <Show when={props.input && Object.keys(props.input).length > 0}>
            <div data-slot="generic-tool-section">
              <div data-slot="generic-tool-label">Input</div>
              <pre data-slot="generic-tool-content">{JSON.stringify(props.input, null, 2)}</pre>
            </div>
          </Show>
          <Show when={props.output}>
            <div data-slot="generic-tool-section">
              <div data-slot="generic-tool-label">Output</div>
              <pre data-slot="generic-tool-content">{props.output}</pre>
            </div>
          </Show>
        </div>
      </Show>
    </BasicTool>
  )
}
