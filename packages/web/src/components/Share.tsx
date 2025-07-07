import { type JSX } from "solid-js"
import {
  For,
  Show,
  Match,
  Switch,
  onMount,
  Suspense,
  onCleanup,
  splitProps,
  createMemo,
  createEffect,
  createSignal,
  SuspenseList,
} from "solid-js"
import map from "lang-map"
import { DateTime } from "luxon"
import { createStore, reconcile } from "solid-js/store"
import type { Diagnostic } from "vscode-languageserver-types"
import {
  IconOpenAI,
  IconGemini,
  IconOpencode,
  IconAnthropic,
} from "./icons/custom"
import {
  IconHashtag,
  IconSparkles,
  IconGlobeAlt,
  IconDocument,
  IconQueueList,
  IconUserCircle,
  IconCheckCircle,
  IconChevronDown,
  IconCommandLine,
  IconChevronRight,
  IconDocumentPlus,
  IconPencilSquare,
  IconRectangleStack,
  IconMagnifyingGlass,
  IconWrenchScrewdriver,
  IconDocumentMagnifyingGlass,
  IconArrowDown,
} from "./icons"
import DiffView from "./DiffView"
import CodeBlock from "./CodeBlock"
import MarkdownView from "./MarkdownView"
import styles from "./share.module.css"
import type { Message } from "opencode/session/message"
import type { Session } from "opencode/session/index"

const MIN_DURATION = 2

type Status =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "reconnecting"

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

function stripWorkingDirectory(filePath?: string, workingDir?: string) {
  if (filePath === undefined || workingDir === undefined) return filePath

  const prefix = workingDir.endsWith("/") ? workingDir : workingDir + "/"

  if (filePath === workingDir) {
    return ""
  }

  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length)
  }

  return filePath
}

function getShikiLang(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""

  // map.languages(ext) returns an array of matching Linguist language names (e.g. ['TypeScript'])
  const langs = map.languages(ext)
  const type = langs?.[0]?.toLowerCase()

  // Overrride any specific language mappings
  const overrides: Record<string, string> = {
    conf: "shellscript",
  }

  return type ? (overrides[type] ?? type) : "plaintext"
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

function formatErrorString(error: string): JSX.Element {
  const errorMarker = "Error: "
  const startsWithError = error.startsWith(errorMarker)

  return startsWithError ? (
    <pre>
      <span data-color="red" data-marker="label" data-separator>
        Error
      </span>
      <span>{error.slice(errorMarker.length)}</span>
    </pre>
  ) : (
    <pre>
      <span data-color="dimmed">{error}</span>
    </pre>
  )
}

function getDiagnostics(
  diagnosticsByFile: Record<string, Diagnostic[]>,
  currentFile: string,
): JSX.Element[] {
  // Return a flat array of error diagnostics, in the format:
  // "Error [65:20] Property 'x' does not exist on type 'Y'"
  const result: JSX.Element[] = []

  if (
    diagnosticsByFile === undefined ||
    diagnosticsByFile[currentFile] === undefined
  )
    return result

  for (const diags of Object.values(diagnosticsByFile)) {
    for (const d of diags) {
      // Only keep diagnostics explicitly marked as Error (severity === 1)
      if (d.severity !== 1) continue

      const line = d.range.start.line + 1 // 1-based
      const column = d.range.start.character + 1 // 1-based

      result.push(
        <pre>
          <span data-color="red" data-marker="label">
            Error
          </span>
          <span data-color="dimmed" data-separator>
            [{line}:{column}]
          </span>
          <span>{d.message}</span>
        </pre>,
      )
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
      return "Connected, waiting for messages..."
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

function checkOverflow(getEl: () => HTMLElement | undefined, watch?: () => any) {
  const [needsToggle, setNeedsToggle] = createSignal(false)

  function measure() {
    const el = getEl()
    if (!el) return
    setNeedsToggle(el.scrollHeight > el.clientHeight + 1)
  }

  onMount(() => {
    let raf = 0

    function probe() {
      const el = getEl()
      if (el && el.offsetParent !== null && el.getBoundingClientRect().height) {
        measure()
      }
      else {
        raf = requestAnimationFrame(probe)
      }
    }
    raf = requestAnimationFrame(probe)

    const ro = new ResizeObserver(measure)
    const el = getEl()
    if (el) ro.observe(el)

    onCleanup(() => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    })
  })

  if (watch) createEffect(measure)

  return needsToggle
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
          fallback={<IconChevronRight width={11} height={11} />}
        >
          <IconChevronDown width={11} height={11} />
        </Show>
      </span>
    </button>
  )
}

interface TextPartProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string
  expand?: boolean
}
function TextPart(props: TextPartProps) {
  let preEl: HTMLPreElement | undefined

  const [local, rest] = splitProps(props, ["text", "expand"])
  const [expanded, setExpanded] = createSignal(false)
  const overflowed = checkOverflow(() => preEl, () => local.expand)

  return (
    <div
      class={styles["message-text"]}
      data-expanded={expanded() || local.expand === true}
      {...rest}
    >
      <pre ref={preEl}>{local.text}</pre>
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

interface ErrorPartProps extends JSX.HTMLAttributes<HTMLDivElement> {
  expand?: boolean
}
function ErrorPart(props: ErrorPartProps) {
  let preEl: HTMLDivElement | undefined

  const [local, rest] = splitProps(props, ["expand", "children"])
  const [expanded, setExpanded] = createSignal(false)
  const overflowed = checkOverflow(() => preEl, () => local.expand)

  return (
    <div
      class={styles["message-error"]}
      data-expanded={expanded() || local.expand === true}
      {...rest}
    >
      <div data-section="content" ref={preEl}>
        {local.children}
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

interface MarkdownPartProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string
  expand?: boolean
  highlight?: boolean
}
function MarkdownPart(props: MarkdownPartProps) {
  let divEl: HTMLDivElement | undefined

  const [local, rest] = splitProps(props, ["text", "expand", "highlight"])
  const [expanded, setExpanded] = createSignal(false)
  const overflowed = checkOverflow(() => divEl, () => local.expand)

  return (
    <div
      class={styles["message-markdown"]}
      data-highlight={local.highlight}
      data-expanded={expanded() || local.expand === true}
      {...rest}
    >
      <MarkdownView
        data-element-markdown
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
  command: string
  error?: string
  result?: string
  desc?: string
  expand?: boolean
}
function TerminalPart(props: TerminalPartProps) {
  const [local, rest] = splitProps(props, [
    "command",
    "error",
    "result",
    "desc",
    "expand",
  ])
  let preEl: HTMLDivElement | undefined

  const [expanded, setExpanded] = createSignal(false)
  const overflowed = checkOverflow(
    () => {
      if (!preEl) return
      return preEl.getElementsByTagName("pre")[0]
    },
    () => local.expand
  )

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
          <CodeBlock lang="bash" code={local.command} />
          <Switch>
            <Match when={local.error}>
              <CodeBlock
                ref={preEl}
                lang="text"
                data-section="error"
                code={local.error || ""}
              />
            </Match>
            <Match when={local.result}>
              <CodeBlock
                ref={preEl}
                lang="console"
                code={local.result || ""}
              />
            </Match>
          </Switch>
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

interface AnchorProps extends JSX.HTMLAttributes<HTMLDivElement> {
  id: string
}
function AnchorIcon(props: AnchorProps) {
  const [local, rest] = splitProps(props, ["id", "children"])
  const [copied, setCopied] = createSignal(false)

  return (
    <div
      {...rest}
      data-element-anchor
      title="Link to this message"
      data-status={copied() ? "copied" : ""}
    >
      <a
        href={`#${local.id}`}
        onClick={(e) => {
          e.preventDefault()

          const anchor = e.currentTarget
          const hash = anchor.getAttribute("href") || ""
          const { origin, pathname, search } = window.location

          navigator.clipboard
            .writeText(`${origin}${pathname}${search}${hash}`)
            .catch((err) => console.error("Copy failed", err))

          setCopied(true)
          setTimeout(() => setCopied(false), 3000)
        }}
      >
        {local.children}
        <IconHashtag width={18} height={18} />
        <IconCheckCircle width={18} height={18} />
      </a>
      <span data-element-tooltip>Copied!</span>
    </div>
  )
}

export default function Share(props: {
  id: string
  api: string
  info: Session.Info
  messages: Record<string, Message.Info>
}) {
  let lastScrollY = 0
  let hasScrolledToAnchor = false
  let scrollTimeout: number | undefined
  let scrollSentinel: HTMLElement | undefined
  let scrollObserver: IntersectionObserver | undefined

  const id = props.id
  const params = new URLSearchParams(window.location.search)
  const debug = params.get("debug") === "true"

  const [showScrollButton, setShowScrollButton] = createSignal(false)
  const [isButtonHovered, setIsButtonHovered] = createSignal(false)
  const [isNearBottom, setIsNearBottom] = createSignal(false)

  const [store, setStore] = createStore<{
    info?: Session.Info
    messages: Record<string, Message.Info>
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

  function checkScrollNeed() {
    const currentScrollY = window.scrollY
    const isScrollingDown = currentScrollY > lastScrollY
    const scrolled = currentScrollY > 200 // Show after scrolling 200px

    // Only show when scrolling down, scrolled enough, and not near bottom
    const shouldShow = isScrollingDown && scrolled && !isNearBottom()

    // Update last scroll position
    lastScrollY = currentScrollY

    if (shouldShow) {
      setShowScrollButton(true)
      // Clear existing timeout
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
      // Hide button after 3 seconds of no scrolling (unless hovered)
      scrollTimeout = window.setTimeout(() => {
        if (!isButtonHovered()) {
          setShowScrollButton(false)
        }
      }, 1500)
    } else if (!isButtonHovered()) {
      // Only hide if not hovered (to prevent disappearing while user is about to click)
      setShowScrollButton(false)
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
    }
  }

  onMount(() => {
    lastScrollY = window.scrollY // Initialize scroll position

    // Create sentinel element
    const sentinel = document.createElement("div")
    sentinel.style.height = "1px"
    sentinel.style.position = "absolute"
    sentinel.style.bottom = "100px"
    sentinel.style.width = "100%"
    sentinel.style.pointerEvents = "none"
    document.body.appendChild(sentinel)

    // Create intersection observer
    const observer = new IntersectionObserver((entries) => {
      setIsNearBottom(entries[0].isIntersecting)
    })
    observer.observe(sentinel)

    // Store references for cleanup
    scrollSentinel = sentinel
    scrollObserver = observer

    checkScrollNeed()
    window.addEventListener("scroll", checkScrollNeed)
    window.addEventListener("resize", checkScrollNeed)
  })

  onCleanup(() => {
    window.removeEventListener("scroll", checkScrollNeed)
    window.removeEventListener("resize", checkScrollNeed)

    // Clean up observer and sentinel
    if (scrollObserver) {
      scrollObserver.disconnect()
    }
    if (scrollSentinel) {
      document.body.removeChild(scrollSentinel)
    }

    if (scrollTimeout) {
      clearTimeout(scrollTimeout)
    }
  })

  const data = createMemo(() => {
    const result = {
      rootDir: undefined as string | undefined,
      created: undefined as number | undefined,
      completed: undefined as number | undefined,
      messages: [] as Message.Info[],
      models: {} as Record<string, string[]>,
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
      },
    }

    result.created = props.info.time.created

    for (let i = 0; i < messages().length; i++) {
      const msg = messages()[i]

      const assistant = msg.metadata?.assistant

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

        if (assistant.path?.root) {
          result.rootDir = assistant.path.root
        }

        if (msg.metadata?.time.completed) {
          result.completed = msg.metadata?.time.completed
        }
      }
    }
    return result
  })

  return (
    <main class={`${styles.root} not-content`}>
      <div class={styles.header}>
        <div data-section="title">
          <h1>{store.info?.title}</h1>
        </div>
        <div data-section="row">
          <ul data-section="stats" data-section-models>
            <li title="opencode version">
              <div data-stat-icon title="opencode">
                <IconOpencode width={16} height={16} />
              </div>
              <Show when={store.info?.version} fallback="v0.0.1">
                <span>v{store.info?.version}</span>
              </Show>
            </li>
            {Object.values(data().models).length > 0 ? (
              <For each={Object.values(data().models)}>
                {([provider, model]) => (
                  <li>
                    <div data-stat-icon title={provider}>
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
          <div data-section="time">
            {data().created ? (
              <span
                title={DateTime.fromMillis(data().created || 0).toLocaleString(
                  DateTime.DATETIME_FULL_WITH_SECONDS,
                )}
              >
                {DateTime.fromMillis(data().created || 0).toLocaleString(
                  DateTime.DATETIME_MED,
                )}
              </span>
            ) : (
              <span data-element-label data-placeholder>
                Started at &mdash;
              </span>
            )}
          </div>
        </div>
      </div>

      <div>
        <Show
          when={data().messages.length > 0}
          fallback={<p>Waiting for messages...</p>}
        >
          <div class={styles.parts}>
            <SuspenseList revealOrder="forwards">
              <For each={data().messages}>
                {(msg, msgIndex) => (
                  <Suspense>
                    <For each={msg.parts}>
                      {(part, partIndex) => {
                        if (
                          (part.type === "step-start" &&
                            (partIndex() > 0 || !msg.metadata?.assistant)) ||
                          (msg.role === "assistant" &&
                            part.type === "tool-invocation" &&
                            part.toolInvocation.toolName === "todoread")
                        )
                          return null

                        const anchor = createMemo(
                          () => `${msg.id}-${partIndex()}`,
                        )
                        const [showResults, setShowResults] =
                          createSignal(false)
                        const isLastPart = createMemo(
                          () =>
                            data().messages.length === msgIndex() + 1 &&
                            msg.parts.length === partIndex() + 1,
                        )
                        const toolData = createMemo(() => {
                          if (
                            msg.role !== "assistant" ||
                            part.type !== "tool-invocation"
                          )
                            return {}

                          const metadata =
                            msg.metadata?.tool[part.toolInvocation.toolCallId]
                          const args = part.toolInvocation.args
                          const result =
                            part.toolInvocation.state === "result" &&
                            part.toolInvocation.result
                          const duration = DateTime.fromMillis(
                            metadata?.time.end || 0,
                          )
                            .diff(
                              DateTime.fromMillis(metadata?.time.start || 0),
                            )
                            .toMillis()

                          return { metadata, args, result, duration }
                        })

                        onMount(() => {
                          const hash = window.location.hash.slice(1)
                          // Wait till all parts are loaded
                          if (
                            hash !== ""
                            && !hasScrolledToAnchor
                            && msg.parts.length === partIndex() + 1
                            && data().messages.length === msgIndex() + 1
                          ) {
                            hasScrolledToAnchor = true
                            scrollToAnchor(hash)
                          }
                        })

                        return (
                          <Switch>
                            {/* User text */}
                            <Match
                              when={
                                msg.role === "user" &&
                                part.type === "text" &&
                                part
                              }
                            >
                              {(part) => (
                                <div
                                  id={anchor()}
                                  data-section="part"
                                  data-part-type="user-text"
                                >
                                  <div data-section="decoration">
                                    <AnchorIcon id={anchor()}>
                                      <IconUserCircle width={18} height={18} />
                                    </AnchorIcon>
                                    <div></div>
                                  </div>
                                  <div data-section="content">
                                    <TextPart
                                      text={part().text}
                                      expand={isLastPart()}
                                      data-background="blue"
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
                                    <AnchorIcon id={anchor()}>
                                      <IconSparkles width={18} height={18} />
                                    </AnchorIcon>
                                    <div></div>
                                  </div>
                                  <div data-section="content">
                                    <MarkdownPart
                                      expand={isLastPart()}
                                      text={stripEnclosingTag(part().text)}
                                    />
                                    <Show
                                      when={isLastPart() && data().completed}
                                    >
                                      <span
                                        data-part-footer
                                        title={DateTime.fromMillis(
                                          data().completed || 0,
                                        ).toLocaleString(
                                          DateTime.DATETIME_FULL_WITH_SECONDS,
                                        )}
                                      >
                                        {DateTime.fromMillis(
                                          data().completed || 0,
                                        ).toLocaleString(DateTime.DATETIME_MED)}
                                      </span>
                                    </Show>
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
                              {(assistant) => {
                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="ai-model"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <ProviderIcon
                                          size={18}
                                          provider={assistant().providerID}
                                        />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>
                                            {assistant().providerID}
                                          </span>
                                        </div>
                                        <span data-part-model>
                                          {assistant().modelID}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )
                              }}
                            </Match>

                            {/* Grep tool */}
                            <Match
                              when={
                                msg.role === "assistant" &&
                                part.type === "tool-invocation" &&
                                part.toolInvocation.toolName === "grep" &&
                                part
                              }
                            >
                              {(_part) => {
                                const matches = () =>
                                  toolData()?.metadata?.matches
                                const splitArgs = () => {
                                  const { pattern, ...rest } = toolData()?.args
                                  return { pattern, rest }
                                }

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-grep"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconDocumentMagnifyingGlass
                                          width={18}
                                          height={18}
                                        />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>Grep</span>
                                          <b>
                                            &ldquo;{splitArgs().pattern}&rdquo;
                                          </b>
                                        </div>
                                        <Show
                                          when={
                                            Object.keys(splitArgs().rest)
                                              .length > 0
                                          }
                                        >
                                          <div data-part-tool-args>
                                            <For
                                              each={flattenToolArgs(
                                                splitArgs().rest,
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
                                        </Show>
                                        <Switch>
                                          <Match when={matches() > 0}>
                                            <div data-part-tool-result>
                                              <ResultsButton
                                                showCopy={
                                                  matches() === 1
                                                    ? "1 match"
                                                    : `${matches()} matches`
                                                }
                                                hideCopy="Hide matches"
                                                results={showResults()}
                                                onClick={() =>
                                                  setShowResults((e) => !e)
                                                }
                                              />
                                              <Show when={showResults()}>
                                                <TextPart
                                                  expand
                                                  data-size="sm"
                                                  data-color="dimmed"
                                                  text={toolData()?.result}
                                                />
                                              </Show>
                                            </div>
                                          </Match>
                                          <Match when={toolData()?.result}>
                                            <div data-part-tool-result>
                                              <TextPart
                                                expand
                                                data-size="sm"
                                                data-color="dimmed"
                                                text={toolData()?.result}
                                              />
                                            </div>
                                          </Match>
                                        </Switch>
                                      </div>
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                part.toolInvocation.toolName === "glob" &&
                                part
                              }
                            >
                              {(_part) => {
                                const count = () => toolData()?.metadata?.count
                                const pattern = () => toolData()?.args.pattern

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-glob"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconMagnifyingGlass
                                          width={18}
                                          height={18}
                                        />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>Glob</span>
                                          <b>&ldquo;{pattern()}&rdquo;</b>
                                        </div>
                                        <Switch>
                                          <Match when={count() > 0}>
                                            <div data-part-tool-result>
                                              <ResultsButton
                                                showCopy={
                                                  count() === 1
                                                    ? "1 result"
                                                    : `${count()} results`
                                                }
                                                results={showResults()}
                                                onClick={() =>
                                                  setShowResults((e) => !e)
                                                }
                                              />
                                              <Show when={showResults()}>
                                                <TextPart
                                                  expand
                                                  text={toolData()?.result}
                                                  data-size="sm"
                                                  data-color="dimmed"
                                                />
                                              </Show>
                                            </div>
                                          </Match>
                                          <Match when={toolData()?.result}>
                                            <div data-part-tool-result>
                                              <TextPart
                                                expand
                                                text={toolData()?.result}
                                                data-size="sm"
                                                data-color="dimmed"
                                              />
                                            </div>
                                          </Match>
                                        </Switch>
                                      </div>
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                part.toolInvocation.toolName === "list" &&
                                part
                              }
                            >
                              {(_part) => {
                                const path = createMemo(() =>
                                  toolData()?.args?.path !== data().rootDir
                                    ? stripWorkingDirectory(
                                      toolData()?.args?.path,
                                      data().rootDir,
                                    )
                                    : toolData()?.args?.path,
                                )

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-list"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconRectangleStack
                                          width={18}
                                          height={18}
                                        />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>LS</span>
                                          <b title={toolData()?.args?.path}>
                                            {path()}
                                          </b>
                                        </div>
                                        <Switch>
                                          <Match when={toolData()?.result}>
                                            <div data-part-tool-result>
                                              <ResultsButton
                                                results={showResults()}
                                                onClick={() =>
                                                  setShowResults((e) => !e)
                                                }
                                              />
                                              <Show when={showResults()}>
                                                <TextPart
                                                  expand
                                                  data-size="sm"
                                                  data-color="dimmed"
                                                  text={toolData()?.result}
                                                />
                                              </Show>
                                            </div>
                                          </Match>
                                        </Switch>
                                      </div>
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                part.toolInvocation.toolName === "read" &&
                                part
                              }
                            >
                              {(_part) => {
                                const filePath = createMemo(() =>
                                  stripWorkingDirectory(
                                    toolData()?.args?.filePath,
                                    data().rootDir,
                                  ),
                                )
                                const hasError = () =>
                                  toolData()?.metadata?.error
                                const preview = () =>
                                  toolData()?.metadata?.preview

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-read"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconDocument width={18} height={18} />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>Read</span>
                                          <b title={toolData()?.args?.filePath}>
                                            {filePath()}
                                          </b>
                                        </div>
                                        <Switch>
                                          <Match when={hasError()}>
                                            <div data-part-tool-result>
                                              <ErrorPart>
                                                {formatErrorString(
                                                  toolData()?.result,
                                                )}
                                              </ErrorPart>
                                            </div>
                                          </Match>
                                          {/* Always try to show CodeBlock if preview is available (even if empty string) */}
                                          <Match
                                            when={typeof preview() === "string"}
                                          >
                                            <div data-part-tool-result>
                                              <ResultsButton
                                                showCopy="Show preview"
                                                hideCopy="Hide preview"
                                                results={showResults()}
                                                onClick={() =>
                                                  setShowResults((e) => !e)
                                                }
                                              />
                                              <Show when={showResults()}>
                                                <div data-part-tool-code>
                                                  <CodeBlock
                                                    lang={getShikiLang(
                                                      filePath(),
                                                    )}
                                                    code={preview()}
                                                  />
                                                </div>
                                              </Show>
                                            </div>
                                          </Match>
                                          {/* Fallback to TextPart if preview is not a string (e.g. undefined) AND result exists */}
                                          <Match
                                            when={
                                              typeof preview() !== "string" &&
                                              toolData()?.result
                                            }
                                          >
                                            <div data-part-tool-result>
                                              <ResultsButton
                                                results={showResults()}
                                                onClick={() =>
                                                  setShowResults((e) => !e)
                                                }
                                              />
                                              <Show when={showResults()}>
                                                <TextPart
                                                  expand
                                                  text={toolData()?.result}
                                                  data-size="sm"
                                                  data-color="dimmed"
                                                />
                                              </Show>
                                            </div>
                                          </Match>
                                        </Switch>
                                      </div>
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                part.toolInvocation.toolName === "write" &&
                                part
                              }
                            >
                              {(_part) => {
                                const filePath = createMemo(() =>
                                  stripWorkingDirectory(
                                    toolData()?.args?.filePath,
                                    data().rootDir,
                                  ),
                                )
                                const hasError = () =>
                                  toolData()?.metadata?.error
                                const content = () => toolData()?.args?.content
                                const diagnostics = createMemo(() =>
                                  getDiagnostics(
                                    toolData()?.metadata?.diagnostics,
                                    toolData()?.args.filePath,
                                  ),
                                )

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-write"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconDocumentPlus
                                          width={18}
                                          height={18}
                                        />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>Write</span>
                                          <b title={toolData()?.args?.filePath}>
                                            {filePath()}
                                          </b>
                                        </div>
                                        <Show when={diagnostics().length > 0}>
                                          <ErrorPart>{diagnostics()}</ErrorPart>
                                        </Show>
                                        <Switch>
                                          <Match when={hasError()}>
                                            <div data-part-tool-result>
                                              <ErrorPart>
                                                {formatErrorString(
                                                  toolData()?.result,
                                                )}
                                              </ErrorPart>
                                            </div>
                                          </Match>
                                          <Match when={content()}>
                                            <div data-part-tool-result>
                                              <ResultsButton
                                                showCopy="Show contents"
                                                hideCopy="Hide contents"
                                                results={showResults()}
                                                onClick={() =>
                                                  setShowResults((e) => !e)
                                                }
                                              />
                                              <Show when={showResults()}>
                                                <div data-part-tool-code>
                                                  <CodeBlock
                                                    lang={getShikiLang(
                                                      filePath(),
                                                    )}
                                                    code={
                                                      toolData()?.args?.content
                                                    }
                                                  />
                                                </div>
                                              </Show>
                                            </div>
                                          </Match>
                                        </Switch>
                                      </div>
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                part.toolInvocation.toolName === "edit" &&
                                part
                              }
                            >
                              {(_part) => {
                                const diff = () => toolData()?.metadata?.diff
                                const message = () =>
                                  toolData()?.metadata?.message
                                const hasError = () =>
                                  toolData()?.metadata?.error
                                const filePath = createMemo(() =>
                                  stripWorkingDirectory(
                                    toolData()?.args.filePath,
                                    data().rootDir,
                                  ),
                                )
                                const diagnostics = createMemo(() =>
                                  getDiagnostics(
                                    toolData()?.metadata?.diagnostics,
                                    toolData()?.args.filePath,
                                  ),
                                )

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-edit"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconPencilSquare
                                          width={18}
                                          height={18}
                                        />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>Edit</span>
                                          <b title={toolData()?.args?.filePath}>
                                            {filePath()}
                                          </b>
                                        </div>
                                        <Switch>
                                          <Match when={hasError()}>
                                            <div data-part-tool-result>
                                              <ErrorPart>
                                                {formatErrorString(message())}
                                              </ErrorPart>
                                            </div>
                                          </Match>
                                          <Match when={diff()}>
                                            <div data-part-tool-edit>
                                              <DiffView
                                                class={
                                                  styles["diff-code-block"]
                                                }
                                                diff={diff()}
                                                lang={getShikiLang(filePath())}
                                              />
                                            </div>
                                          </Match>
                                        </Switch>
                                        <Show when={diagnostics().length > 0}>
                                          <ErrorPart>{diagnostics()}</ErrorPart>
                                        </Show>
                                      </div>
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                part.toolInvocation.toolName === "bash" &&
                                part
                              }
                            >
                              {(_part) => {
                                const command = () =>
                                  toolData()?.metadata?.title
                                const desc = () =>
                                  toolData()?.metadata?.description
                                const result = () =>
                                  toolData()?.metadata?.stdout
                                const error = () => toolData()?.metadata?.stderr

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-bash"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconCommandLine
                                          width={18}
                                          height={18}
                                        />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      {command() && (
                                        <div data-part-tool-body>
                                          <TerminalPart
                                            desc={desc()}
                                            data-size="sm"
                                            command={command()!}
                                            result={result()}
                                            error={error()}
                                          />
                                        </div>
                                      )}
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                part.toolInvocation.toolName === "todowrite" &&
                                part
                              }
                            >
                              {(_part) => {
                                const todos = createMemo(() =>
                                  sortTodosByStatus(
                                    toolData()?.args?.todos ?? [],
                                  ),
                                )
                                const starting = () =>
                                  todos().every((t) => t.status === "pending")
                                const finished = () =>
                                  todos().every((t) => t.status === "completed")

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-todo"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconQueueList width={18} height={18} />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>
                                            <Switch fallback="Updating plan">
                                              <Match when={starting()}>
                                                Creating plan
                                              </Match>
                                              <Match when={finished()}>
                                                Completing plan
                                              </Match>
                                            </Switch>
                                          </span>
                                        </div>
                                        <Show when={todos().length > 0}>
                                          <ul class={styles.todos}>
                                            <For each={todos()}>
                                              {(todo) => (
                                                <li data-status={todo.status}>
                                                  <span></span>
                                                  {todo.content}
                                                </li>
                                              )}
                                            </For>
                                          </ul>
                                        </Show>
                                      </div>
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                part.toolInvocation.toolName === "webfetch" &&
                                part
                              }
                            >
                              {(_part) => {
                                const url = () => toolData()?.args.url
                                const format = () => toolData()?.args.format
                                const hasError = () =>
                                  toolData()?.metadata?.error

                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-fetch"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconGlobeAlt width={18} height={18} />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          <span data-element-label>Fetch</span>
                                          <b>{url()}</b>
                                        </div>
                                        <Switch>
                                          <Match when={hasError()}>
                                            <div data-part-tool-result>
                                              <ErrorPart>
                                                {formatErrorString(
                                                  toolData()?.result,
                                                )}
                                              </ErrorPart>
                                            </div>
                                          </Match>
                                          <Match when={toolData()?.result}>
                                            <div data-part-tool-result>
                                              <ResultsButton
                                                results={showResults()}
                                                onClick={() =>
                                                  setShowResults((e) => !e)
                                                }
                                              />
                                              <Show when={showResults()}>
                                                <div data-part-tool-code>
                                                  <CodeBlock
                                                    lang={format() || "text"}
                                                    code={toolData()?.result}
                                                  />
                                                </div>
                                              </Show>
                                            </div>
                                          </Match>
                                        </Switch>
                                      </div>
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                return (
                                  <div
                                    id={anchor()}
                                    data-section="part"
                                    data-part-type="tool-fallback"
                                  >
                                    <div data-section="decoration">
                                      <AnchorIcon id={anchor()}>
                                        <IconWrenchScrewdriver
                                          width={18}
                                          height={18}
                                        />
                                      </AnchorIcon>
                                      <div></div>
                                    </div>
                                    <div data-section="content">
                                      <div data-part-tool-body>
                                        <div data-part-title>
                                          {part().toolInvocation.toolName}
                                        </div>
                                        <div data-part-tool-args>
                                          <For
                                            each={flattenToolArgs(
                                              part().toolInvocation.args,
                                            )}
                                          >
                                            {(arg) => (
                                              <>
                                                <div></div>
                                                <div>{arg[0]}</div>
                                                <div>{arg[1]}</div>
                                              </>
                                            )}
                                          </For>
                                        </div>
                                        <Switch>
                                          <Match when={toolData()?.result}>
                                            <div data-part-tool-result>
                                              <ResultsButton
                                                results={showResults()}
                                                onClick={() =>
                                                  setShowResults((e) => !e)
                                                }
                                              />
                                              <Show when={showResults()}>
                                                <TextPart
                                                  expand
                                                  data-size="sm"
                                                  data-color="dimmed"
                                                  text={toolData()?.result}
                                                />
                                              </Show>
                                            </div>
                                          </Match>
                                          <Match
                                            when={
                                              part().toolInvocation.state ===
                                              "call"
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
                                      <ToolFooter
                                        time={toolData()?.duration || 0}
                                      />
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
                                  <AnchorIcon id={anchor()}>
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

                                      <Match when={msg.role === "user"}>
                                        <IconUserCircle
                                          width={18}
                                          height={18}
                                        />
                                      </Match>
                                    </Switch>
                                  </AnchorIcon>
                                  <div></div>
                                </div>
                                <div data-section="content">
                                  <div data-part-tool-body>
                                    <div data-part-title>
                                      <span data-element-label>
                                        {part.type}
                                      </span>
                                    </div>
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
                  </Suspense>
                )}
              </For>
            </SuspenseList>
            <div data-section="part" data-part-type="summary">
              <div data-section="decoration">
                <span data-status={connectionStatus()[0]}></span>
                <div></div>
              </div>
              <div data-section="content">
                <p data-section="copy">{getStatusText(connectionStatus())}</p>
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
              </div>
            </div>
          </div>
        </Show>
      </div>

      <Show when={debug}>
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
      </Show>

      <Show when={showScrollButton()}>
        <button
          type="button"
          class={styles["scroll-button"]}
          onClick={() =>
            document.body.scrollIntoView({ behavior: "smooth", block: "end" })
          }
          onMouseEnter={() => {
            setIsButtonHovered(true)
            if (scrollTimeout) {
              clearTimeout(scrollTimeout)
            }
          }}
          onMouseLeave={() => {
            setIsButtonHovered(false)
            if (showScrollButton()) {
              scrollTimeout = window.setTimeout(() => {
                if (!isButtonHovered()) {
                  setShowScrollButton(false)
                }
              }, 3000)
            }
          }}
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <IconArrowDown width={20} height={20} />
        </button>
      </Show>
    </main>
  )
}
