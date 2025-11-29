import { children, For, Match, Show, Switch, type JSX } from "solid-js"
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
  return typeof val === "object" && val !== null && "title" in val && !(val instanceof Node)
}

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  hideDetails?: boolean
}

export function BasicTool(props: BasicToolProps) {
  const resolved = children(() => props.children)
  return (
    <Collapsible>
      <Collapsible.Trigger>
        <div data-component="tool-trigger">
          <div data-slot="basic-tool-tool-trigger-content">
            <Icon name={props.icon} size="small" data-slot="basic-tool-tool-icon" />
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
          <Show when={resolved() && !props.hideDetails}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={resolved() && !props.hideDetails}>
        <Collapsible.Content>{resolved()}</Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

export function GenericTool(props: { tool: string; hideDetails?: boolean }) {
  return <BasicTool icon="mcp" trigger={{ title: props.tool }} hideDetails={props.hideDetails} />
}
