import type { JSX } from "solid-js"
import { BasicTool, type BasicToolProps } from "../../../ui/src/components/basic-tool"
import { Markdown } from "../../../ui/src/components/markdown"
import type { ToolComponent } from "../components/message-part"

export type BodyPolicy = "output" | "custom" | "none" | "terminal"
export type CollapsePolicy = "auto" | "never" | "always"

export type ToolPresenterDef = {
  name: string
  icon: BasicToolProps["icon"]
  title: () => string
  subtitle: (input: Record<string, unknown>) => string
  args?: (input: Record<string, unknown>) => string[]
  body?: BodyPolicy
  collapse?: CollapsePolicy
  expandCompleted?: boolean
  renderBody?: (ctx: {
    input: Record<string, unknown>
    output?: string
    status?: string
    metadata: Record<string, unknown>
  }) => JSX.Element
}

function markdownBody(text?: string) {
  if (!text) return
  return (
    <div data-component="tool-output" data-scrollable>
      <Markdown text={text} />
    </div>
  )
}

function terminalBody(text?: string) {
  if (!text) return
  return (
    <div data-component="bash-output">
      <div data-slot="bash-scroll" data-scrollable>
        <pre data-slot="bash-pre">
          <code>{text}</code>
        </pre>
      </div>
    </div>
  )
}

export function presenter(def: ToolPresenterDef): { name: string; render: ToolComponent } {
  return {
    name: def.name,
    render(props: Parameters<ToolComponent>[0]) {
      const bodyPolicy = def.body ?? "output"
      const collapse = def.collapse ?? "auto"

      const body =
        bodyPolicy === "custom" && def.renderBody
          ? def.renderBody({
              input: props.input,
              output: props.output,
              status: props.status,
              metadata: props.metadata,
            })
          : bodyPolicy === "terminal"
            ? terminalBody(props.output)
            : bodyPolicy === "output"
              ? markdownBody(props.output)
              : undefined

      const hasBody = body != null
      const hideDetails = collapse === "never" ? true : collapse === "always" ? false : !hasBody
      const pending = props.status === "pending" || props.status === "running"

      if (def.expandCompleted && !pending && body != null) return body

      return (
        <BasicTool
          {...props}
          icon={def.icon}
          hideDetails={hideDetails}
          trigger={{
            title: def.title(),
            subtitle: def.subtitle(props.input),
            args: def.args?.(props.input) ?? [],
          }}
        >
          {body}
        </BasicTool>
      )
    },
  }
}
