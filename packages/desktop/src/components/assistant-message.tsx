import type { Part, AssistantMessage, ReasoningPart, TextPart, ToolPart } from "@opencode-ai/sdk"
import { children, Component, createMemo, For, Match, Show, Switch, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Markdown } from "./markdown"
import { Collapsible, Icon, IconProps } from "@opencode-ai/ui"
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
import { DiffChanges } from "./diff-changes"

export function AssistantMessage(props: { message: AssistantMessage; parts: Part[] }) {
  return (
    <div class="w-full flex flex-col items-start gap-4">
      <For each={props.parts}>
        {(part) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic component={component()} part={part as any} message={props.message} />
            </Show>
          )
        }}
      </For>
    </div>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { part: ReasoningPart; message: AssistantMessage }) {
  return null
  // return (
  //   <Show when={props.part.text.trim()}>
  //     <div>{props.part.text}</div>
  //   </Show>
  // )
}

function TextPart(props: { part: TextPart; message: AssistantMessage }) {
  return (
    <Show when={props.part.text.trim()}>
      <Markdown text={props.part.text.trim()} />
    </Show>
  )
}

function ToolPart(props: { part: ToolPart; message: AssistantMessage }) {
  // const sync = useSync()

  const component = createMemo(() => {
    const render = ToolRegistry.render(props.part.tool) ?? GenericTool

    const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    const input = props.part.state.status === "completed" ? props.part.state.input : {}
    // const permissions = sync.data.permission[props.message.sessionID] ?? []
    // const permissionIndex = permissions.findIndex((x) => x.callID === props.part.callID)
    // const permission = permissions[permissionIndex]

    return (
      <>
        <Dynamic
          component={render}
          input={input}
          tool={props.part.tool}
          metadata={metadata}
          // permission={permission?.metadata ?? {}}
          output={props.part.state.status === "completed" ? props.part.state.output : undefined}
        />
        {/* <Show when={props.part.state.status === "error"}>{props.part.state.error.replace("Error: ", "")}</Show> */}
      </>
    )
  })

  return <Show when={component()}>{component()}</Show>
}

type TriggerTitle = {
  title: string
  subtitle?: string
  args?: string[]
  action?: JSX.Element
}

const isTriggerTitle = (val: any): val is TriggerTitle => {
  return typeof val === "object" && val !== null && "title" in val && !(val instanceof Node)
}

function BasicTool(props: { icon: IconProps["name"]; trigger: TriggerTitle | JSX.Element; children?: JSX.Element }) {
  const resolved = children(() => props.children)

  return (
    <Collapsible>
      <Collapsible.Trigger>
        <div class="w-full flex items-center self-stretch gap-5 justify-between">
          <div class="w-full flex items-center self-stretch gap-5">
            <Icon name={props.icon} size="small" />
            <Switch>
              <Match when={isTriggerTitle(props.trigger)}>
                <div class="w-full flex items-center gap-2 justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-12-medium text-text-base capitalize">
                      {(props.trigger as TriggerTitle).title}
                    </span>
                    <Show when={(props.trigger as TriggerTitle).subtitle}>
                      <span class="text-12-medium text-text-weak">{(props.trigger as TriggerTitle).subtitle}</span>
                    </Show>
                    <Show when={(props.trigger as TriggerTitle).args?.length}>
                      <For each={(props.trigger as TriggerTitle).args}>
                        {(arg) => <span class="text-12-regular text-text-weaker">{arg}</span>}
                      </For>
                    </Show>
                  </div>
                  <Show when={(props.trigger as TriggerTitle).action}>{(props.trigger as TriggerTitle).action}</Show>
                </div>
              </Match>
              <Match when={true}>{props.trigger as JSX.Element}</Match>
            </Switch>
          </div>
          <Show when={resolved()}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={props.children}>
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

function GenericTool(props: ToolProps<any>) {
  return <BasicTool icon="mcp" trigger={{ title: props.tool }} />
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  // permission: Record<string, any>
  tool: string
  output?: string
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
        trigger={{ title: props.tool, subtitle: props.input.filePath ? getFilename(props.input.filePath) : "" }}
      />
    )
  },
})

ToolRegistry.register<typeof ListTool>({
  name: "list",
  render(props) {
    return (
      <BasicTool icon="bullet-list" trigger={{ title: props.tool, subtitle: getDirectory(props.input.path || "/") }}>
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
          title: props.tool,
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
          title: props.tool,
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
          title: props.tool,
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
            <div class="flex items-center gap-5">
              <div class="text-12-medium text-text-base capitalize">Edit</div>
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

ToolRegistry.register<typeof WriteTool>({
  name: "write",
  render(props) {
    return (
      <BasicTool
        icon="code-lines"
        trigger={
          <div class="flex items-center justify-between w-full">
            <div class="flex items-center gap-5">
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
