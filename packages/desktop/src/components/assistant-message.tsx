import type { Part, AssistantMessage, ReasoningPart, TextPart, ToolPart, Message } from "@opencode-ai/sdk"
import { children, Component, createMemo, For, Match, Show, Switch, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Markdown } from "./markdown"
import { Checkbox, Collapsible, Diff, Icon, IconProps } from "@opencode-ai/ui"
import { getDirectory, getFilename } from "@/utils"
import type { Tool } from "opencode/tool/tool"
import type { ReadTool } from "opencode/tool/read"
import type { ListTool } from "opencode/tool/ls"
import type { GlobTool } from "opencode/tool/glob"
import type { GrepTool } from "opencode/tool/grep"
import type { WebFetchTool } from "opencode/tool/webfetch"
import type { TaskTool } from "opencode/tool/task"
import type { BashTool } from "opencode/tool/bash"
import type { EditTool } from "opencode/tool/edit"
import type { WriteTool } from "opencode/tool/write"
import type { TodoWriteTool } from "opencode/tool/todo"
import { DiffChanges } from "./diff-changes"

export function AssistantMessage(props: { message: AssistantMessage; parts: Part[] }) {
  const filteredParts = createMemo(() => {
    return props.parts?.filter((x) => {
      if (x.type === "reasoning") return false
      return x.type !== "tool" || x.tool !== "todoread"
    })
  })
  return (
    <div class="w-full flex flex-col items-start gap-4">
      <For each={filteredParts()}>{(part) => <Part part={part} message={props.message} />}</For>
    </div>
  )
}

export function Part(props: { part: Part; message: Message; readonly?: boolean }) {
  const component = createMemo(() => PART_MAPPING[props.part.type as keyof typeof PART_MAPPING])
  return (
    <Show when={component()}>
      <Dynamic component={component()} part={props.part as any} message={props.message} readonly={props.readonly} />
    </Show>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { part: ReasoningPart; message: Message }) {
  return (
    <Show when={props.part.text.trim()}>
      <Markdown text={props.part.text.trim()} />
    </Show>
  )
}

function TextPart(props: { part: TextPart; message: Message }) {
  return (
    <Show when={props.part.text.trim()}>
      <Markdown text={props.part.text.trim()} />
    </Show>
  )
}

function ToolPart(props: { part: ToolPart; message: Message; readonly?: boolean }) {
  const component = createMemo(() => {
    const render = ToolRegistry.render(props.part.tool) ?? GenericTool
    const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    const input = props.part.state.status === "completed" ? props.part.state.input : {}

    return (
      <Dynamic
        component={render}
        input={input}
        tool={props.part.tool}
        metadata={metadata}
        output={props.part.state.status === "completed" ? props.part.state.output : undefined}
        readonly={props.readonly}
      />
    )
  })

  return <Show when={component()}>{component()}</Show>
}

type TriggerTitle = {
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

function BasicTool(props: {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  readonly?: boolean
}) {
  const resolved = children(() => props.children)
  return (
    <Collapsible>
      <Collapsible.Trigger>
        <div class="w-full flex items-center self-stretch gap-5 justify-between">
          <div class="w-full flex items-center self-stretch gap-5">
            <Icon name={props.icon} size="small" class="shrink-0" />
            <div class="grow min-w-0">
              <Switch>
                <Match when={isTriggerTitle(props.trigger) && props.trigger}>
                  {(trigger) => (
                    <div class="w-full flex items-center gap-2 justify-between">
                      <div class="flex items-center gap-2 whitespace-nowrap truncate">
                        <span
                          classList={{
                            "text-12-medium text-text-base": true,
                            [trigger().titleClass ?? ""]: !!trigger().titleClass,
                          }}
                        >
                          {trigger().title}
                        </span>
                        <Show when={trigger().subtitle}>
                          <span
                            classList={{
                              "text-12-medium text-text-weak": true,
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
                                classList={{
                                  "text-12-regular text-text-weak": true,
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
          <Show when={resolved() && !props.readonly}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={resolved() && !props.readonly}>
        <Collapsible.Content>{resolved()}</Collapsible.Content>
      </Show>
    </Collapsible>
    // <>
    //   <Show when={props.part.state.status === "error"}>{props.part.state.error.replace("Error: ", "")}</Show>
    // </>
  )
}

function GenericTool(props: ToolProps<any>) {
  return <BasicTool icon="mcp" trigger={{ title: props.tool }} readonly={props.readonly} />
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  tool: string
  output?: string
  readonly?: boolean
}

const ToolRegistry = (() => {
  const state: Record<
    string,
    {
      name: string
      render?: Component<ToolProps<any>>
    }
  > = {}
  function register<T extends Tool.Info>(input: { name: string; render?: Component<ToolProps<T>> }) {
    state[input.name] = input
    return input
  }
  return {
    register,
    render(name: string) {
      return state[name]?.render
    },
  }
})()

ToolRegistry.register<typeof ReadTool>({
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

ToolRegistry.register<typeof ListTool>({
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

ToolRegistry.register<typeof GlobTool>({
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

ToolRegistry.register<typeof GrepTool>({
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

ToolRegistry.register<typeof WebFetchTool>({
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

ToolRegistry.register<typeof TaskTool>({
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

ToolRegistry.register<typeof BashTool>({
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

ToolRegistry.register<typeof EditTool>({
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

ToolRegistry.register<typeof WriteTool>({
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

ToolRegistry.register<typeof TodoWriteTool>({
  name: "todowrite",
  render(props) {
    return (
      <BasicTool
        icon="checklist"
        trigger={{
          title: "To-dos",
          subtitle: `${props.input.todos?.filter((t) => t.status === "completed").length}/${props.input.todos?.length}`,
        }}
      >
        <Show when={props.input.todos?.length}>
          <div class="px-12 pt-2.5 pb-6 flex flex-col gap-2">
            <For each={props.input.todos}>
              {(todo) => (
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
