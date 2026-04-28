import { readdirSync, readFileSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import z from "zod"
import { isRecord } from "@/util/record"
import { createSimpleContext } from "./helper"
import { resolveZedDbPath, resolveZedSelection } from "./editor-zed"

const MCP_PROTOCOL_VERSION = "2025-11-25"

const JsonRpcMessageSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
    })
    .optional(),
})

const PositionSchema = z.object({
  line: z.number(),
  character: z.number(),
})

const EditorSelectionSchema = z.object({
  text: z.string(),
  filePath: z.string(),
  source: z.enum(["websocket", "zed"]).optional(),
  selection: z.object({
    start: PositionSchema,
    end: PositionSchema,
  }),
})

const EditorMentionSchema = z.object({
  filePath: z.string(),
  lineStart: z.number(),
  lineEnd: z.number(),
})

const EditorServerInfoSchema = z.object({
  protocolVersion: z.string().optional(),
  serverInfo: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
})

type JsonRpcMessage = z.infer<typeof JsonRpcMessageSchema>
export type EditorSelection = z.infer<typeof EditorSelectionSchema>
export type EditorMention = z.infer<typeof EditorMentionSchema>
type EditorServerInfo = z.infer<typeof EditorServerInfoSchema>

type EditorConnection = {
  url: string
  authToken?: string
  source: string
}

type EditorLockFile = {
  port: number
  authToken?: string
  transport?: string
  workspaceFolders: string[]
  mtimeMs: number
}

export const { use: useEditorContext, provider: EditorContextProvider } = createSimpleContext({
  name: "EditorContext",
  init: () => {
    const mentionListeners = new Set<(mention: EditorMention) => void>()
    const [store, setStore] = createStore<{
      status: "disabled" | "connecting" | "connected"
      selection: EditorSelection | undefined
      server: EditorServerInfo | undefined
    }>({
      status: "disabled",
      selection: undefined,
      server: undefined,
    })

    onMount(() => {
      let socket: WebSocket | undefined
      let closed = false
      let reconnect: ReturnType<typeof setTimeout> | undefined
      let attempt = 0
      let requestID = 0
      let zedSelection: Promise<void> | undefined
      let lastZedSelectionKey: string | undefined
      const pending = new Map<number, string>()

      const send = (payload: JsonRpcMessage) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({ jsonrpc: "2.0", ...payload }))
      }

      const request = (method: string, params?: unknown) => {
        requestID += 1
        pending.set(requestID, method)
        send({ id: requestID, method, params })
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

      const connect = () => {
        if (closed) return

        const connection = resolveEditorConnection()
        if (!connection) {
          const dbPath = resolveZedDbPath()
          if (!dbPath) {
            setStore("status", "disabled")
            scheduleReconnect()
            return
          }
          zedSelection ??= resolveZedSelection(dbPath)
            .then((result) => {
              if (closed || socket) return
              if (result.type === "unavailable") return
              const selection = result.type === "selection" ? result.selection : undefined
              const key = editorSelectionKey(selection)
              if (key !== lastZedSelectionKey) {
                lastZedSelectionKey = key
                setStore("selection", selection)
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
        const current = openEditorSocket(connection)
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

          const selection =
            message.method === "selection_changed" ? EditorSelectionSchema.safeParse(message.params) : undefined
          if (selection?.success) {
            setStore("selection", { ...selection.data, source: "websocket" })
            return
          }

          const mention = message.method === "at_mentioned" ? EditorMentionSchema.safeParse(message.params) : undefined
          if (mention?.success) {
            mentionListeners.forEach((listener) => listener(mention.data))
            return
          }

          if (typeof message.id !== "number") return

          const method = pending.get(message.id)
          if (!method) return

          pending.delete(message.id)
          if (message.error) return

          const initialize = method === "initialize" ? EditorServerInfoSchema.safeParse(message.result) : undefined
          if (initialize?.success) {
            setStore("server", initialize.data)
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

      connect()

      onCleanup(() => {
        closed = true
        if (reconnect) clearTimeout(reconnect)
        socket?.close()
      })
    })

    return {
      enabled() {
        return Boolean(resolveEditorConnection() || resolveZedDbPath())
      },
      connected() {
        return store.status === "connected"
      },
      selection() {
        return store.selection
      },
      clearSelection() {
        setStore("selection", undefined)
      },
      onMention(listener: (mention: EditorMention) => void) {
        mentionListeners.add(listener)
        return () => mentionListeners.delete(listener)
      },
      server() {
        return store.server
      },
    }
  },
})

function parsePort(value: string | undefined) {
  if (!value) return

  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return
  return parsed
}

function resolveEditorConnection(): EditorConnection | undefined {
  const lock = resolveEditorLockFile()
  if (lock) {
    return {
      url: `ws://127.0.0.1:${lock.port}`,
      authToken: lock.authToken,
      source: `lock:${lock.port}`,
    }
  }

  const port = parsePort(process.env.CLAUDE_CODE_SSE_PORT || process.env.OPENCODE_EDITOR_SSE_PORT)
  if (!port) return
  return {
    url: `ws://127.0.0.1:${port}`,
    source: `env:${port}`,
  }
}

function resolveEditorLockFile() {
  const directory = path.join(os.homedir(), ".claude", "ide")
  let entries: string[]

  try {
    entries = readdirSync(directory)
  } catch {
    return
  }

  const cwd = process.cwd()
  // longest workspace folder that contains cwd; 0 if none match
  const bestMatchLength = (lock: EditorLockFile) =>
    Math.max(0, ...lock.workspaceFolders.map((folder) => pathContainsLength(folder, cwd)))
  const locks = entries
    .filter((entry) => entry.endsWith(".lock"))
    .map((entry) => readEditorLockFile(path.join(directory, entry)))
    .filter((entry): entry is EditorLockFile => Boolean(entry))
    .filter((entry) => bestMatchLength(entry) > 0)
    // prefer locks with longer matching workspace folders, then more recent ones
    .sort((left, right) => bestMatchLength(right) - bestMatchLength(left) || right.mtimeMs - left.mtimeMs)
  return locks[0]
}

function readEditorLockFile(filePath: string): EditorLockFile | undefined {
  const port = parsePort(path.basename(filePath, ".lock"))
  if (!port) return

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown
    if (!isRecord(parsed)) return
    if (parsed.transport !== undefined && parsed.transport !== "ws") return

    return {
      port,
      authToken: typeof parsed.authToken === "string" ? parsed.authToken : undefined,
      transport: typeof parsed.transport === "string" ? parsed.transport : undefined,
      workspaceFolders: Array.isArray(parsed.workspaceFolders)
        ? parsed.workspaceFolders.filter((value): value is string => typeof value === "string")
        : [],
      mtimeMs: statSync(filePath).mtimeMs,
    }
  } catch {
    return
  }
}

function editorSelectionKey(selection: EditorSelection | undefined) {
  if (!selection) return ""
  return [
    selection.filePath,
    selection.selection.start.line,
    selection.selection.start.character,
    selection.selection.end.line,
    selection.selection.end.character,
    selection.text,
  ].join("\0")
}

function pathContainsLength(parent: string, child: string) {
  const resolved = path.resolve(parent)
  const relative = path.relative(resolved, path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved.length : 0
}

function openEditorSocket(connection: EditorConnection) {
  if (!connection.authToken) return new WebSocket(connection.url)

  return new WebSocket(connection.url, {
    headers: {
      "x-claude-code-ide-authorization": connection.authToken,
    },
  } as any)
}

function parseMessage(value: unknown) {
  if (typeof value !== "string") return

  try {
    return JsonRpcMessageSchema.parse(JSON.parse(value))
  } catch {
    return
  }
}
