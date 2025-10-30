import type { Part, TextPart, ToolPart, Message } from "@opencode-ai/sdk"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Markdown } from "./markdown"
import { Card, Checkbox, Diff, Icon } from "@opencode-ai/ui"
import { Message as MessageDisplay, registerPartComponent } from "@opencode-ai/ui"
import { BasicTool, GenericTool, ToolRegistry, DiffChanges } from "@opencode-ai/ui"
import { getDirectory, getFilename } from "@/utils"

export function Message(props: { message: Message; parts: Part[] }) {
  return <MessageDisplay message={props.message} parts={props.parts} />
}

registerPartComponent("text", function TextPartDisplay(props) {
  const part = props.part as TextPart
  return (
    <Show when={part.text.trim()}>
      <Markdown text={part.text.trim()} class="mt-8" />
    </Show>
  )
})

registerPartComponent("reasoning", function ReasoningPartDisplay(props) {
  const part = props.part as any
  return (
    <Show when={part.text.trim()}>
      <Markdown text={part.text.trim()} />
    </Show>
  )
})

registerPartComponent("tool", function ToolPartDisplay(props) {
  const part = props.part as ToolPart
  const component = createMemo(() => {
    const render = ToolRegistry.render(part.tool) ?? GenericTool
    const metadata = part.state.status === "pending" ? {} : (part.state.metadata ?? {})
    const input = part.state.status === "completed" ? part.state.input : {}

    return (
      <Switch>
        <Match when={part.state.status === "error" && part.state.error}>
          {(error) => {
            const cleaned = error().replace("Error: ", "")
            const [title, ...rest] = cleaned.split(": ")
            return (
              <Card variant="error">
                <div class="flex items-center gap-2">
                  <Icon name="circle-ban-sign" size="small" class="text-icon-critical-active" />
                  <Switch>
                    <Match when={title}>
                      <div class="flex items-center gap-2">
                        <div class="text-12-medium text-[var(--ember-light-11)] capitalize">{title}</div>
                        <span>{rest.join(": ")}</span>
                      </div>
                    </Match>
                    <Match when={true}>{cleaned}</Match>
                  </Switch>
                </div>
              </Card>
            )
          }}
        </Match>
        <Match when={true}>
          <Dynamic
            component={render}
            input={input}
            tool={part.tool}
            metadata={metadata}
            output={part.state.status === "completed" ? part.state.output : undefined}
            hideDetails={props.hideDetails}
          />
        </Match>
      </Switch>
    )
  })

  return <Show when={component()}>{component()}</Show>
})

ToolRegistry.register({
  name: "read",
  render(props) {
    return (
      <BasicTool
        icon="glasses"
        trigger={{ title: "Read", subtitle: props.input.filePath ? getFilename(props.input.filePath) : "" }}
      />
    )
  },
})

ToolRegistry.register({
  name: "list",
  render(props) {
    return (
      <BasicTool icon="bullet-list" trigger={{ title: "List", subtitle: getDirectory(props.input.path || "/") }}>
        <Show when={false && props.output}>
          <div class="whitespace-pre">{props.output}</div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "glob",
  render(props) {
    return (
      <BasicTool
        icon="magnifying-glass-menu"
        trigger={{
          title: "Glob",
          subtitle: getDirectory(props.input.path || "/"),
          args: props.input.pattern ? ["pattern=" + props.input.pattern] : [],
        }}
      >
        <Show when={false && props.output}>
          <div class="whitespace-pre">{props.output}</div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "grep",
  render(props) {
    const args = []
    if (props.input.pattern) args.push("pattern=" + props.input.pattern)
    if (props.input.include) args.push("include=" + props.input.include)
    return (
      <BasicTool
        icon="magnifying-glass-menu"
        trigger={{
          title: "Grep",
          subtitle: getDirectory(props.input.path || "/"),
          args,
        }}
      >
        <Show when={false && props.output}>
          <div class="whitespace-pre">{props.output}</div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "webfetch",
  render(props) {
    return (
      <BasicTool
        icon="window-cursor"
        trigger={{
          title: "Webfetch",
          subtitle: props.input.url || "",
          args: props.input.format ? ["format=" + props.input.format] : [],
          action: (
            <div class="size-6 flex items-center justify-center">
              <Icon name="square-arrow-top-right" size="small" />
            </div>
          ),
        }}
      >
        <Show when={false && props.output}>
          <div class="whitespace-pre">{props.output}</div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "task",
  render(props) {
    return (
      <BasicTool
        icon="task"
        trigger={{
          title: `${props.input.subagent_type || props.tool} Agent`,
          titleClass: "capitalize",
          subtitle: props.input.description,
        }}
      >
        <Show when={false && props.output}>
          <div class="whitespace-pre">{props.output}</div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "bash",
  render(props) {
    return (
      <BasicTool
        icon="console"
        trigger={{
          title: "Shell",
          subtitle: "Ran " + props.input.command,
        }}
      >
        <Show when={false && props.output}>
          <div class="whitespace-pre">{props.output}</div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "edit",
  render(props) {
    return (
      <BasicTool
        icon="code-lines"
        trigger={
          <div class="flex items-center justify-between w-full">
            <div class="flex items-center gap-2">
              <div class="text-12-medium text-text-base capitalize">Edit</div>
              <div class="flex">
                <Show when={props.input.filePath?.includes("/")}>
                  <span class="text-text-weak">{getDirectory(props.input.filePath!)}</span>
                </Show>
                <span class="text-text-strong">{getFilename(props.input.filePath ?? "")}</span>
              </div>
            </div>
            <div class="flex gap-4 items-center justify-end">
              <Show when={props.metadata.filediff}>
                <DiffChanges diff={props.metadata.filediff} />
              </Show>
            </div>
          </div>
        }
      >
        <Show when={props.metadata.filediff}>
          <div class="border-t border-border-weaker-base">
            <Diff
              before={{ name: getFilename(props.metadata.filediff.path), contents: props.metadata.filediff.before }}
              after={{ name: getFilename(props.metadata.filediff.path), contents: props.metadata.filediff.after }}
            />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "write",
  render(props) {
    return (
      <BasicTool
        icon="code-lines"
        trigger={
          <div class="flex items-center justify-between w-full">
            <div class="flex items-center gap-2">
              <div class="text-12-medium text-text-base capitalize">Write</div>
              <div class="flex">
                <Show when={props.input.filePath?.includes("/")}>
                  <span class="text-text-weak">{getDirectory(props.input.filePath!)}</span>
                </Show>
                <span class="text-text-strong">{getFilename(props.input.filePath ?? "")}</span>
              </div>
            </div>
            <div class="flex gap-4 items-center justify-end">{/* <DiffChanges diff={diff} /> */}</div>
          </div>
        }
      >
        <Show when={false && props.output}>
          <div class="whitespace-pre">{props.output}</div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "todowrite",
  render(props) {
    return (
      <BasicTool
        icon="checklist"
        trigger={{
          title: "To-dos",
          subtitle: `${props.input.todos?.filter((t: any) => t.status === "completed").length}/${props.input.todos?.length}`,
        }}
      >
        <Show when={props.input.todos?.length}>
          <div class="px-12 pt-2.5 pb-6 flex flex-col gap-2">
            <For each={props.input.todos}>
              {(todo: any) => (
                <Checkbox readOnly checked={todo.status === "completed"}>
                  <div classList={{ "line-through text-text-weaker": todo.status === "completed" }}>{todo.content}</div>
                </Checkbox>
              )}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})
