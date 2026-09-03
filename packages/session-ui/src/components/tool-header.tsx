import { children, For, Show, type JSX } from "solid-js"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"

export type ToolHeaderProps = {
  title: string
  active?: boolean
  titleClass?: string
  prefix?: string
  suffix?: string
  subtitle?: JSX.Element
  subtitleClass?: string
  subtitleDir?: "ltr" | "rtl"
  directory?: string
  args?: string[]
  argsClass?: string
  action?: JSX.Element
  onSubtitleClick?: () => void
}

/** Shared presentation for tool rows; callers own values, status, and disclosure. */
export function ToolHeader(props: ToolHeaderProps) {
  const subtitle = children(() => props.subtitle)
  const action = children(() => props.action)
  return (
    <div data-component="tool-header" data-slot="basic-tool-tool-info-structured">
      <div data-slot="basic-tool-tool-info-main">
        <Show when={props.prefix}>
          <span data-slot="tool-header-affix">{props.prefix}</span>
        </Show>
        <span data-slot="basic-tool-tool-title" class={props.titleClass}>
          <Show when={props.active !== undefined} fallback={props.title}>
            <TextShimmer text={props.title} active={props.active} />
          </Show>
        </span>
        <Show when={props.suffix}>
          <span data-slot="tool-header-affix">{props.suffix}</span>
        </Show>
        <Show when={subtitle()}>
          <span
            data-slot="basic-tool-tool-subtitle"
            dir={props.subtitleDir}
            classList={{
              [props.subtitleClass ?? ""]: !!props.subtitleClass,
              clickable: !!props.onSubtitleClick,
            }}
            onClick={(event) => {
              if (!props.onSubtitleClick) return
              event.stopPropagation()
              props.onSubtitleClick()
            }}
          >
            {subtitle()}
          </span>
        </Show>
        <For each={props.args}>
          {(arg) => (
            <span data-slot="basic-tool-tool-arg" class={props.argsClass}>
              {arg}
            </span>
          )}
        </For>
      </div>
      <Show when={props.directory}>
        <span data-slot="tool-header-directory" dir="ltr">
          <span>{props.directory}</span>
        </span>
      </Show>
      <Show when={action()}>
        <span data-slot="basic-tool-tool-action">{action()}</span>
      </Show>
    </div>
  )
}
