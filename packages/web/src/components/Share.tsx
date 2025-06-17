import { type JSX } from "solid-js"
import {
  For,
  Show,
  Match,
  Switch,
  onMount,
  onCleanup,
  splitProps,
  createMemo,
  createEffect,
  createSignal,
} from "solid-js"
import { DateTime } from "luxon"
import { createStore, reconcile } from "solid-js/store"
import type { Diagnostic } from "vscode-languageserver-types"
import { IconOpenAI, IconGemini, IconAnthropic } from "./icons/custom"
import {
  IconCpuChip,
  IconSparkles,
  IconGlobeAlt,
  IconDocument,
  IconQueueList,
  IconUserCircle,
  IconChevronDown,
  IconCommandLine,
  IconChevronRight,
  IconDocumentPlus,
  IconPencilSquare,
  IconRectangleStack,
  IconMagnifyingGlass,
  IconWrenchScrewdriver,
  IconDocumentMagnifyingGlass,
} from "./icons"
import DiffView from "./DiffView"
import CodeBlock from "./CodeBlock"
import MarkdownView from "./MarkdownView"
import styles from "./share.module.css"
import { type UIMessage } from "ai"

const MIN_DURATION = 2

type Status =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "reconnecting"

type SessionMessage = UIMessage<{
  time: {
    created: number
    completed?: number
  }
  assistant?: {
    modelID: string
    providerID: string
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
    }
  }
  sessionID: string
  tool: Record<
    string,
    {
      [key: string]: any
      time: {
        start: number
        end: number
      }
    }
  >
}>

type SessionInfo = {
  title: string
  cost?: number
}

type TodoStatus = "pending" | "in_progress" | "completed"

interface Todo {
  id: string
  content: string
  status: TodoStatus
  priority: "low" | "medium" | "high"
}

function sortTodosByStatus(todos: Todo[]) {
  const statusPriority: Record<TodoStatus, number> = {
    in_progress: 0,
    pending: 1,
    completed: 2,
  }

  return todos
    .slice()
    .sort((a, b) => statusPriority[a.status] - statusPriority[b.status])
}

function scrollToAnchor(id: string) {
  const el = document.getElementById(id)
  if (!el) return

  el.scrollIntoView({ behavior: "smooth" })
}

function getFileType(path: string) {
  return path.split(".").pop()
}

function formatDuration(ms: number): string {
  const ONE_SECOND = 1000
  const ONE_MINUTE = 60 * ONE_SECOND

  if (ms >= ONE_MINUTE) {
    const minutes = Math.floor(ms / ONE_MINUTE)
    return minutes === 1 ? `1min` : `${minutes}mins`
  }

  if (ms >= ONE_SECOND) {
    const seconds = Math.floor(ms / ONE_SECOND)
    return `${seconds}s`
  }

  return `${ms}ms`
}

// Converts nested objects/arrays into [path, value] pairs.
// E.g. {a:{b:{c:1}}, d:[{e:2}, 3]} => [["a.b.c",1], ["d[0].e",2], ["d[1]",3]]
function flattenToolArgs(obj: any, prefix: string = ""): Array<[string, any]> {
  const entries: Array<[string, any]> = []

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (value !== null && typeof value === "object") {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const arrayPath = `${path}[${index}]`
          if (item !== null && typeof item === "object") {
            entries.push(...flattenToolArgs(item, arrayPath))
          } else {
            entries.push([arrayPath, item])
          }
        })
      } else {
        entries.push(...flattenToolArgs(value, path))
      }
    } else {
      entries.push([path, value])
    }
  }

  return entries
}

/**
 * Return a flat array of error diagnostics, in the format:
 *   "ERROR [65:20] Property 'x' does not exist on type 'Y'"
 */
export function getDiagnostics(
  diagnosticsByFile: Record<string, Diagnostic[]>,
): string[] {
  const result: string[] = []

  if (diagnosticsByFile === undefined) return result

  for (const diags of Object.values(diagnosticsByFile)) {
    for (const d of diags) {
      // Only keep diagnostics explicitly marked as Error (severity === 1)
      if (d.severity !== 1) continue

      const line = d.range.start.line + 1 // 1-based
      const column = d.range.start.character + 1 // 1-based

      result.push(`ERROR [${line}:${column}] ${d.message}`)
    }
  }

  return result
}

function stripEnclosingTag(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/
  const match = text.match(wrappedRe)
  return match ? match[2] : text
}

function getStatusText(status: [Status, string?]): string {
  switch (status[0]) {
    case "connected":
      return "Connected"
    case "connecting":
      return "Connecting..."
    case "disconnected":
      return "Disconnected"
    case "reconnecting":
      return "Reconnecting..."
    case "error":
      return status[1] || "Error"
    default:
      return "Unknown"
  }
}

function ProviderIcon(props: { provider: string; size?: number }) {
  const size = props.size || 16
  return (
    <Switch fallback={<IconSparkles width={size} height={size} />}>
      <Match when={props.provider === "openai"}>
        <IconOpenAI width={size} height={size} />
      </Match>
      <Match when={props.provider === "anthropic"}>
        <IconAnthropic width={size} height={size} />
      </Match>
      <Match when={props.provider === "gemini"}>
        <IconGemini width={size} height={size} />
      </Match>
    </Switch>
  )
}

interface ResultsButtonProps extends JSX.HTMLAttributes<HTMLButtonElement> {
  showCopy?: string
  hideCopy?: string
  results: boolean
}
function ResultsButton(props: ResultsButtonProps) {
  const [local, rest] = splitProps(props, ["results", "showCopy", "hideCopy"])
  return (
    <button
      type="button"
      data-element-button-text
      data-element-button-more
      {...rest}
    >
      <span>
        {local.results
          ? local.hideCopy || "Hide results"
          : local.showCopy || "Show results"}
      </span>
      <span data-button-icon>
        <Show
          when={local.results}
          fallback={<IconChevronRight width={10} height={10} />}
        >
          <IconChevronDown width={10} height={10} />
        </Show>
      </span>
    </button>
  )
}

interface TextPartProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string
  expand?: boolean
  highlight?: boolean
}
function TextPart(props: TextPartProps) {
  const [local, rest] = splitProps(props, ["text", "expand", "highlight"])
  const [expanded, setExpanded] = createSignal(false)
  const [overflowed, setOverflowed] = createSignal(false)
  let preEl: HTMLPreElement | undefined

  function checkOverflow() {
    if (preEl && !local.expand) {
      setOverflowed(preEl.scrollHeight > preEl.clientHeight + 1)
    }
  }

  onMount(() => {
    checkOverflow()
    window.addEventListener("resize", checkOverflow)
  })

  createEffect(() => {
    local.text
    setTimeout(checkOverflow, 0)
  })

  onCleanup(() => {
    window.removeEventListener("resize", checkOverflow)
  })

  return (
    <div
      class={styles["message-text"]}
      data-highlight={local.highlight}
      data-expanded={expanded() || local.expand === true}
      {...rest}
    >
      <pre ref={(el) => (preEl = el)}>{local.text}</pre>
      {((!local.expand && overflowed()) || expanded()) && (
        <button
          type="button"
          data-element-button-text
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

interface MarkdownPartProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string
  expand?: boolean
}
function MarkdownPart(props: MarkdownPartProps) {
  const [local, rest] = splitProps(props, ["text", "expand"])
  const [expanded, setExpanded] = createSignal(false)
  const [overflowed, setOverflowed] = createSignal(false)
  let divEl: HTMLDivElement | undefined

  function checkOverflow() {
    if (divEl && !local.expand) {
      setOverflowed(divEl.scrollHeight > divEl.clientHeight + 1)
    }
  }

  onMount(() => {
    checkOverflow()
    window.addEventListener("resize", checkOverflow)
  })

  createEffect(() => {
    local.text
    setTimeout(checkOverflow, 0)
  })

  onCleanup(() => {
    window.removeEventListener("resize", checkOverflow)
  })

  return (
    <div
      class={styles["message-markdown"]}
      data-expanded={expanded() || local.expand === true}
      {...rest}
    >
      <MarkdownView
        data-elment-markdown
        markdown={local.text}
        ref={(el) => (divEl = el)}
      />
      {((!local.expand && overflowed()) || expanded()) && (
        <button
          type="button"
          data-element-button-text
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

interface TerminalPartProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string
  desc?: string
  expand?: boolean
}
function TerminalPart(props: TerminalPartProps) {
  const [local, rest] = splitProps(props, ["text", "desc", "expand"])
  const [expanded, setExpanded] = createSignal(false)
  const [overflowed, setOverflowed] = createSignal(false)
  let preEl: HTMLElement | undefined

  function checkOverflow() {
    if (!preEl) return

    const code = preEl.getElementsByTagName("code")[0]

    if (code && !local.expand) {
      setOverflowed(preEl.clientHeight < code.offsetHeight)
    }
  }

  onMount(() => {
    window.addEventListener("resize", checkOverflow)
  })

  onCleanup(() => {
    window.removeEventListener("resize", checkOverflow)
  })

  return (
    <div
      class={styles["message-terminal"]}
      data-expanded={expanded() || local.expand === true}
      {...rest}
    >
      <div data-section="body">
        <div data-section="header">
          <span>{local.desc}</span>
        </div>
        <div data-section="content">
          <CodeBlock
            lang="ansi"
            onRendered={checkOverflow}
            ref={(el) => (preEl = el)}
            code={`\x1b[90m>\x1b[0m ${local.text}`}
          />
        </div>
      </div>
      {((!local.expand && overflowed()) || expanded()) && (
        <button
          type="button"
          data-element-button-text
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

function ToolFooter(props: { time: number }) {
  return props.time > MIN_DURATION ? (
    <span data-part-footer title={`${props.time}ms`}>
      {formatDuration(props.time)}
    </span>
  ) : (
    <div data-part-footer="spacer"></div>
  )
}

export default function Share(props: {
  id: string
  api: string
  info: SessionInfo
  messages: Record<string, SessionMessage>
}) {
  const id = props.id

  const anchorId = createMemo<number | null>(() => {
    const raw = window.location.hash.slice(1)
    const [id] = raw.split("-")
    return id
  })

  const [store, setStore] = createStore<{
    info?: SessionInfo
    messages: Record<string, SessionMessage>
  }>({ info: props.info, messages: props.messages })
  const messages = createMemo(() =>
    Object.values(store.messages).toSorted((a, b) => a.id?.localeCompare(b.id)),
  )
  const [connectionStatus, setConnectionStatus] = createSignal<
    [Status, string?]
  >(["disconnected", "Disconnected"])

  onMount(() => {
    const apiUrl = props.api

    if (!id) {
      setConnectionStatus(["error", "id not found"])
      return
    }

    if (!apiUrl) {
      console.error("API URL not found in environment variables")
      setConnectionStatus(["error", "API URL not found"])
      return
    }

    let reconnectTimer: number | undefined
    let socket: WebSocket | null = null

    // Function to create and set up WebSocket with auto-reconnect
    const setupWebSocket = () => {
      // Close any existing connection
      if (socket) {
        socket.close()
      }

      setConnectionStatus(["connecting"])

      // Always use secure WebSocket protocol (wss)
      const wsBaseUrl = apiUrl.replace(/^https?:\/\//, "wss://")
      const wsUrl = `${wsBaseUrl}/share_poll?id=${id}`
      console.log("Connecting to WebSocket URL:", wsUrl)

      // Create WebSocket connection
      socket = new WebSocket(wsUrl)

      // Handle connection opening
      socket.onopen = () => {
        setConnectionStatus(["connected"])
        console.log("WebSocket connection established")
      }

      // Handle incoming messages
      socket.onmessage = (event) => {
        console.log("WebSocket message received")
        try {
          const d = JSON.parse(event.data)
          const [root, type, ...splits] = d.key.split("/")
          if (root !== "session") return
          if (type === "info") {
            setStore("info", reconcile(d.content))
            return
          }
          if (type === "message") {
            const [, messageID] = splits
            setStore("messages", messageID, reconcile(d.content))

            if (messageID === anchorId()) {
              scrollToAnchor(window.location.hash.slice(1))
            }
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error)
        }
      }

      // Handle errors
      socket.onerror = (error) => {
        console.error("WebSocket error:", error)
        setConnectionStatus(["error", "Connection failed"])
      }

      // Handle connection close and reconnection
      socket.onclose = (event) => {
        console.log(`WebSocket closed: ${event.code} ${event.reason}`)
        setConnectionStatus(["reconnecting"])

        // Try to reconnect after 2 seconds
        clearTimeout(reconnectTimer)
        reconnectTimer = window.setTimeout(
          setupWebSocket,
          2000,
        ) as unknown as number
      }
    }

    // Initial connection
    setupWebSocket()

    // Clean up on component unmount
    onCleanup(() => {
      console.log("Cleaning up WebSocket connection")
      if (socket) {
        socket.close()
      }
      clearTimeout(reconnectTimer)
    })
  })

  const data = createMemo(() => {
    const result = {
      created: undefined as number | undefined,
      system: [] as string[],
      messages: [] as SessionMessage[],
      models: {} as Record<string, string[]>,
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
      },
    }
    for (let i = 0; i < messages().length; i++) {
      const msg = messages()[i]

      const system = result.messages.length === 0 && msg.role === "system"
      const assistant = msg.metadata?.assistant

      if (system) {
        for (const part of msg.parts) {
          if (part.type === "text") {
            result.system.push(part.text)
          }
        }
        result.created = msg.metadata?.time.created
        continue
      }

      result.messages.push(msg)

      if (assistant) {
        result.cost += assistant.cost
        result.tokens.input += assistant.tokens.input
        result.tokens.output += assistant.tokens.output
        result.tokens.reasoning += assistant.tokens.reasoning

        result.models[`${assistant.providerID} ${assistant.modelID}`] = [
          assistant.providerID,
          assistant.modelID,
        ]
      }
    }
    return result
  })
  const [showingSystemPrompt, showSystemPrompt] = createSignal(false)

  return (
    <main class={`${styles.root} not-content`}>
      <div class={styles.header}>
        <div data-section="title">
          <h1>{store.info?.title}</h1>
          <div>
            <div data-section="date">
              {data().created ? (
                <span
                  title={DateTime.fromMillis(
                    data().created || 0,
                  ).toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS)}
                >
                  {DateTime.fromMillis(data().created || 0).toLocaleString(
                    DateTime.DATE_MED,
                  )}
                </span>
              ) : (
                <span data-element-label data-placeholder>
                  Started at &mdash;
                </span>
              )}
            </div>
            <p data-section="status">
              <span data-status={connectionStatus()[0]}>&#9679;</span>
              <span data-element-label>
                {getStatusText(connectionStatus())}
              </span>
            </p>
          </div>
        </div>
        <div data-section="row">
          <ul data-section="stats">
            <li>
              <span data-element-label>Cost</span>
              {data().cost !== undefined ? (
                <span>${data().cost.toFixed(2)}</span>
              ) : (
                <span data-placeholder>&mdash;</span>
              )}
            </li>
            <li>
              <span data-element-label>Input Tokens</span>
              {data().tokens.input ? (
                <span>{data().tokens.input}</span>
              ) : (
                <span data-placeholder>&mdash;</span>
              )}
            </li>
            <li>
              <span data-element-label>Output Tokens</span>
              {data().tokens.output ? (
                <span>{data().tokens.output}</span>
              ) : (
                <span data-placeholder>&mdash;</span>
              )}
            </li>
            <li>
              <span data-element-label>Reasoning Tokens</span>
              {data().tokens.reasoning ? (
                <span>{data().tokens.reasoning}</span>
              ) : (
                <span data-placeholder>&mdash;</span>
              )}
            </li>
          </ul>
          <ul data-section="stats" data-section-models>
            {Object.values(data().models).length > 0 ? (
              <For each={Object.values(data().models)}>
                {([provider, model]) => (
                  <li>
                    <div data-stat-model-icon title={provider}>
                      <ProviderIcon provider={provider} />
                    </div>
                    <span data-stat-model>{model}</span>
                  </li>
                )}
              </For>
            ) : (
              <li>
                <span data-element-label>Models</span>
                <span data-placeholder>&mdash;</span>
              </li>
            )}
          </ul>
          <div data-section="system-prompt">
            <div data-section="icon">
              <IconCpuChip width={16} height={16} />
            </div>
            <div data-section="content">
              <button
                type="button"
                data-element-button-text
                data-element-button-more
                onClick={() => showSystemPrompt((e) => !e)}
              >
                <span>
                  {showingSystemPrompt()
                    ? "Hide system prompt"
                    : "Show system prompt"}
                </span>
                <span data-button-icon>
                  <Show
                    when={showingSystemPrompt()}
                    fallback={<IconChevronRight width={12} height={12} />}
                  >
                    <IconChevronDown width={12} height={12} />
                  </Show>
                </span>
              </button>
              <Show when={showingSystemPrompt()}>
                <TextPart
                  expand
                  data-size="sm"
                  text={data().system.join("\n\n").trim()}
                />
              </Show>
            </div>
          </div>
        </div>
      </div>

      <div>
        <Show
          when={data().messages.length > 0}
          fallback={<p>Waiting for messages...</p>}
        >
          <div class={styles.parts}>
            <For each={data().messages}>
              {(msg, msgIndex) => (
                <For each={msg.parts}>
                  {(part, partIndex) => {
                    if (
                      part.type === "step-start" &&
                      (partIndex() > 0 || !msg.metadata?.assistant)
                    )
                      return null

                    const anchor = createMemo(() => `${msg.id}-${partIndex()}`)
                    const [results, showResults] = createSignal(false)
                    const isLastPart = createMemo(
                      () =>
                        data().messages.length === msgIndex() + 1 &&
                        msg.parts.length === partIndex() + 1,
                    )
                    return (
                      <Switch>
                        {/* User text */}
                        <Match
                          when={
                            msg.role === "user" && part.type === "text" && part
                          }
                        >
                          {(part) => (
                            <div
                              id={anchor()}
                              data-section="part"
                              data-part-type="user-text"
                            >
                              <div data-section="decoration">
                                <a href={`#${anchor()}`} title="Message">
                                  <IconUserCircle width={18} height={18} />
                                </a>
                                <div></div>
                              </div>
                              <div data-section="content">
                                <TextPart
                                  highlight
                                  text={part().text}
                                  expand={isLastPart()}
                                />
                              </div>
                            </div>
                          )}
                        </Match>
                        {/* AI text */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "text" &&
                            part
                          }
                        >
                          {(part) => (
                            <div
                              id={anchor()}
                              data-section="part"
                              data-part-type="ai-text"
                            >
                              <div data-section="decoration">
                                <a href={`#${anchor()}`} title="AI response">
                                  <IconSparkles width={18} height={18} />
                                </a>
                                <div></div>
                              </div>
                              <div data-section="content">
                                <MarkdownPart
                                  expand={isLastPart()}
                                  text={stripEnclosingTag(part().text)}
                                />
                              </div>
                            </div>
                          )}
                        </Match>
                        {/* AI model */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "step-start" &&
                            msg.metadata?.assistant
                          }
                        >
                          {(assistant) => (
                            <div
                              id={anchor()}
                              data-section="part"
                              data-part-type="ai-model"
                            >
                              <div data-section="decoration">
                                <a href={`#${anchor()}`} title="Model">
                                  <ProviderIcon
                                    size={18}
                                    provider={assistant().providerID}
                                  />
                                </a>
                                <div></div>
                              </div>
                              <div data-section="content">
                                <div data-part-tool-body>
                                  <span
                                    data-size="md"
                                    data-part-title
                                    data-element-label
                                  >
                                    {assistant().providerID}
                                  </span>
                                  <span data-part-model>
                                    {assistant().modelID}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </Match>
                        {/* System text */}
                        <Match
                          when={
                            msg.role === "system" &&
                            part.type === "text" &&
                            part
                          }
                        >
                          {(part) => (
                            <div
                              id={anchor()}
                              data-section="part"
                              data-part-type="system-text"
                            >
                              <div data-section="decoration">
                                <a href={`#${anchor()}`} title="System message">
                                  <IconCpuChip width={18} height={18} />
                                </a>
                                <div></div>
                              </div>
                              <div data-section="content">
                                <div data-part-tool-body>
                                  <span data-element-label data-part-title>
                                    System
                                  </span>
                                  <TextPart
                                    data-size="sm"
                                    text={part().text}
                                    data-color="dimmed"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </Match>
                        {/* Grep tool */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName === "opencode_grep" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )
                            const args = part().toolInvocation.args
                            const result =
                              part().toolInvocation.state === "result" &&
                              part().toolInvocation.result
                            const matches = metadata()?.matches

                            const { pattern, ...rest } = args

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-grep"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Grep files">
                                    <IconDocumentMagnifyingGlass
                                      width={18}
                                      height={18}
                                    />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="md">
                                      <span data-element-label>Grep</span>
                                      <b>&ldquo;{pattern}&rdquo;</b>
                                    </span>
                                    <Show when={Object.keys(rest).length > 0}>
                                      <div data-part-tool-args>
                                        <For each={flattenToolArgs(rest)}>
                                          {([name, value]) => (
                                            <>
                                              <div></div>
                                              <div>{name}</div>
                                              <div>{value}</div>
                                            </>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                    <Switch>
                                      <Match when={matches > 0}>
                                        <div data-part-tool-result>
                                          <ResultsButton
                                            showCopy={
                                              matches === 1
                                                ? "1 match"
                                                : `${matches} matches`
                                            }
                                            hideCopy="Hide matches"
                                            results={results()}
                                            onClick={() =>
                                              showResults((e) => !e)
                                            }
                                          />
                                          <Show when={results()}>
                                            <TextPart
                                              expand
                                              text={result}
                                              data-size="sm"
                                              data-color="dimmed"
                                            />
                                          </Show>
                                        </div>
                                      </Match>
                                      <Match when={result}>
                                        <div data-part-tool-result>
                                          <TextPart
                                            expand
                                            text={result}
                                            data-size="sm"
                                            data-color="dimmed"
                                          />
                                        </div>
                                      </Match>
                                    </Switch>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Glob tool */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName === "opencode_glob" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )
                            const args = part().toolInvocation.args
                            const result =
                              part().toolInvocation.state === "result" &&
                              part().toolInvocation.result
                            const count = metadata()?.count
                            const pattern = args.pattern

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-glob"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Glob files">
                                    <IconMagnifyingGlass
                                      width={18}
                                      height={18}
                                    />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="md">
                                      <span data-element-label>Glob</span>
                                      <b>&ldquo;{pattern}&rdquo;</b>
                                    </span>
                                    <Switch>
                                      <Match when={count > 0}>
                                        <div data-part-tool-result>
                                          <ResultsButton
                                            showCopy={
                                              count === 1
                                                ? "1 result"
                                                : `${count} results`
                                            }
                                            results={results()}
                                            onClick={() =>
                                              showResults((e) => !e)
                                            }
                                          />
                                          <Show when={results()}>
                                            <TextPart
                                              expand
                                              text={result}
                                              data-size="sm"
                                              data-color="dimmed"
                                            />
                                          </Show>
                                        </div>
                                      </Match>
                                      <Match when={result}>
                                        <div data-part-tool-result>
                                          <TextPart
                                            expand
                                            text={result}
                                            data-size="sm"
                                            data-color="dimmed"
                                          />
                                        </div>
                                      </Match>
                                    </Switch>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* LS tool */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName === "opencode_list" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )
                            const args = part().toolInvocation.args
                            const path = args.path

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-list"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="List files">
                                    <IconRectangleStack
                                      width={18}
                                      height={18}
                                    />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="md">
                                      <span data-element-label>LS</span>
                                      <b>{path}</b>
                                    </span>
                                    <Switch>
                                      <Match
                                        when={
                                          part().toolInvocation.state ===
                                          "result" &&
                                          part().toolInvocation.result
                                        }
                                      >
                                        <div data-part-tool-result>
                                          <ResultsButton
                                            results={results()}
                                            onClick={() =>
                                              showResults((e) => !e)
                                            }
                                          />
                                          <Show when={results()}>
                                            <TextPart
                                              expand
                                              data-size="sm"
                                              data-color="dimmed"
                                              text={
                                                part().toolInvocation.result
                                              }
                                            />
                                          </Show>
                                        </div>
                                      </Match>
                                    </Switch>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Read tool */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName === "opencode_read" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )
                            const args = part().toolInvocation.args
                            const filePath = args.filePath
                            const hasError = metadata()?.error
                            const preview = metadata()?.preview
                            const result =
                              part().toolInvocation.state === "result" &&
                              part().toolInvocation.result

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-read"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Read file">
                                    <IconDocument width={18} height={18} />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="md">
                                      <span data-element-label>Read</span>
                                      <b>{filePath}</b>
                                    </span>
                                    <Switch>
                                      <Match when={hasError}>
                                        <div data-part-tool-result>
                                          <TextPart
                                            expand
                                            text={result}
                                            data-size="sm"
                                            data-color="dimmed"
                                          />
                                        </div>
                                      </Match>
                                      <Match when={preview}>
                                        <div data-part-tool-result>
                                          <ResultsButton
                                            showCopy="Show preview"
                                            hideCopy="Hide preview"
                                            results={results()}
                                            onClick={() =>
                                              showResults((e) => !e)
                                            }
                                          />
                                          <Show when={results()}>
                                            <div data-part-tool-code>
                                              <CodeBlock
                                                lang={getFileType(filePath)}
                                                code={preview}
                                              />
                                            </div>
                                          </Show>
                                        </div>
                                      </Match>
                                      <Match when={result}>
                                        <div data-part-tool-result>
                                          <ResultsButton
                                            results={results()}
                                            onClick={() =>
                                              showResults((e) => !e)
                                            }
                                          />
                                          <Show when={results()}>
                                            <TextPart
                                              expand
                                              text={result}
                                              data-size="sm"
                                              data-color="dimmed"
                                            />
                                          </Show>
                                        </div>
                                      </Match>
                                    </Switch>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Write tool */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName === "opencode_write" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )
                            const args = part().toolInvocation.args
                            const filePath = args.filePath
                            const content = args.content
                            const hasError = metadata()?.error
                            const result =
                              part().toolInvocation.state === "result" &&
                              part().toolInvocation.result
                            const diagnostics = createMemo(() =>
                              getDiagnostics(metadata()?.diagnostics),
                            )

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-write"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Write file">
                                    <IconDocumentPlus width={18} height={18} />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="md">
                                      <span data-element-label>Write</span>
                                      <b>{filePath}</b>
                                    </span>
                                    <Show when={diagnostics().length > 0}>
                                      <TextPart
                                        data-size="sm"
                                        text={diagnostics().join("\n\n")}
                                      />
                                    </Show>
                                    <Switch>
                                      <Match when={hasError}>
                                        <div data-part-tool-result>
                                          <TextPart
                                            expand
                                            text={result}
                                            data-size="sm"
                                            data-color="dimmed"
                                          />
                                        </div>
                                      </Match>
                                      <Match when={content}>
                                        <div data-part-tool-result>
                                          <ResultsButton
                                            showCopy="Show contents"
                                            hideCopy="Hide contents"
                                            results={results()}
                                            onClick={() =>
                                              showResults((e) => !e)
                                            }
                                          />
                                          <Show when={results()}>
                                            <div data-part-tool-code>
                                              <CodeBlock
                                                lang={getFileType(filePath)}
                                                code={content}
                                              />
                                            </div>
                                          </Show>
                                        </div>
                                      </Match>
                                    </Switch>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Edit tool */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName === "opencode_edit" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )
                            const hasError = metadata()?.error
                            const args = part().toolInvocation.args
                            const filePath = args.filePath
                            const diagnostics = createMemo(() =>
                              getDiagnostics(metadata()?.diagnostics),
                            )

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-edit"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Edit file">
                                    <IconPencilSquare width={18} height={18} />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="md">
                                      <span data-element-label>Edit</span>
                                      <b>{filePath}</b>
                                    </span>
                                    <Switch>
                                      <Match when={hasError}>
                                        <div data-part-tool-result>
                                          <TextPart
                                            expand
                                            data-size="sm"
                                            data-color="dimmed"
                                            text={metadata()?.message}
                                          />
                                        </div>
                                      </Match>
                                      <Match when={metadata()?.diff}>
                                        <div data-part-tool-edit>
                                          <DiffView
                                            class={styles["diff-code-block"]}
                                            diff={metadata()?.diff}
                                            lang={getFileType(filePath)}
                                          />
                                        </div>
                                      </Match>
                                    </Switch>
                                    <Show when={diagnostics().length > 0}>
                                      <TextPart
                                        data-size="sm"
                                        text={diagnostics().join("\n\n")}
                                      />
                                    </Show>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Bash tool */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName === "opencode_bash" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )

                            const command = part().toolInvocation.args.command
                            const desc = part().toolInvocation.args.description
                            const result = createMemo(() => {
                              const invocation = part().toolInvocation
                              return metadata()?.stdout || (invocation.state === "result" && invocation.result)
                            })

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-bash"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Bash command">
                                    <IconCommandLine width={18} height={18} />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <TerminalPart
                                      desc={desc}
                                      data-size="sm"
                                      text={
                                        command + (result() ? `\n${result()}` : "")
                                      }
                                    />
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Todo read */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName ===
                            "opencode_todoread" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-fallback"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Plan">
                                    <IconQueueList width={18} height={18} />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="sm">
                                      Checking plan&hellip;
                                    </span>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Todo write */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName ===
                            "opencode_todowrite" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )

                            const todos = createMemo(() =>
                              sortTodosByStatus(
                                part().toolInvocation.args.todos,
                              ),
                            )
                            const starting = todos().every(
                              (t) => t.status === "pending",
                            )
                            const finished = todos().every(
                              (t) => t.status === "completed",
                            )

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-fallback"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Plan">
                                    <IconQueueList width={18} height={18} />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="sm">
                                      <Switch fallback="Updating the plan">
                                        <Match when={starting}>
                                          Creating a plan
                                        </Match>
                                        <Match when={finished}>
                                          Completing the plan
                                        </Match>
                                      </Switch>
                                    </span>
                                    <Show when={todos().length > 0}>
                                      <ul class={styles.todos}>
                                        <For each={todos()}>
                                          {({ status, content }) => (
                                            <li data-status={status}>
                                              <span></span>
                                              {content}
                                            </li>
                                          )}
                                        </For>
                                      </ul>
                                    </Show>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Fetch tool */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName ===
                            "opencode_webfetch" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )
                            const args = part().toolInvocation.args
                            const url = args.url
                            const format = args.format
                            const hasError = metadata()?.error
                            const result = createMemo(() => {
                              const invocation = part().toolInvocation
                              return invocation.state === "result" && invocation.result
                            })

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-fetch"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Web fetch">
                                    <IconGlobeAlt width={18} height={18} />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="md">
                                      <span data-element-label>Fetch</span>
                                      <b>{url}</b>
                                    </span>
                                    <Switch>
                                      <Match when={hasError}>
                                        <div data-part-tool-result>
                                          <TextPart
                                            expand
                                            text={result()}
                                            data-size="sm"
                                            data-color="dimmed"
                                          />
                                        </div>
                                      </Match>
                                      <Match when={result}>
                                        <div data-part-tool-result>
                                          <ResultsButton
                                            results={results()}
                                            onClick={() =>
                                              showResults((e) => !e)
                                            }
                                          />
                                          <Show when={results()}>
                                            <div data-part-tool-code>
                                              <CodeBlock
                                                lang={format || "text"}
                                                code={result()}
                                              />
                                            </div>
                                          </Show>
                                        </div>
                                      </Match>
                                    </Switch>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Tool call */}
                        <Match
                          when={
                            msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part
                          }
                        >
                          {(part) => {
                            const metadata = createMemo(
                              () =>
                                msg.metadata?.tool[
                                part().toolInvocation.toolCallId
                                ],
                            )

                            const duration = createMemo(() =>
                              DateTime.fromMillis(metadata()?.time.end || 0)
                                .diff(
                                  DateTime.fromMillis(
                                    metadata()?.time.start || 0,
                                  ),
                                )
                                .toMillis(),
                            )

                            return (
                              <div
                                id={anchor()}
                                data-section="part"
                                data-part-type="tool-fallback"
                              >
                                <div data-section="decoration">
                                  <a href={`#${anchor()}`} title="Tool call">
                                    <IconWrenchScrewdriver
                                      width={18}
                                      height={18}
                                    />
                                  </a>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <span data-part-title data-size="md">
                                      {part().toolInvocation.toolName}
                                    </span>
                                    <div data-part-tool-args>
                                      <For
                                        each={flattenToolArgs(
                                          part().toolInvocation.args,
                                        )}
                                      >
                                        {([name, value]) => (
                                          <>
                                            <div></div>
                                            <div>{name}</div>
                                            <div>{value}</div>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <Switch>
                                      <Match
                                        when={
                                          part().toolInvocation.state ===
                                          "result" &&
                                          part().toolInvocation.result
                                        }
                                      >
                                        <div data-part-tool-result>
                                          <ResultsButton
                                            results={results()}
                                            onClick={() =>
                                              showResults((e) => !e)
                                            }
                                          />
                                          <Show when={results()}>
                                            <TextPart
                                              expand
                                              data-size="sm"
                                              data-color="dimmed"
                                              text={
                                                part().toolInvocation.result
                                              }
                                            />
                                          </Show>
                                        </div>
                                      </Match>
                                      <Match
                                        when={
                                          part().toolInvocation.state === "call"
                                        }
                                      >
                                        <TextPart
                                          data-size="sm"
                                          data-color="dimmed"
                                          text="Calling..."
                                        />
                                      </Match>
                                    </Switch>
                                  </div>
                                  <ToolFooter time={duration()} />
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        {/* Fallback */}
                        <Match when={true}>
                          <div
                            id={anchor()}
                            data-section="part"
                            data-part-type="fallback"
                          >
                            <div data-section="decoration">
                              <a href={`#${anchor()}`}>
                                <Switch
                                  fallback={
                                    <IconWrenchScrewdriver
                                      width={16}
                                      height={16}
                                    />
                                  }
                                >
                                  <Match
                                    when={
                                      msg.role === "assistant" &&
                                      part.type !== "tool-invocation"
                                    }
                                  >
                                    <IconSparkles width={18} height={18} />
                                  </Match>
                                  <Match when={msg.role === "system"}>
                                    <IconCpuChip width={18} height={18} />
                                  </Match>
                                  <Match when={msg.role === "user"}>
                                    <IconUserCircle width={18} height={18} />
                                  </Match>
                                </Switch>
                              </a>
                              <div></div>
                            </div>
                            <div data-section="content">
                              <div data-part-tool-body>
                                <span data-element-label data-part-title>
                                  {part.type}
                                </span>
                                <TextPart
                                  text={JSON.stringify(part, null, 2)}
                                />
                              </div>
                            </div>
                          </div>
                        </Match>
                      </Switch>
                    )
                  }}
                </For>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div style={{ margin: "2rem 0" }}>
        <div
          style={{
            border: "1px solid #ccc",
            padding: "1rem",
            "overflow-y": "auto",
          }}
        >
          <Show
            when={data().messages.length > 0}
            fallback={<p>Waiting for messages...</p>}
          >
            <ul style={{ "list-style-type": "none", padding: 0 }}>
              <For each={data().messages}>
                {(msg) => (
                  <li
                    style={{
                      padding: "0.75rem",
                      margin: "0.75rem 0",
                      "box-shadow": "0 1px 3px rgba(0,0,0,0.1)",
                    }}
                  >
                    <div>
                      <strong>Key:</strong> {msg.id}
                    </div>
                    <pre>{JSON.stringify(msg, null, 2)}</pre>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </div>
    </main>
  )
}
