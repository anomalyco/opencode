import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Option, Schema, SchemaGetter } from "effect"
import { isRecord } from "../util/record"
import { useTuiPaths } from "./runtime"
import { createSimpleContext } from "./helper"
import { editorIntegration } from "../editor"

const MCP_PROTOCOL_VERSION = "2025-11-25"

const JsonRpcMessageSchema = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.Number, Schema.String, Schema.Null])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.optional(Schema.Number),
      message: Schema.optional(Schema.String),
    }),
  ),
})

const PositionSchema = Schema.Struct({
  line: Schema.Number,
  character: Schema.Number,
})

const EditorSelectionRangeSchema = Schema.Struct({
  text: Schema.String,
  selection: Schema.Struct({
    start: PositionSchema,
    end: PositionSchema,
  }),
})

const EditorSelectionRangesSchema = Schema.Struct({
  filePath: Schema.String,
  source: Schema.optional(Schema.Literals(["websocket", "zed"])),
  ranges: Schema.mutable(Schema.Array(EditorSelectionRangeSchema).check(Schema.isMinLength(1))),
})

const EditorSelectionSchema = Schema.Union([
  EditorSelectionRangesSchema,
  Schema.Struct({
    text: Schema.String,
    filePath: Schema.String,
    source: Schema.optional(Schema.Literals(["websocket", "zed"])),
    selection: Schema.Struct({
      start: PositionSchema,
      end: PositionSchema,
    }),
  }),
]).pipe(
  Schema.decodeTo(EditorSelectionRangesSchema, {
    decode: SchemaGetter.transform((value) =>
      "ranges" in value
        ? value
        : {
            filePath: value.filePath,
            source: value.source,
            ranges: [
              {
                text: value.text,
                selection: value.selection,
              },
            ],
          },
    ),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)

const EditorMentionSchema = Schema.Struct({
  filePath: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
})

const EditorServerInfoSchema = Schema.Struct({
  protocolVersion: Schema.optional(Schema.String),
  serverInfo: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      version: Schema.optional(Schema.String),
    }),
  ),
})

const decodeJsonRpcMessage = Schema.decodeUnknownOption(JsonRpcMessageSchema)
const decodeEditorSelection = Schema.decodeUnknownOption(EditorSelectionSchema)
const decodeEditorMention = Schema.decodeUnknownOption(EditorMentionSchema)
const decodeEditorServerInfo = Schema.decodeUnknownOption(EditorServerInfoSchema)

type JsonRpcMessage = Schema.Schema.Type<typeof JsonRpcMessageSchema>
export type EditorSelection = Schema.Schema.Type<typeof EditorSelectionSchema>
export type EditorMention = Schema.Schema.Type<typeof EditorMentionSchema>
export type EditorLabelState = "pending" | "sent" | "none"
type EditorServerInfo = Schema.Schema.Type<typeof EditorServerInfoSchema>

type EditorConnection = {
  url: string
  authToken?: string
  source: string
}

export type EditorIntegration = Readonly<{
  connection?(directory: string): EditorConnection | undefined
  selection?(directory: string): Promise<unknown>
}>

export const { use: useEditorContext, provider: EditorContextProvider } = createSimpleContext({
  name: "EditorContext",
  init: (props: { integration?: EditorIntegration; WebSocketImpl?: typeof WebSocket }) => {
    const paths = useTuiPaths()
    const editor = props.integration ?? editorIntegration
    const value = process.env.CLAUDE_CODE_SSE_PORT || process.env.OPENCODE_EDITOR_SSE_PORT
    const parsedPort = value ? Number.parseInt(value, 10) : undefined
    const port =
      parsedPort && Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : undefined
    const zedTerminal = process.env.ZED_TERM === "true" || process.env.TERM_PROGRAM?.toLowerCase() === "zed"
    const mentionListeners = new Set<(mention: EditorMention) => void>()
    const WebSocketImpl = props.WebSocketImpl ?? WebSocket
    const [store, setStore] = createStore<{
      status: "disabled" | "connecting" | "connected"
      selection: EditorSelection | undefined
      selectionSent: boolean
      server: EditorServerInfo | undefined
    }>({
      status: "disabled",
      selection: undefined,
      selectionSent: false,
      server: undefined,
    })

    let socket: WebSocket | undefined
    let closed = false
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let requestID = 0
    let zedSelection: Promise<void> | undefined
    let lastZedSelectionKey: string | undefined
    let directory = paths.cwd
    let preserveSelectionOnReconnect = false
    const pending = new Map<number, string>()

    const setSelection = (selection: EditorSelection | undefined) => {
      const changed = editorSelectionKey(selection) !== editorSelectionKey(store.selection)
      setStore("selection", selection)
      if (changed) setStore("selectionSent", false)
    }

    const clearSelectionForReconnect = (options?: { resetZedSelectionKey?: boolean }) => {
      if (preserveSelectionOnReconnect) {
        preserveSelectionOnReconnect = false
        return
      }
      if (options?.resetZedSelectionKey) lastZedSelectionKey = undefined
      setSelection(undefined)
    }

    const send = (payload: JsonRpcMessage) => {
      if (!socket || socket.readyState !== 1) return
      socket.send(JSON.stringify({ jsonrpc: "2.0", ...payload }))
    }

    const request = (method: string, params?: unknown) => {
      requestID += 1
      pending.set(requestID, method)
      send({ id: requestID, method, params })
    }

    const connect = () => {
      if (closed) return

      const connection = resolveEditorConnection(directory, port, editor.connection)
      if (!connection) {
        if (!zedTerminal) {
          setStore("status", "disabled")
          scheduleReconnect()
          return
        }
        if (!editor.selection) {
          setStore("status", "disabled")
          scheduleReconnect()
          return
        }

        zedSelection ??= editor
          .selection(directory)
          .then((result) => {
            if (closed || socket) return
            if (!isRecord(result) || result.type === "unavailable") return
            const decoded = result.type === "selection" ? decodeEditorSelection(result.selection) : Option.none()
            const selection = Option.getOrUndefined(decoded)
            const key = editorSelectionKey(selection)
            if (key !== lastZedSelectionKey) {
              lastZedSelectionKey = key
              setSelection(selection)
              setStore("status", selection ? "connected" : "disabled")
            }
          })
          .catch(() => {
            // Keep the last known Zed selection for transient polling failures.
          })
          .finally(() => {
            zedSelection = undefined
          })
        scheduleZedPoll()
        return
      }

      setStore("status", "connecting")
      const current = openEditorSocket(connection, WebSocketImpl)
      socket = current

      current.addEventListener("open", () => {
        if (socket !== current) {
          current.close()
          return
        }

        attempt = 0
        setStore("status", "connected")
        request("initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "opencode", version: "0.0.0" },
        })
      })

      current.addEventListener("message", (event) => {
        const message = parseMessage(event.data)
        if (!message) return

        const selection = message.method === "selection_changed" ? decodeEditorSelection(message.params) : Option.none()
        if (Option.isSome(selection)) {
          setSelection({ ...selection.value, source: "websocket" })
          return
        }

        const mention = message.method === "at_mentioned" ? decodeEditorMention(message.params) : Option.none()
        if (Option.isSome(mention)) {
          mentionListeners.forEach((listener) => listener(mention.value))
          return
        }

        if (typeof message.id !== "number") return

        const method = pending.get(message.id)
        if (!method) return

        pending.delete(message.id)
        if (message.error) return

        const initialize = method === "initialize" ? decodeEditorServerInfo(message.result) : Option.none()
        if (Option.isSome(initialize)) {
          setStore("server", initialize.value)
          send({ method: "notifications/initialized" })
          return
        }
      })

      current.addEventListener("close", () => {
        if (socket !== current) return

        socket = undefined
        pending.clear()
        if (closed) return

        setStore("status", "connecting")
        scheduleReconnect()
      })
    }

    const scheduleReconnect = () => {
      if (closed) return
      if (reconnect) clearTimeout(reconnect)
      attempt += 1
      const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000)
      reconnect = setTimeout(connect, delay)
    }

    const scheduleZedPoll = () => {
      if (closed) return
      if (reconnect) clearTimeout(reconnect)
      reconnect = setTimeout(connect, 1000)
    }

    const reconnectWithDirectory = (nextDirectory?: string) => {
      const resolved = nextDirectory || paths.cwd
      const sameDirectory = directory === resolved
      clearSelectionForReconnect({ resetZedSelectionKey: !sameDirectory })
      if (sameDirectory) return

      directory = resolved
      attempt = 0
      pending.clear()
      if (reconnect) clearTimeout(reconnect)
      reconnect = undefined
      if (socket) {
        const current = socket
        socket = undefined
        current.close()
      }
      setStore("status", "disabled")
      setStore("server", undefined)
      connect()
    }

    onMount(() => {
      connect()

      onCleanup(() => {
        closed = true
        if (reconnect) clearTimeout(reconnect)
        socket?.close()
      })
    })

    return {
      enabled() {
        return Boolean(resolveEditorConnection(directory, port, editor.connection) || (zedTerminal && editor.selection))
      },
      connected() {
        return store.status === "connected"
      },
      selection() {
        return store.selection
      },
      clearSelection() {
        lastZedSelectionKey = undefined
        zedSelection = undefined
        setSelection(undefined)
      },
      preserveSelectionFromNewSession() {
        preserveSelectionOnReconnect = true
      },
      markSelectionSent() {
        if (!store.selection) return
        setStore("selectionSent", true)
      },
      labelState(): EditorLabelState {
        if (!store.selection) return "none"
        return store.selectionSent ? "sent" : "pending"
      },
      onMention(listener: (mention: EditorMention) => void) {
        mentionListeners.add(listener)
        return () => mentionListeners.delete(listener)
      },
      server() {
        return store.server
      },
      reconnect(directory?: string) {
        reconnectWithDirectory(directory)
      },
    }
  },
})

function resolveEditorConnection(
  directory: string,
  port: number | undefined,
  discover: ((directory: string) => EditorConnection | undefined) | undefined,
): EditorConnection | undefined {
  if (port) {
    return {
      url: `ws://127.0.0.1:${port}`,
      source: `env:${port}`,
    }
  }

  return discover?.(directory)
}

export function editorSelectionKey(selection: EditorSelection | undefined) {
  if (!selection) return ""
  return [
    selection.filePath,
    ...selection.ranges.flatMap((range) => [
      range.selection.start.line,
      range.selection.start.character,
      range.selection.end.line,
      range.selection.end.character,
      range.text,
    ]),
  ].join("\0")
}

function openEditorSocket(connection: EditorConnection, WebSocketImpl: typeof WebSocket) {
  if (!connection.authToken) return new WebSocketImpl(connection.url)

  return new WebSocketImpl(connection.url, {
    headers: {
      "x-claude-code-ide-authorization": connection.authToken,
    },
  } as any)
}

function parseMessage(value: unknown) {
  if (typeof value !== "string") return

  try {
    return Option.getOrUndefined(decodeJsonRpcMessage(JSON.parse(value)))
  } catch {
    return
  }
}
