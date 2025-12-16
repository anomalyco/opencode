import { Component, createMemo, For, Match, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import {
  AssistantMessage,
  FilePart,
  Message as MessageType,
  Part as PartType,
  TextPart,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"
import { BasicTool } from "./basic-tool"
import { GenericTool } from "./basic-tool"
import { Card } from "./card"
import { Icon } from "./icon"
import { Checkbox } from "./checkbox"
import { DiffChanges } from "./diff-changes"
import { Markdown } from "./markdown"
import { getDirectory as _getDirectory, getFilename } from "@opencode-ai/util/path"

export interface MessageProps {
  message: MessageType
  parts: PartType[]
}

export interface MessagePartProps {
  part: PartType
  message: MessageType
  hideDetails?: boolean
}

export type PartComponent = Component<MessagePartProps>

export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

function relativizeProjectPaths(text: string, directory?: string) {
  if (!text) return ""
  if (!directory) return text
  return text.split(directory).join("")
}

function getDirectory(path: string | undefined) {
  const data = useData()
  return relativizeProjectPaths(_getDirectory(path), data.directory)
}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

export function Message(props: MessageProps) {
  return (
    <Switch>
      <Match when={props.message.role === "user" && props.message}>
        {(userMessage) => <UserMessageDisplay message={userMessage() as UserMessage} parts={props.parts} />}
      </Match>
      <Match when={props.message.role === "assistant" && props.message}>
        {(assistantMessage) => (
          <AssistantMessageDisplay message={assistantMessage() as AssistantMessage} parts={props.parts} />
        )}
      </Match>
    </Switch>
  )
}

export function AssistantMessageDisplay(props: { message: AssistantMessage; parts: PartType[] }) {
  const filteredParts = createMemo(() => {
    return props.parts?.filter((x) => {
      return x.type !== "tool" || (x as ToolPart).tool !== "todoread"
    })
  })
  return <For each={filteredParts()}>{(part) => <Part part={part} message={props.message} />}</For>
}

export function UserMessageDisplay(props: { message: UserMessage; parts: PartType[] }) {
  const textPart = createMemo(
    () => props.parts?.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined,
  )

  const text = createMemo(() => textPart()?.text || "")

  const files = createMemo(() => (props.parts?.filter((p) => p.type === "file") as FilePart[]) ?? [])

  const attachments = createMemo(() =>
    files()?.filter((f) => {
      const mime = f.mime
      return mime.startsWith("image/") || mime === "application/pdf"
    }),
  )

  const inlineFiles = createMemo(() =>
    files().filter((f) => {
      const mime = f.mime
      return !mime.startsWith("image/") && mime !== "application/pdf" && f.source?.text?.start !== undefined
    }),
  )

  return (
    <div data-component="user-message">
      <Show when={attachments().length > 0}>
        <div data-slot="user-message-attachments">
          <For each={attachments()}>
            {(file) => (
              <div data-slot="user-message-attachment" data-type={file.mime.startsWith("image/") ? "image" : "file"}>
                <Show
                  when={file.mime.startsWith("image/") && file.url}
                  fallback={
                    <div data-slot="user-message-attachment-icon">
                      <Icon name="folder" />
                    </div>
                  }
                >
                  <img data-slot="user-message-attachment-image" src={file.url} alt={file.filename ?? "attachment"} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={text()}>
        <div data-slot="user-message-text">
          <HighlightedText text={text()} references={inlineFiles()} />
        </div>
      </Show>
    </div>
  )
}

function HighlightedText(props: { text: string; references: FilePart[] }) {
  const segments = createMemo(() => {
    const text = props.text
    const refs = [...props.references].sort((a, b) => (a.source?.text?.start ?? 0) - (b.source?.text?.start ?? 0))

    const result: { text: string; highlight?: boolean }[] = []
    let lastIndex = 0

    for (const ref of refs) {
      const start = ref.source?.text?.start
      const end = ref.source?.text?.end

      if (start === undefined || end === undefined || start < lastIndex) continue

      if (start > lastIndex) {
        result.push({ text: text.slice(lastIndex, start) })
      }

      result.push({ text: text.slice(start, end), highlight: true })
      lastIndex = end
    }

    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex) })
    }

    return result
  })

  return (
    <For each={segments()}>
      {(segment) => <span classList={{ "text-text-strong font-medium": segment.highlight }}>{segment.text}</span>}
    </For>
  )
}

export function Part(props: MessagePartProps) {
  const component = createMemo(() => PART_MAPPING[props.part.type])
  return (
    <Show when={component()}>
      <Dynamic component={component()} part={props.part} message={props.message} hideDetails={props.hideDetails} />
    </Show>
  )
}

export interface ToolProps {
  input: Record<string, any>
  metadata: Record<string, any>
  tool: string
  output?: string
  hideDetails?: boolean
}

export type ToolComponent = Component<ToolProps>

const state: Record<
  string,
  {
    name: string
    render?: ToolComponent
  }
> = {}

export function registerTool(input: { name: string; render?: ToolComponent }) {
  state[input.name] = input
  return input
}

export function getTool(name: string) {
  return state[name]?.render
}

export const ToolRegistry = {
  register: registerTool,
  render: getTool,
}

PART_MAPPING["tool"] = function ToolPartDisplay(props) {
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
                <div data-component="tool-error">
                  <Icon name="circle-ban-sign" size="small" />
                  <Switch>
                    <Match when={title && title.length < 30}>
                      <div data-slot="message-part-tool-error-content">
                        <div data-slot="message-part-tool-error-title">{title}</div>
                        <span data-slot="message-part-tool-error-message">{rest.join(": ")}</span>
                      </div>
                    </Match>
                    <Match when={true}>
                      <span data-slot="message-part-tool-error-message">{cleaned}</span>
                    </Match>
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
}

PART_MAPPING["text"] = function TextPartDisplay(props) {
  const data = useData()
  const part = props.part as TextPart
  const content = createMemo(() => (part.text ?? "").trim())
  const displayText = createMemo(() => relativizeProjectPaths(content(), data.directory))

  return (
    <Show when={displayText()}>
      <div data-component="text-part">
        <Markdown text={displayText()} />
      </div>
    </Show>
  )
}

PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
  const part = props.part as any
  return (
    <Show when={part.text.trim()}>
      <div data-component="reasoning-part">
        <Markdown text={part.text.trim()} />
      </div>
    </Show>
  )
}

ToolRegistry.register({
  name: "read",
  render(props) {
    return (
      <BasicTool
        icon="glasses"
        trigger={{
          title: "Read",
          subtitle: props.input.filePath ? getFilename(props.input.filePath) : "",
        }}
      />
    )
  },
})

ToolRegistry.register({
  name: "list",
  render(props) {
    return (
      <BasicTool icon="bullet-list" trigger={{ title: "List", subtitle: getDirectory(props.input.path || "/") }}>
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
            </div>
          )}
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
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
            </div>
          )}
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
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
            </div>
          )}
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
            <div data-component="tool-action">
              <Icon name="square-arrow-top-right" size="small" />
            </div>
          ),
        }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
            </div>
          )}
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
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
            </div>
          )}
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
          subtitle: props.input.description,
        }}
      >
        <div data-component="tool-output" data-scrollable>
          <Markdown
            text={`\`\`\`command\n$ ${props.input.command}${props.output ? "\n\n" + props.output : ""}\n\`\`\``}
          />
        </div>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "edit",
  render(props) {
    const diffComponent = useDiffComponent()
    return (
      <BasicTool
        defaultOpen
        icon="code-lines"
        trigger={
          <div data-component="edit-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">Edit</div>
              <div data-slot="message-part-path">
                <Show when={props.input.filePath?.includes("/")}>
                  <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                </Show>
                <span data-slot="message-part-filename">{getFilename(props.input.filePath ?? "")}</span>
              </div>
            </div>
            <div data-slot="message-part-actions">
              <Show when={props.metadata.filediff}>
                <DiffChanges changes={props.metadata.filediff} />
              </Show>
            </div>
          </div>
        }
      >
        <Show when={props.metadata.filediff}>
          <div data-component="edit-content">
            <Dynamic
              component={diffComponent}
              before={{
                name: getFilename(props.metadata.filediff.path),
                contents: props.metadata.filediff.before,
              }}
              after={{
                name: getFilename(props.metadata.filediff.path),
                contents: props.metadata.filediff.after,
              }}
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
    console.log(props)
    return (
      <BasicTool
        icon="code-lines"
        trigger={
          <div data-component="write-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">Write</div>
              <div data-slot="message-part-path">
                <Show when={props.input.filePath?.includes("/")}>
                  <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                </Show>
                <span data-slot="message-part-filename">{getFilename(props.input.filePath ?? "")}</span>
              </div>
            </div>
            <div data-slot="message-part-actions">{/* <DiffChanges diff={diff} /> */}</div>
          </div>
        }
      >
        {/* <Show when={props.input.content}> */}
        {/*   <div data-component="write-content"> */}
        {/*     <Code */}
        {/*       file={{ */}
        {/*         name: props.input.filePath, */}
        {/*         contents: props.input.content, */}
        {/*         cacheKey: checksum(props.input.content), */}
        {/*       }} */}
        {/*       overflow="scroll" */}
        {/*       class="pb-40" */}
        {/*     /> */}
        {/*   </div> */}
        {/* </Show> */}
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "todowrite",
  render(props) {
    return (
      <BasicTool
        defaultOpen
        icon="checklist"
        trigger={{
          title: "To-dos",
          subtitle: `${props.input.todos?.filter((t: any) => t.status === "completed").length}/${props.input.todos?.length}`,
        }}
      >
        <Show when={props.input.todos?.length}>
          <div data-component="todos">
            <For each={props.input.todos}>
              {(todo: any) => (
                <Checkbox readOnly checked={todo.status === "completed"}>
                  <div data-slot="message-part-todo-content" data-completed={todo.status === "completed"}>
                    {todo.content}
                  </div>
                </Checkbox>
              )}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})
