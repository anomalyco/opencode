export * as AntigravitySession from "./session.js"

import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { AntigravityACP } from "./acp.js"
import { AntigravityCatalog } from "./catalog.js"

/**
 * One CLI runs for the plugin, started on first use, and each OpenCode session gets its own CLI
 * conversation so sessions never continue each other's. A request outside a session, such as a
 * title, runs in a throwaway conversation. When the CLI dies, the next turn starts a new one.
 */
export interface Interface {
  readonly groups: () => readonly AntigravityCatalog.Group[]
  readonly refresh: () => Promise<readonly AntigravityCatalog.Group[]>
  readonly run: (
    request: Request,
    onUpdate: (update: AntigravityACP.Update) => void,
    signal: AbortSignal,
  ) => Promise<AntigravityACP.Turn>
  readonly remove: (sessionID: string) => Promise<void>
  readonly close: () => Promise<void>
}

export interface Request {
  readonly sessionID?: string
  /** The OpenCode agent running the turn, whose permission rules apply. */
  readonly agent?: string
  /** What the request is for. Only "primary" requests continue the session's conversation. */
  readonly kind?: string
  /** The OpenCode model id, the CLI's model without its effort level. */
  readonly model: string
  /** The CLI's model id the variant names, when one was picked. */
  readonly slug?: string
  /** The effort level the variant names, when one was picked. */
  readonly effort?: string
  readonly prompt: string
}

export interface PermissionCheck {
  readonly sessionID: string
  readonly agent?: string
  readonly action: string
  readonly resources: readonly string[]
  readonly metadata: Record<string, unknown>
}

/** The part of the ACP client the sessions use, so tests can run without the CLI. */
export interface Connection {
  readonly closed: Promise<void>
  readonly newSession: (cwd: string) => Promise<AntigravityACP.Session>
  readonly setModel: (sessionId: string, modelId: string) => Promise<void>
  readonly closeSession: (sessionId: string) => Promise<void>
  readonly prompt: (
    sessionId: string,
    prompt: string,
    onUpdate: (update: AntigravityACP.Update) => void,
    signal?: AbortSignal,
  ) => Promise<AntigravityACP.Turn>
  readonly close: () => Promise<void>
}

export interface Options {
  readonly directory: string
  readonly initial?: readonly AntigravityCatalog.Group[]
  /**
   * Asks OpenCode whether the agent may do something. Resolves true when the session's rules allow
   * it, or the user approved it.
   */
  readonly assert?: (check: PermissionCheck) => Promise<boolean>
  /** Called when the CLI reports a model list that differs from the one known so far. */
  readonly onModels?: (groups: readonly AntigravityCatalog.Group[]) => void
  readonly connect?: (options: AntigravityACP.Options) => Promise<Connection>
}

interface Conversation {
  readonly sessionId: string
  slug: string | undefined
  /** The turns of one OpenCode session run one after another. */
  queue: Promise<unknown>
}

interface Owner {
  readonly sessionID: string
  readonly agent: string | undefined
}

export const make = (options: Options): Interface => {
  const connect = options.connect ?? startCLI
  let groups: readonly AntigravityCatalog.Group[] = options.initial ?? []
  let client: Promise<Connection> | undefined
  // The conversations belong to the CLI that opened them, so they go when it goes.
  const conversations = new Map<string, Promise<Conversation>>()
  // Who a CLI conversation runs for, so its permission requests are checked against the right rules.
  const owners = new Map<string, Owner>()

  const forget = (stale: Promise<Connection>) => {
    if (client !== stale) return
    client = undefined
    conversations.clear()
    owners.clear()
  }

  const permit = async (request: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
    const owner = owners.get(request.sessionId)
    if (!owner || !options.assert) return choose(request, false)
    const allowed = await options
      .assert({ sessionID: owner.sessionID, agent: owner.agent, ...toPermission(request) })
      .catch(() => false)
    return choose(request, allowed)
  }

  const ensure = () => {
    if (client) return client
    const started = connect({ cwd: options.directory, permission: permit })
    client = started
    started.then(
      (connection) => connection.closed.then(() => forget(started)),
      () => forget(started),
    )
    return started
  }

  const open = async (connection: Connection) => {
    const session = await connection.newSession(options.directory)
    const reported = AntigravityCatalog.group(session.models)
    if (reported.length > 0 && !same(reported, groups)) {
      groups = reported
      options.onModels?.(reported)
    }
    return session
  }

  const slugOf = (request: Request) =>
    request.slug ?? AntigravityCatalog.resolveSlug(groups, request.model, request.effort) ?? request.model

  const conversation = (connection: Connection, sessionID: string) => {
    const existing = conversations.get(sessionID)
    if (existing) return existing
    const opened = open(connection).then(
      (session): Conversation => ({
        sessionId: session.sessionId,
        slug: session.currentModel,
        queue: Promise.resolve(),
      }),
    )
    conversations.set(sessionID, opened)
    opened.catch(() => {
      if (conversations.get(sessionID) === opened) conversations.delete(sessionID)
    })
    return opened
  }

  const turn = async (
    connection: Connection,
    chat: Conversation,
    request: Request,
    onUpdate: (update: AntigravityACP.Update) => void,
    signal: AbortSignal,
  ) => {
    const slug = slugOf(request)
    if (slug !== chat.slug) {
      await connection.setModel(chat.sessionId, slug)
      chat.slug = slug
    }
    return connection.prompt(chat.sessionId, request.prompt, onUpdate, signal)
  }

  return {
    groups: () => groups,
    refresh: async () => {
      const connection = await ensure()
      const session = await open(connection)
      await connection.closeSession(session.sessionId).catch(() => {})
      return groups
    },
    run: async (request, onUpdate, signal) => {
      const connection = await ensure()
      const sessionID = request.sessionID
      if (sessionID === undefined || (request.kind !== undefined && request.kind !== "primary")) {
        // A request outside the conversation gets one of its own, with no one to approve its tools.
        const session = await open(connection)
        const chat: Conversation = {
          sessionId: session.sessionId,
          slug: session.currentModel,
          queue: Promise.resolve(),
        }
        try {
          return await turn(connection, chat, request, onUpdate, signal)
        } finally {
          await connection.closeSession(session.sessionId).catch(() => {})
        }
      }
      const chat = await conversation(connection, sessionID)
      const result = chat.queue.then(() => {
        owners.set(chat.sessionId, { sessionID, agent: request.agent })
        return turn(connection, chat, request, onUpdate, signal)
      })
      chat.queue = result.catch(() => {})
      return result
    },
    remove: async (sessionID) => {
      const existing = conversations.get(sessionID)
      if (!existing) return
      conversations.delete(sessionID)
      const chat = await existing.catch(() => undefined)
      if (!chat) return
      owners.delete(chat.sessionId)
      const connection = await client?.catch(() => undefined)
      await connection?.closeSession(chat.sessionId).catch(() => {})
    },
    close: async () => {
      const current = client
      if (!current) return
      forget(current)
      const connection = await current.catch(() => undefined)
      await connection?.close()
    },
  }
}

/**
 * The OpenCode permission a request asks for.
 *
 * The agent names what kind of thing a tool does, and that maps onto the actions OpenCode's rules
 * are written for, so a rule that asks before edits also asks before the agent's edits.
 */
export function toPermission(request: RequestPermissionRequest): Omit<PermissionCheck, "sessionID" | "agent"> {
  const call = request.toolCall
  const kind = call.kind ?? "other"
  const action = ACTIONS[kind] ?? "antigravity"
  const paths = (call.locations ?? []).map((location) => location.path).filter((path) => path.length > 0)
  const command = kind === "execute" ? commandOf(call.rawInput) : undefined
  const resources = paths.length > 0 ? paths : command !== undefined ? [command] : call.title ? [call.title] : ["*"]
  return {
    action,
    resources,
    metadata: { title: call.title ?? undefined, kind, rawInput: call.rawInput },
  }
}

export function choose(request: RequestPermissionRequest, allowed: boolean): RequestPermissionResponse {
  const kinds = allowed ? (["allow_once", "allow_always"] as const) : (["reject_once", "reject_always"] as const)
  for (const kind of kinds) {
    const option = request.options.find((candidate) => candidate.kind === kind)
    if (option) return { outcome: { outcome: "selected", optionId: option.optionId } }
  }
  return { outcome: { outcome: "cancelled" } }
}

const ACTIONS: Record<string, string> = {
  read: "read",
  search: "grep",
  edit: "edit",
  delete: "edit",
  move: "edit",
  execute: "bash",
  fetch: "webfetch",
}

function commandOf(input: unknown) {
  if (typeof input !== "object" || input === null) return undefined
  const command = (input as { command?: unknown }).command
  if (typeof command === "string" && command.length > 0) return command
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) return command.join(" ")
  return undefined
}

function same(left: readonly AntigravityCatalog.Group[], right: readonly AntigravityCatalog.Group[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

// Loaded on first use, and stubbed on workerd, which cannot spawn the CLI.
const startCLI = async (options: AntigravityACP.Options): Promise<Connection> => {
  const { AntigravityACPClient } = await import("#antigravity-acp")
  return AntigravityACPClient.Client.start(options)
}
