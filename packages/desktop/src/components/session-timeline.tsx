import { Icon, Tooltip } from "@opencode-ai/ui"
import { Collapsible } from "@/ui"
import type { AssistantMessage, Message, Part, ToolPart } from "@opencode-ai/sdk"
import { DateTime } from "luxon"
import {
  createSignal,
  For,
  Match,
  splitProps,
  Switch,
  type ComponentProps,
  type ParentProps,
  createEffect,
  createMemo,
  Show,
} from "solid-js"
import { getFilename } from "@/utils"
import { Markdown } from "./markdown"
import { Code } from "./code"
import { createElementSize } from "@solid-primitives/resize-observer"
import { createScrollPosition } from "@solid-primitives/scroll"
import { ProgressCircle } from "./progress-circle"
import { pipe, sumBy } from "remeda"
import { useSync } from "@/context/sync"
import { useLocal } from "@/context/local"

function Part(props: ParentProps & ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      classList={{
        ...(local.classList ?? {}),
        "h-6 flex items-center": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      <p class="text-12-medium text-left">{local.children}</p>
    </div>
  )
}

function CollapsiblePart(props: { title: ParentProps["children"] } & ParentProps & ComponentProps<typeof Collapsible>) {
  return (
    <Collapsible {...props}>
      <Collapsible.Trigger class="peer/collapsible">
        <Part>{props.title}</Part>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p class="flex-auto min-w-0 text-pretty">
          <span class="text-12-medium text-text-weak break-words">{props.children}</span>
        </p>
      </Collapsible.Content>
    </Collapsible>
  )
}

function ReadToolPart(props: { part: ToolPart }) {
  const sync = useSync()
  const local = useLocal()
  return (
    <Switch>
      <Match when={props.part.state.status === "pending"}>
        <Part>Reading file...</Part>
      </Match>
      <Match when={props.part.state.status === "completed" && props.part.state}>
        {(state) => {
          const path = state().input["filePath"] as string
          return (
            <Part onClick={() => local.file.open(path)}>
              <span class="">Read</span> {getFilename(path)}
            </Part>
          )
        }}
      </Match>
      <Match when={props.part.state.status === "error" && props.part.state}>
        {(state) => (
          <div>
            <Part>
              <span class="">Read</span> {getFilename(state().input["filePath"] as string)}
            </Part>
            <div class="text-icon-critical-active">{sync.sanitize(state().error)}</div>
          </div>
        )}
      </Match>
    </Switch>
  )
}

function EditToolPart(props: { part: ToolPart }) {
  const sync = useSync()
  return (
    <Switch>
      <Match when={props.part.state.status === "pending"}>
        <Part>Preparing edit...</Part>
      </Match>
      <Match when={props.part.state.status === "completed" && props.part.state}>
        {(state) => (
          <CollapsiblePart
            title={
              <>
                <span class="">Edit</span> {getFilename(state().input["filePath"] as string)}
              </>
            }
          >
            <Code path={state().input["filePath"] as string} code={state().metadata["diff"] as string} />
          </CollapsiblePart>
        )}
      </Match>
      <Match when={props.part.state.status === "error" && props.part.state}>
        {(state) => (
          <CollapsiblePart
            title={
              <>
                <span class="">Edit</span> {getFilename(state().input["filePath"] as string)}
              </>
            }
          >
            <div class="text-icon-critical-active">{sync.sanitize(state().error)}</div>
          </CollapsiblePart>
        )}
      </Match>
    </Switch>
  )
}

function WriteToolPart(props: { part: ToolPart }) {
  const sync = useSync()
  return (
    <Switch>
      <Match when={props.part.state.status === "pending"}>
        <Part>Preparing write...</Part>
      </Match>
      <Match when={props.part.state.status === "completed" && props.part.state}>
        {(state) => (
          <CollapsiblePart
            title={
              <>
                <span class="">Write</span> {getFilename(state().input["filePath"] as string)}
              </>
            }
          >
            <div class="p-2 bg-background-panel rounded-md border border-border-subtle"></div>
          </CollapsiblePart>
        )}
      </Match>
      <Match when={props.part.state.status === "error" && props.part.state}>
        {(state) => (
          <div>
            <Part>
              <span class="">Write</span> {getFilename(state().input["filePath"] as string)}
            </Part>
            <div class="text-icon-critical-active">{sync.sanitize(state().error)}</div>
          </div>
        )}
      </Match>
    </Switch>
  )
}

function BashToolPart(props: { part: ToolPart }) {
  const sync = useSync()
  return (
    <Switch>
      <Match when={props.part.state.status === "pending"}>
        <Part>Writing shell command...</Part>
      </Match>
      <Match when={props.part.state.status === "completed" && props.part.state}>
        {(state) => (
          <CollapsiblePart
            defaultOpen
            title={
              <>
                <span class="">Run command:</span> {state().input["command"]}
              </>
            }
          >
            <Markdown text={`\`\`\`command\n${state().input["command"]}\n${state().output}\`\`\``} />
          </CollapsiblePart>
        )}
      </Match>
      <Match when={props.part.state.status === "error" && props.part.state}>
        {(state) => (
          <CollapsiblePart
            title={
              <>
                <span class="">Shell</span> {state().input["command"]}
              </>
            }
          >
            <div class="text-icon-critical-active">{sync.sanitize(state().error)}</div>
          </CollapsiblePart>
        )}
      </Match>
    </Switch>
  )
}

function ToolPart(props: { part: ToolPart }) {
  // read
  // edit
  // write
  // bash
  // ls
  // glob
  // grep
  // todowrite
  // todoread
  // webfetch
  // websearch
  // patch
  // task
  return (
    <div class="min-w-0 flex-auto text-12-medium">
      <Switch
        fallback={
          <span>
            {props.part.type}:{props.part.tool}
          </span>
        }
      >
        <Match when={props.part.tool === "read"}>
          <ReadToolPart part={props.part} />
        </Match>
        <Match when={props.part.tool === "edit"}>
          <EditToolPart part={props.part} />
        </Match>
        <Match when={props.part.tool === "write"}>
          <WriteToolPart part={props.part} />
        </Match>
        <Match when={props.part.tool === "bash"}>
          <BashToolPart part={props.part} />
        </Match>
      </Switch>
    </div>
  )
}

export default function SessionTimeline(props: { session: string; class?: string }) {
  const sync = useSync()
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | undefined>(undefined)
  const [root, setRoot] = createSignal<HTMLDivElement | undefined>(undefined)
  const [tail, setTail] = createSignal(true)
  const size = createElementSize(root)
  const scroll = createScrollPosition(scrollElement)

  const valid = (part: Part) => {
    if (!part) return false
    switch (part.type) {
      case "step-start":
      case "step-finish":
      case "file":
      case "patch":
        return false
      case "text":
        return !part.synthetic && part.text.trim()
      case "reasoning":
        return part.text.trim()
      case "tool":
        switch (part.tool) {
          case "todoread":
          case "todowrite":
          case "list":
          case "grep":
            return false
        }
        return true
      default:
        return true
    }
  }

  const hasValidParts = (message: Message) => {
    return sync.data.part[message.id]?.filter(valid).length > 0
  }

  const hasTextPart = (message: Message) => {
    return !!sync.data.part[message.id]?.filter(valid).find((p) => p.type === "text")
  }

  const session = createMemo(() => sync.session.get(props.session))
  const messages = createMemo(() => sync.data.message[props.session] ?? [])
  const messagesWithValidParts = createMemo(() => sync.data.message[props.session]?.filter(hasValidParts) ?? [])
  const working = createMemo(() => {
    const last = messages()[messages().length - 1]
    if (!last) return false
    if (last.role === "user") return true
    return !last.time.completed
  })

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const last = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant") as AssistantMessage
  })

  const model = createMemo(() => {
    if (!last()) return
    const model = sync.data.provider.find((x) => x.id === last().providerID)?.models[last().modelID]
    return model
  })

  const tokens = createMemo(() => {
    if (!last()) return
    const tokens = last().tokens
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      compactDisplay: "short",
    }).format(total)
  })

  const context = createMemo(() => {
    if (!last()) return
    if (!model()?.limit.context) return 0
    const tokens = last().tokens
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    return Math.round((total / model()!.limit.context) * 100)
  })

  const getScrollParent = (el: HTMLElement | null): HTMLElement | undefined => {
    let p = el?.parentElement
    while (p && p !== document.body) {
      const s = getComputedStyle(p)
      if (s.overflowY === "auto" || s.overflowY === "scroll") return p
      p = p.parentElement
    }
    return undefined
  }

  createEffect(() => {
    if (!root()) return
    setScrollElement(getScrollParent(root()!))
  })

  const scrollToBottom = () => {
    const element = scrollElement()
    if (!element) return
    element.scrollTop = element.scrollHeight
  }

  createEffect(() => {
    size.height
    if (tail()) scrollToBottom()
  })

  createEffect(() => {
    if (working()) {
      setTail(true)
      scrollToBottom()
    }
  })

  let lastScrollY = 0
  createEffect(() => {
    if (scroll.y < lastScrollY) {
      setTail(false)
    }
    lastScrollY = scroll.y
  })

  const duration = (part: Part) => {
    switch (part.type) {
      default:
        if (
          "time" in part &&
          part.time &&
          "start" in part.time &&
          part.time.start &&
          "end" in part.time &&
          part.time.end
        ) {
          const start = DateTime.fromMillis(part.time.start)
          const end = DateTime.fromMillis(part.time.end)
          return end.diff(start).toFormat("s")
        }
        return ""
    }
  }

  createEffect(() => {
    console.log("WHAT")
    console.log(JSON.stringify(messagesWithValidParts()))
  })

  return (
    <div
      ref={setRoot}
      classList={{
        "select-text flex flex-col text-text-weak": true,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <div class="flex justify-end items-center self-stretch">
        <div class="flex items-center gap-6">
          <Tooltip value={`${tokens()} Tokens`} class="flex items-center gap-1.5">
            <Show when={context()}>
              <ProgressCircle percentage={context()!} />
            </Show>
            <div class="text-14-regular text-text-weak text-right">{context()}%</div>
          </Tooltip>
          <div class="text-14-regular text-text-strong text-right">{cost()}</div>
        </div>
      </div>
      <ul role="list" class="flex flex-col items-start self-stretch">
        <For each={messagesWithValidParts()}>
          {(message) => (
            <div
              classList={{
                "flex flex-col gap-1 justify-center items-start self-stretch": true,
                "mt-6": hasTextPart(message),
              }}
            >
              <For each={sync.data.part[message.id]?.filter(valid) ?? []}>
                {(part) => (
                  <li class="group/li">
                    <Switch fallback={<div class="">{part.type}</div>}>
                      <Match when={part.type === "text" && part}>
                        {(part) => (
                          <Switch>
                            <Match when={message.role === "user"}>
                              <div class="w-fit flex items-center px-3 py-1 rounded-md bg-surface-weak">
                                <span class="text-14-regular text-text-strong whitespace-pre-wrap break-words">
                                  {part().text}
                                </span>
                              </div>
                            </Match>
                            <Match when={message.role === "assistant"}>
                              <Markdown text={sync.sanitize(part().text)} />
                            </Match>
                          </Switch>
                        )}
                      </Match>
                      <Match when={part.type === "reasoning" && part}>
                        {(part) => (
                          <CollapsiblePart
                            title={
                              <Switch fallback={<span class="text-text-weak">Thinking</span>}>
                                <Match when={part().time.end}>
                                  <span class="text-12-medium text-text-weak">Thought</span> for {duration(part())}s
                                </Match>
                              </Switch>
                            }
                          >
                            <Markdown text={part().text} />
                          </CollapsiblePart>
                        )}
                      </Match>
                      <Match when={part.type === "tool" && part}>{(part) => <ToolPart part={part()} />}</Match>
                    </Switch>
                  </li>
                )}
              </For>
            </div>
          )}
        </For>
      </ul>
      <Show when={false}>
        <Collapsible defaultOpen={false}>
          <Collapsible.Trigger>
            <div class="mt-12 ml-1 flex items-center gap-x-2 text-xs text-text-muted">
              <Icon name="file-code" />
              <span>Raw Session Data</span>
              <Collapsible.Arrow class="text-text-muted" />
            </div>
          </Collapsible.Trigger>
          <Collapsible.Content class="mt-5">
            <ul role="list" class="space-y-2">
              <li>
                <Collapsible>
                  <Collapsible.Trigger>
                    <div class="flex items-center gap-x-2 text-xs text-text-muted ml-1">
                      <Icon name="file-code" />
                      <span>session</span>
                      <Collapsible.Arrow class="text-text-muted" />
                    </div>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <Code path="session.json" code={JSON.stringify(session(), null, 2)} />
                  </Collapsible.Content>
                </Collapsible>
              </li>
              <For each={messages()}>
                {(message) => (
                  <>
                    <li>
                      <Collapsible>
                        <Collapsible.Trigger>
                          <div class="flex items-center gap-x-2 text-xs text-text-muted ml-1">
                            <Icon name="file-code" />
                            <span>{message.role === "user" ? "user" : "assistant"}</span>
                            <Collapsible.Arrow class="text-text-muted" />
                          </div>
                        </Collapsible.Trigger>
                        <Collapsible.Content>
                          <Code path={message.id + ".json"} code={JSON.stringify(message, null, 2)} />
                        </Collapsible.Content>
                      </Collapsible>
                    </li>
                    <For each={sync.data.part[message.id]}>
                      {(part) => (
                        <li>
                          <Collapsible>
                            <Collapsible.Trigger>
                              <div class="flex items-center gap-x-2 text-xs text-text-muted ml-1">
                                <Icon name="file-code" />
                                <span>{part.type}</span>
                                <Collapsible.Arrow class="text-text-muted" />
                              </div>
                            </Collapsible.Trigger>
                            <Collapsible.Content>
                              <Code path={message.id + "." + part.id + ".json"} code={JSON.stringify(part, null, 2)} />
                            </Collapsible.Content>
                          </Collapsible>
                        </li>
                      )}
                    </For>
                  </>
                )}
              </For>
            </ul>
          </Collapsible.Content>
        </Collapsible>
      </Show>
    </div>
  )
}
