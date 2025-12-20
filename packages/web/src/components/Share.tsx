import { For, Show, onMount, Suspense, onCleanup, createMemo, createSignal, SuspenseList, createEffect } from "solid-js"
import { DateTime } from "luxon"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { IconArrowDown } from "./icons"
import { IconOpencode } from "./icons/custom"
import styles from "./share.module.css"
import type { MessageV2 } from "opencode/session/message-v2"
import type { Message } from "opencode/session/message"
import type { Session } from "opencode/session/index"
import { Part, ProviderIcon } from "./share/part"

type MessageWithParts = MessageV2.Info & { parts: MessageV2.Part[] }

type Status = "disconnected" | "connecting" | "connected" | "error" | "reconnecting"

function scrollToAnchor(id: string) {
  const el = document.getElementById(id)
  if (!el) return

  el.scrollIntoView({ behavior: "smooth" })
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

export default function Share(props: { id: string; api: string; info: Session.Info }) {
  let lastScrollY = 0
  let hasScrolledToAnchor = false
  let scrollTimeout: number | undefined
  let scrollSentinel: HTMLElement | undefined
  let scrollObserver: IntersectionObserver | undefined

  const params = new URLSearchParams(window.location.search)
  const debug = params.get("debug") === "true"

  const [showScrollButton, setShowScrollButton] = createSignal(false)
  const [isButtonHovered, setIsButtonHovered] = createSignal(false)
  const [isNearBottom, setIsNearBottom] = createSignal(false)

  const [store, setStore] = createStore<{
    info?: Session.Info
    messages: Record<string, MessageWithParts>
  }>({
    info: {
      id: props.id,
      title: props.info.title,
      version: props.info.version,
      time: {
        created: props.info.time.created,
        updated: props.info.time.updated,
      },
    },
    messages: {},
  })
  const messages = createMemo(() => Object.values(store.messages).toSorted((a, b) => a.id?.localeCompare(b.id)))
  const [connectionStatus, setConnectionStatus] = createSignal<[Status, string?]>(["disconnected", "Disconnected"])
  createEffect(() => {
    console.log(unwrap(store))
  })

  onMount(() => {
    const apiUrl = props.api

    if (!props.id) {
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
      const wsUrl = `${wsBaseUrl}/share_poll?id=${props.id}`
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
            if ("metadata" in d.content) {
              d.content = fromV1(d.content)
            }
            d.content.parts = d.content.parts ?? store.messages[messageID]?.parts ?? []
            setStore("messages", messageID, reconcile(d.content))
          }
          if (type === "part") {
            setStore("messages", d.content.messageID, "parts", (arr) => {
              const index = arr.findIndex((x) => x.id === d.content.id)
              if (index === -1) arr.push(d.content)
              if (index > -1) arr[index] = d.content
              return [...arr]
            })
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
        reconnectTimer = window.setTimeout(setupWebSocket, 2000) as unknown as number
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
      messages: [] as MessageWithParts[],
      models: {} as Record<string, string[]>,
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
      },
    }

    if (!store.info) return result

    result.created = store.info.time.created

    const msgs = messages()
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]

      result.messages.push(msg)

      if (msg.role === "assistant") {
        result.cost += msg.cost
        result.tokens.input += msg.tokens.input
        result.tokens.output += msg.tokens.output
        result.tokens.reasoning += msg.tokens.reasoning

        result.models[`${msg.providerID} ${msg.modelID}`] = [msg.providerID, msg.modelID]

        if (msg.path.root) {
          result.rootDir = msg.path.root
        }

        if (msg.time.completed) {
          result.completed = msg.time.completed
        }
      }
    }
    return result
  })

  return (
    <Show when={store.info}>
      <main classList={{ [styles.root]: true, "not-content": true }}>
        <div data-component="header">
          <h1 data-component="header-title">{store.info?.title}</h1>
          <div data-component="header-details">
            <ul data-component="header-stats">
              <li title="opencode version" data-slot="item">
                <div data-slot="icon" title="opencode">
                  <IconOpencode width={16} height={16} />
                </div>
                <Show when={store.info?.version} fallback="v0.0.1">
                  <span>v{store.info?.version}</span>
                </Show>
              </li>
              {Object.values(data().models).length > 0 ? (
                <For each={Object.values(data().models)}>
                  {([provider, model]) => (
                    <li data-slot="item">
                      <div data-slot="icon" title={provider}>
                        <ProviderIcon model={model} />
                      </div>
                      <span data-slot="model">{model}</span>
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
            <div
              data-component="header-time"
              title={DateTime.fromMillis(data().created || 0).toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS)}
            >
              {DateTime.fromMillis(data().created || 0).toLocaleString(DateTime.DATETIME_MED)}
            </div>
          </div>
        </div>

        <div>
          <Show when={data().messages.length > 0} fallback={<p>Waiting for messages...</p>}>
            <div class={styles.parts}>
              <SuspenseList revealOrder="forwards">
                <For each={data().messages}>
                  {(msg, msgIndex) => {
                    const filteredParts = createMemo(() =>
                      msg.parts.filter((x, index) => {
                        if (x.type === "step-start" && index > 0) return false
                        if (x.type === "snapshot") return false
                        if (x.type === "patch") return false
                        if (x.type === "step-finish") return false
                        if (x.type === "text" && x.synthetic === true) return false
                        if (x.type === "tool" && x.tool === "todoread") return false
                        if (x.type === "text" && !x.text) return false
                        if (x.type === "tool" && (x.state.status === "pending" || x.state.status === "running"))
                          return false
                        return true
                      }),
                    )

                    return (
                      <Suspense>
                        <For each={filteredParts()}>
                          {(part, partIndex) => {
                            const last = createMemo(
                              () =>
                                data().messages.length === msgIndex() + 1 && filteredParts().length === partIndex() + 1,
                            )

                            onMount(() => {
                              const hash = window.location.hash.slice(1)
                              // Wait till all parts are loaded
                              if (
                                hash !== "" &&
                                !hasScrolledToAnchor &&
                                filteredParts().length === partIndex() + 1 &&
                                data().messages.length === msgIndex() + 1
                              ) {
                                hasScrolledToAnchor = true
                                scrollToAnchor(hash)
                              }
                            })

                            return <Part last={last()} part={part} index={partIndex()} message={msg} />
                          }}
                        </For>
                      </Suspense>
                    )
                  }}
                </For>
              </SuspenseList>
              <div data-section="part" data-part-type="summary">
                <div data-section="decoration">
                  <span data-status={connectionStatus()[0]}></span>
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
                      {data().tokens.input ? <span>{data().tokens.input}</span> : <span data-placeholder>&mdash;</span>}
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
              <Show when={data().messages.length > 0} fallback={<p>Waiting for messages...</p>}>
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
            onClick={() => document.body.scrollIntoView({ behavior: "smooth", block: "end" })}
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
    </Show>
  )
}

export function fromV1(v1: Message.Info): MessageWithParts {
  if (v1.role === "assistant") {
    return {
      id: v1.id,
      sessionID: v1.metadata.sessionID,
      role: "assistant",
      time: {
        created: v1.metadata.time.created,
        completed: v1.metadata.time.completed,
      },
      cost: v1.metadata.assistant!.cost,
      path: v1.metadata.assistant!.path,
      summary: v1.metadata.assistant!.summary,
      tokens: v1.metadata.assistant!.tokens ?? {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
        reasoning: 0,
      },
      modelID: v1.metadata.assistant!.modelID,
      providerID: v1.metadata.assistant!.providerID,
      mode: "build",
      system: v1.metadata.assistant!.system,
      error: v1.metadata.error,
      parts: v1.parts.flatMap((part, index): MessageV2.Part[] => {
        const base = {
          id: index.toString(),
          messageID: v1.id,
          sessionID: v1.metadata.sessionID,
        }
        if (part.type === "text") {
          return [
            {
              ...base,
              type: "text",
              text: part.text,
            },
          ]
        }
        if (part.type === "step-start") {
          return [
            {
              ...base,
              type: "step-start",
            },
          ]
        }
        if (part.type === "tool-invocation") {
          return [
            {
              ...base,
              type: "tool",
              callID: part.toolInvocation.toolCallId,
              tool: part.toolInvocation.toolName,
              state: (() => {
                if (part.toolInvocation.state === "partial-call") {
                  return {
                    status: "pending",
                  }
                }

                const { title, time, ...metadata } = v1.metadata.tool[part.toolInvocation.toolCallId]
                if (part.toolInvocation.state === "call") {
                  return {
                    status: "running",
                    input: part.toolInvocation.args,
                    time: {
                      start: time.start,
                    },
                  }
                }

                if (part.toolInvocation.state === "result") {
                  return {
                    status: "completed",
                    input: part.toolInvocation.args,
                    output: part.toolInvocation.result,
                    title,
                    time,
                    metadata,
                  }
                }
                throw new Error("unknown tool invocation state")
              })(),
            },
          ]
        }
        return []
      }),
    }
  }

  if (v1.role === "user") {
    return {
      id: v1.id,
      sessionID: v1.metadata.sessionID,
      role: "user",
      time: {
        created: v1.metadata.time.created,
      },
      parts: v1.parts.flatMap((part, index): MessageV2.Part[] => {
        const base = {
          id: index.toString(),
          messageID: v1.id,
          sessionID: v1.metadata.sessionID,
        }
        if (part.type === "text") {
          return [
            {
              ...base,
              type: "text",
              text: part.text,
            },
          ]
        }
        if (part.type === "file") {
          return [
            {
              ...base,
              type: "file",
              mime: part.mediaType,
              filename: part.filename,
              url: part.url,
            },
          ]
        }
        return []
      }),
    }
  }

  throw new Error("unknown message type")
}
