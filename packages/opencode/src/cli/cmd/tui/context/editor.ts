import { readdirSync, readFileSync, statSync } from "node:fs"
import { Database } from "bun:sqlite"
import os from "node:os"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import z from "zod"
import { createSimpleContext } from "./helper"

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

type ZedEditorRow = {
  workspace_paths: string | null
  timestamp: string
  buffer_path: string | null
  contents: string | null
  selection_start: number | null
  selection_end: number | null
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

      const scheduleReconnect = (delay: number) => {
        if (closed) return
        if (reconnect) clearTimeout(reconnect)
        reconnect = setTimeout(connect, delay)
      }

      const connect = () => {
        if (closed) return

        const connection = resolveEditorConnection()
        if (!connection) {
          if (!resolveZedDbPath()) {
            setStore("status", "disabled")
            scheduleReconnect(1000)
            return
          }
          void resolveZedSelection()
            .then((selection) => {
              if (closed || socket) return
              setStore("selection", selection)
              setStore("status", selection ? "connected" : "disabled")
            })
            .catch(() => {
              if (closed || socket) return
              setStore("status", "disabled")
            })
          scheduleReconnect(1000)
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
            setStore("selection", selection.data)
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
          attempt += 1
          const delay = Math.min(1000 * 2 ** (attempt - 1), 30000)
          scheduleReconnect(delay)
        })
      }

      scheduleReconnect(0)

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

async function resolveZedSelection() {
  const dbPath = resolveZedDbPath()
  if (!dbPath) return

  const row = queryZedActiveEditor(dbPath, process.cwd())
  if (!row?.buffer_path || row.selection_start == null || row.selection_end == null) return

  const text =
    row.contents ??
    (await Bun.file(row.buffer_path)
      .text()
      .catch(() => undefined))
  if (text == null) return

  const start = offsetToPosition(text, Math.min(row.selection_start, row.selection_end))
  const end = offsetToPosition(text, Math.max(row.selection_start, row.selection_end))

  return {
    text: text.slice(
      Math.min(row.selection_start, row.selection_end),
      Math.max(row.selection_start, row.selection_end),
    ),
    filePath: row.buffer_path,
    selection: { start, end },
  }
}

function queryZedActiveEditor(dbPath: string, cwd: string) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    return db
      .query(
        `select
          w.paths as workspace_paths,
          w.timestamp as timestamp,
          e.buffer_path as buffer_path,
          e.contents as contents,
          s.start as selection_start,
          s.end as selection_end
        from items i
        join panes p on p.pane_id = i.pane_id and p.workspace_id = i.workspace_id
        join workspaces w on w.workspace_id = i.workspace_id
        join editors e on e.item_id = i.item_id and e.workspace_id = i.workspace_id
        left join editor_selections s on s.editor_id = e.item_id and s.workspace_id = e.workspace_id
        where i.active = 1 and p.active = 1 and i.kind = 'Editor' and e.buffer_path is not null
        order by w.timestamp desc`,
      )
      .all()
      .filter(isZedEditorRow)
      .map((row) => ({ row, score: scoreZedWorkspace(row.workspace_paths, cwd) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || right.row.timestamp.localeCompare(left.row.timestamp))[0]?.row
  } catch {
    return
  } finally {
    db?.close()
  }
}

function resolveZedDbPath() {
  const candidates = [
    process.env.OPENCODE_ZED_DB,
    path.join(os.homedir(), "Library", "Application Support", "Zed", "db", "0-stable", "db.sqlite"),
    path.join(os.homedir(), ".local", "share", "zed", "db", "0-stable", "db.sqlite"),
  ].filter((item): item is string => Boolean(item))

  return candidates.find((item) => statSafe(item)?.isFile())
}

function scoreZedWorkspace(workspacePaths: string | null, cwd: string) {
  return zedWorkspacePaths(workspacePaths).reduce((score, item) => {
    if (pathContains(item, cwd)) return Math.max(score, 2)
    if (pathContains(cwd, item)) return Math.max(score, 1)
    return score
  }, 0)
}

function zedWorkspacePaths(value: string | null) {
  if (!value) return []
  const parsed = parseJson(value)
  if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string")
  return value.split(/\r?\n/).filter(Boolean)
}

export function offsetToPosition(text: string, offset: number) {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lineStart = before.lastIndexOf("\n")
  return {
    line: before.split("\n").length,
    character: lineStart === -1 ? before.length + 1 : before.length - lineStart,
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
  const locks = entries
    .filter((entry) => entry.endsWith(".lock"))
    .map((entry) => readEditorLockFile(path.join(directory, entry)))
    .filter((entry): entry is EditorLockFile => Boolean(entry))
    .sort((left, right) => scoreEditorLock(right, cwd) - scoreEditorLock(left, cwd))

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

function statSafe(filePath: string) {
  try {
    return statSync(filePath)
  } catch {
    return
  }
}

function scoreEditorLock(lock: EditorLockFile, cwd: string) {
  const workspaceMatch = lock.workspaceFolders.some((folder) => pathContains(folder, cwd)) ? 1 : 0
  return workspaceMatch * 1_000_000_000_000 + lock.mtimeMs
}

function pathContains(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
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

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return
  }
}

function isZedEditorRow(value: unknown): value is ZedEditorRow {
  if (!isRecord(value)) return false
  return (
    (typeof value.workspace_paths === "string" || value.workspace_paths === null) &&
    typeof value.timestamp === "string" &&
    (typeof value.buffer_path === "string" || value.buffer_path === null) &&
    (typeof value.contents === "string" || value.contents === null) &&
    (typeof value.selection_start === "number" || value.selection_start === null) &&
    (typeof value.selection_end === "number" || value.selection_end === null)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
