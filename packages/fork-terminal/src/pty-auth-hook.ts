import type { Context } from "hono"
import type { WSContext } from "hono/ws"
import type { AuthEnv } from "@opencode-ai/fork-auth/middleware/auth"
import { getAuthContext } from "@opencode-ai/fork-auth/middleware/auth"
import { BrokerClient } from "@opencode-ai/fork-auth/auth/broker-client"

export type PtyRouteEnv = AuthEnv & {
  Variables: AuthEnv["Variables"] & {
    ptyRequestId?: string
  }
}

type PtyRouteLogger = {
  info(message?: any, extra?: Record<string, any>): void
  warn(message?: any, extra?: Record<string, any>): void
}

export type CreateErrorStatus = 404 | 500 | 503

type CreateErrorMapper = (error: unknown, message: string) => { code: string; status: CreateErrorStatus }

type MaybeHandleAuthPtyCreateParams<TInput, TInfo> = {
  c: Context<AuthEnv>
  requestId: string
  authEnabled: boolean
  input: TInput
  createPty: (input: TInput, sessionId: string, requestId: string) => Promise<TInfo>
  mapCreateError: CreateErrorMapper
  getErrorMessage: (error: unknown) => string
  log: PtyRouteLogger
}

type BrokerSessionInfo = {
  id: string
  username: string
  uid?: number
  gid?: number
  home?: string
  shell?: string
}

type HandlePtyCreateParams<TInput, TInfo> = {
  c: Context<PtyRouteEnv>
  requestId: string
  input: TInput
  createPty: (input: TInput, sessionId?: string, requestId?: string) => Promise<TInfo>
  mapCreateError: CreateErrorMapper
  getErrorMessage: (error: unknown) => string
  log: PtyRouteLogger
}

type HandlePtyUpdateParams<TInput, TInfo> = {
  c: Context<PtyRouteEnv>
  authEnabled: boolean
  ptyId: string
  input: TInput
  getPty: (id: string) => TInfo | undefined
  updatePty: (id: string, input: TInput) => Promise<TInfo | undefined> | TInfo | undefined
  onNotFound: (message: string) => never
}

type HandlePtyRemoveParams<TInfo> = {
  c: Context<PtyRouteEnv>
  authEnabled: boolean
  ptyId: string
  getPty: (id: string) => TInfo | undefined
  removePty: (id: string) => Promise<void> | void
  onNotFound: (message: string) => never
}

type HandlePtyGetParams<TInfo> = {
  c: Context<PtyRouteEnv>
  ptyId: string
  getPty: (id: string) => TInfo | undefined
  onNotFound: (message: string) => never
}

export function ensurePtyExists<T>(params: { info: T | undefined; onNotFound: (message: string) => never; message?: string }): T {
  if (!params.info) {
    return params.onNotFound(params.message ?? "Session not found")
  }
  return params.info
}

export function getPtyErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Unknown error"
}

export function mapPtyCreateError(error: unknown, message: string): { code: string; status: CreateErrorStatus } {
  if (error && typeof error === "object") {
    const code = typeof (error as { code?: string }).code === "string" ? (error as { code: string }).code : undefined
    if (code === "broker_session_not_found") {
      return { code, status: 404 }
    }
    if (code === "broker_unavailable") {
      return { code, status: 503 }
    }
  }
  const normalized = message.toLowerCase()
  if (normalized.includes("session not found")) {
    return { code: "broker_session_not_found", status: 404 }
  }
  if (normalized.includes("broker unavailable")) {
    return { code: "broker_unavailable", status: 503 }
  }
  return { code: "pty_create_failed", status: 500 }
}

export function createPtyRequestId(): string {
  return crypto.randomUUID()
}

export function setPtyRequestId(c: Context<PtyRouteEnv>, requestId: string): void {
  c.set("ptyRequestId", requestId)
}

export function getPtyRequestId(c: Context<PtyRouteEnv>): string | undefined {
  return c.get("ptyRequestId") as string | undefined
}

export function resolvePtyConnectRequestId(c: Context<PtyRouteEnv>): string {
  const requestId = c.req.query("requestId") ?? createPtyRequestId()
  setPtyRequestId(c, requestId)
  return requestId
}

export function maybeRequirePtyAuth(c: Context<AuthEnv>, authEnabled: boolean): Response | null {
  if (!authEnabled) return null
  const auth = getAuthContext(c)
  if (!auth) {
    return c.json({ error: "Authentication required" }, 401)
  }
  return null
}

export async function handlePtyCreateNoAuth<TInput, TInfo>({
  c,
  requestId,
  input,
  createPty,
  mapCreateError,
  getErrorMessage,
  log,
}: HandlePtyCreateParams<TInput, TInfo>): Promise<Response> {
  try {
    const info = await createPty(input, undefined, requestId)
    log.info("pty created", { requestId, ptyId: (info as { id?: string }).id })
    return c.json(info)
  } catch (error) {
    const message = getErrorMessage(error)
    const mapped = mapCreateError(error, message)
    log.warn("pty create failed", { requestId, code: mapped.code, error: message })
    return c.json({ error: message, code: mapped.code, requestId }, mapped.status)
  }
}

export async function handlePtyUpdate<TInput, TInfo>({
  c,
  authEnabled,
  ptyId,
  input,
  getPty,
  updatePty,
  onNotFound,
}: HandlePtyUpdateParams<TInput, TInfo>): Promise<Response> {
  const authResponse = maybeRequirePtyAuth(c, authEnabled)
  if (authResponse) return authResponse

  ensurePtyExists({ info: getPty(ptyId), onNotFound })

  const updated = await updatePty(ptyId, input)
  const info = ensurePtyExists({ info: updated, onNotFound })
  return c.json(info)
}

export async function handlePtyRemove<TInfo>({
  c,
  authEnabled,
  ptyId,
  getPty,
  removePty,
  onNotFound,
}: HandlePtyRemoveParams<TInfo>): Promise<Response> {
  const authResponse = maybeRequirePtyAuth(c, authEnabled)
  if (authResponse) return authResponse

  ensurePtyExists({ info: getPty(ptyId), onNotFound })

  await removePty(ptyId)
  return c.json(true)
}

export function handlePtyGet<TInfo>({ c, ptyId, getPty, onNotFound }: HandlePtyGetParams<TInfo>): Response {
  const info = ensurePtyExists({ info: getPty(ptyId), onNotFound })
  return c.json(info)
}

export async function maybeHandleAuthPtyCreate<TInput, TInfo>({
  c,
  requestId,
  authEnabled,
  input,
  createPty,
  mapCreateError,
  getErrorMessage,
  log,
}: MaybeHandleAuthPtyCreateParams<TInput, TInfo>): Promise<Response | null> {
  if (!authEnabled) return null

  const auth = getAuthContext(c)
  if (!auth) {
    return c.json({ error: "Authentication required" }, 401)
  }
  const session = c.get("session") as BrokerSessionInfo | undefined
  if (!session) {
    return c.json({ error: "Session not found", code: "session_missing" }, 401)
  }
  if (!session.uid || !session.gid || !session.home || !session.shell) {
    return c.json({ error: "Session missing user info", code: "session_missing_user_info" }, 500)
  }

  const brokerClient = new BrokerClient()
  const registered = await brokerClient.registerSession(session.id, {
    username: session.username,
    uid: session.uid,
    gid: session.gid,
    home: session.home,
    shell: session.shell,
  })

  if (!registered) {
    return c.json(
      {
        error: "Broker unavailable",
        code: "broker_unavailable",
        requestId,
      },
      503,
    )
  }

  try {
    const info = await createPty(input, auth.sessionId, requestId)
    log.info("pty created", { requestId, sessionId: auth.sessionId, ptyId: (info as { id?: string }).id })
    return c.json(info)
  } catch (error) {
    const message = getErrorMessage(error)
    const mapped = mapCreateError(error, message)
    log.warn("pty create failed", {
      requestId,
      sessionId: auth.sessionId,
      code: mapped.code,
      error: message,
    })
    return c.json({ error: message, code: mapped.code, requestId }, mapped.status)
  }
}

export function ensurePtyConnectSession<TInfo>(
  c: Context<PtyRouteEnv>,
  params: {
    ptyId: string
    requestId: string
    getPty: (id: string) => TInfo | undefined
    log: PtyRouteLogger
  },
): Response | null {
  if (!params.getPty(params.ptyId)) {
    params.log.warn("pty connect session not found", {
      requestId: params.requestId,
      ptyId: params.ptyId,
      code: "pty_session_not_found",
    })
    return c.json({ error: "Session not found", code: "pty_session_not_found", requestId: params.requestId }, 404)
  }
  return null
}

export function createPtyWebSocketHandlers(params: {
  id: string
  requestId?: string
  connect: (
    id: string,
    ws: WSContext,
    options?: { requestId?: string },
  ) => { onMessage: (msg: string | ArrayBuffer) => void; onClose: () => void } | undefined
  log: PtyRouteLogger
}) {
  let handler: ReturnType<typeof params.connect>
  return {
    onOpen(_event: Event, ws: WSContext) {
      params.log.info("pty websocket opened", { requestId: params.requestId, ptyId: params.id })
      handler = params.connect(params.id, ws, { requestId: params.requestId })
    },
    onMessage(event: MessageEvent) {
      handler?.onMessage(String(event.data))
    },
    onClose() {
      params.log.info("pty websocket closed", { requestId: params.requestId, ptyId: params.id })
      handler?.onClose()
    },
  }
}
