import type { AuthOAuthResult, Hooks, PluginInput } from "@opencode-ai/plugin"
import { OauthCallbackPage } from "@opencode-ai/core/oauth/page"
import { createServer } from "http"
import os from "os"
import open from "open"

const PROVIDER = "fireworks-ai"
const CLIENT_ID = "sueas7prsfrdp16nantbeqcjv"
const COGNITO_URL = "https://fireworks.auth.us-west-2.amazoncognito.com/oauth2"
const GATEWAY_URL = "https://gateway.fireworks.ai/web/gateway.Gateway"
const VERIFY_URL = "https://api.fireworks.ai/verifyApiKey"
const OAUTH_PORT = 18000
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}`
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000

type FetchFn = typeof fetch

export interface FireworksAuthDeps {
  fetchFn?: FetchFn
  openUrl?: (url: string) => Promise<unknown>
  hostname?: string
  timeoutMs?: number
}

function base64url(bytes: Uint8Array | ArrayBuffer) {
  return Buffer.from(bytes as Uint8Array).toString("base64url")
}

function text(value: string) {
  return new TextEncoder().encode(value)
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export async function generatePkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(await crypto.subtle.digest("SHA-256", text(verifier)))
  return { verifier, challenge }
}

export function generateState() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)))
}

export function buildAuthorizeUrl(state: string, challenge: string) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  })
  return `${COGNITO_URL}/authorize?${params}`
}

export function buildTokenRequestBody(code: string, verifier: string) {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  }).toString()
}

export function extractEmail(token: string) {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString())
    if (!payload || typeof payload !== "object") return undefined
    const email = (payload as { email?: unknown }).email
    return typeof email === "string" ? email : undefined
  } catch {
    return undefined
  }
}

export function encodeVarint(value: number) {
  const bytes: number[] = []
  let current = value
  while (current > 0x7f) {
    bytes.push((current & 0x7f) | 0x80)
    current = Math.floor(current / 128)
  }
  bytes.push(current)
  return new Uint8Array(bytes)
}

export function encodeField(field: number, value: Uint8Array) {
  return concat(encodeVarint((field << 3) | 2), encodeVarint(value.length), value)
}

export function encodeGrpcWebFrame(message: Uint8Array) {
  const header = new Uint8Array(5)
  new DataView(header.buffer).setUint32(1, message.length)
  return concat(header, message)
}

export function decodeGrpcWebFrames(data: Uint8Array) {
  const messages: Uint8Array[] = []
  const trailers: Record<string, string> = {}
  let offset = 0
  while (offset + 5 <= data.length) {
    const flag = data[offset]
    const length = new DataView(data.buffer, data.byteOffset + offset + 1, 4).getUint32(0)
    const payload = data.subarray(offset + 5, offset + 5 + length)
    offset += 5 + length
    if (flag === 0x80) {
      for (const line of Buffer.from(payload).toString().split("\r\n")) {
        const index = line.indexOf(":")
        if (index > 0) trailers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
      }
      continue
    }
    messages.push(payload)
  }
  return { messages, trailers }
}

export type ProtobufField = { field: number; wire: number; value: Uint8Array | number }

function readVarint(data: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let index = offset
  while (index < data.length) {
    const byte = data[index]
    value += (byte & 0x7f) * 2 ** shift
    index++
    if (!(byte & 0x80)) return [value, index]
    shift += 7
  }
  throw new Error("Truncated protobuf varint")
}

export function readFields(data: Uint8Array): ProtobufField[] {
  const fields: ProtobufField[] = []
  let offset = 0
  while (offset < data.length) {
    const [tag, next] = readVarint(data, offset)
    const field = Math.floor(tag / 8)
    const wire = tag & 7
    if (wire === 0) {
      const [value, after] = readVarint(data, next)
      fields.push({ field, wire, value })
      offset = after
      continue
    }
    if (wire === 2) {
      const [length, start] = readVarint(data, next)
      fields.push({ field, wire, value: data.subarray(start, start + length) })
      offset = start + length
      continue
    }
    throw new Error(`Unsupported protobuf wire type ${wire}`)
  }
  return fields
}

export function readString(data: Uint8Array, field: number) {
  const entry = readFields(data).find((item) => item.field === field && item.wire === 2)
  if (!entry || typeof entry.value === "number") return undefined
  return Buffer.from(entry.value).toString()
}

export function parseResourceNames(message: Uint8Array) {
  return readFields(message)
    .filter((field) => field.field === 1 && field.wire === 2 && typeof field.value !== "number")
    .map((field) => readString(field.value as Uint8Array, 1))
    .filter((name): name is string => name !== undefined)
}

export function encodeListUsersRequest(parent: string, email?: string) {
  const parts = [encodeField(1, text(parent))]
  if (email) parts.push(encodeField(4, text(`email="${email}"`)))
  return concat(...parts)
}

export function encodeCreateApiKeyRequest(parent: string, displayName: string) {
  return concat(encodeField(1, text(parent)), encodeField(2, encodeField(2, text(displayName))))
}

export function buildKeyDisplayName(hostname: string) {
  const label = hostname
    .split(".")[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
  return /[a-z0-9]/.test(label) ? `opencode-${label}` : "opencode-cli"
}

async function exchangeCode(fetchFn: FetchFn, code: string, verifier: string) {
  const response = await fetchFn(`${COGNITO_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildTokenRequestBody(code, verifier),
  })
  if (!response.ok) throw new Error(`Fireworks token exchange failed: ${response.status}`)
  const data = (await response.json()) as { id_token?: string }
  if (!data.id_token) throw new Error("Fireworks token exchange did not return an id_token")
  return data.id_token
}

async function gateway(fetchFn: FetchFn, idToken: string, method: string, message: Uint8Array) {
  const response = await fetchFn(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/grpc-web+proto",
      "X-Grpc-Web": "1",
      authorization: `bearer ${idToken}`,
    },
    body: encodeGrpcWebFrame(message),
  })
  if (!response.ok) throw new Error(`Fireworks ${method} failed: ${response.status}`)
  const status = response.headers.get("grpc-status")
  if (status && status !== "0") throw new Error(`Fireworks ${method} failed with grpc-status ${status}`)
  const frames = decodeGrpcWebFrames(new Uint8Array(await response.arrayBuffer()))
  const trailer = frames.trailers["grpc-status"]
  if (trailer && trailer !== "0") throw new Error(`Fireworks ${method} failed with grpc-status ${trailer}`)
  const reply = frames.messages[0]
  if (!reply) throw new Error(`Fireworks ${method} returned no message`)
  return reply
}

async function mintApiKey(fetchFn: FetchFn, idToken: string, hostname: string) {
  const accounts = parseResourceNames(await gateway(fetchFn, idToken, "ListAccounts", new Uint8Array()))
  const account = accounts[0]
  if (!account) throw new Error("No Fireworks account found for this login")
  const email = extractEmail(idToken)
  const users = parseResourceNames(await gateway(fetchFn, idToken, "ListUsers", encodeListUsersRequest(account, email)))
  if (users.length === 0) {
    throw new Error(email ? `No Fireworks user found for ${email}` : "No Fireworks user found for this login")
  }
  if (!email && users.length > 1) {
    throw new Error("Multiple Fireworks users found and the login token has no email to select one")
  }
  const reply = await gateway(
    fetchFn,
    idToken,
    "CreateApiKey",
    encodeCreateApiKeyRequest(users[0], buildKeyDisplayName(hostname)),
  )
  const key = readString(reply, 3)
  if (!key) throw new Error("Fireworks did not return an API key")
  return key
}

async function verifyApiKey(fetchFn: FetchFn, key: string) {
  const response = await fetchFn(VERIFY_URL, { headers: { Authorization: `Bearer ${key}` } })
  if (response.ok) return
  if (response.status === 401 || response.status === 403) throw new Error("Fireworks rejected the minted API key")
  throw new Error(`Fireworks API key verification failed: ${response.status}`)
}

function startCallbackServer(state: string, timeoutMs: number) {
  let settled = false
  let resolveDone: (code: string) => void = () => undefined
  let rejectDone: (error: Error) => void = () => undefined
  const done = new Promise<string>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  // The promise is always awaited (or already settled) by callback(); an early
  // rejection must not surface as an unhandled rejection before then.
  done.catch(() => undefined)

  const finish = (code: string) => {
    if (settled) return
    settled = true
    resolveDone(code)
  }
  const fail = (message: string) => {
    if (settled) return
    settled = true
    rejectDone(new Error(message))
  }

  // "Connection: close" keeps server.close() from waiting on keep-alive sockets
  // held open by browser or fetch connection pools.
  const html = { "Content-Type": "text/html; charset=utf-8", Connection: "close" }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${OAUTH_PORT}`)
    if (url.pathname !== "/") {
      res.writeHead(404, { Connection: "close" })
      res.end("Not found")
      return
    }
    const error = url.searchParams.get("error")
    if (error) {
      const message =
        error === "access_denied" ? "Fireworks sign-in was cancelled" : `Fireworks sign-in failed: ${error}`
      res.writeHead(200, html)
      res.end(OauthCallbackPage.error(message, { provider: "Fireworks" }))
      fail(message)
      return
    }
    const code = url.searchParams.get("code")
    if (!code) {
      res.writeHead(400, html)
      res.end(OauthCallbackPage.error("Missing authorization code", { provider: "Fireworks" }))
      fail("Fireworks callback is missing the authorization code")
      return
    }
    if (url.searchParams.get("state") !== state) {
      res.writeHead(400, html)
      res.end(OauthCallbackPage.error("Invalid state", { provider: "Fireworks" }))
      fail("Fireworks callback state mismatch")
      return
    }
    res.writeHead(200, html)
    res.end(OauthCallbackPage.success({ provider: "Fireworks" }))
    finish(code)
  })

  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(OAUTH_PORT, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const timeout = setTimeout(() => fail("Fireworks login timed out"), timeoutMs)
  timeout.unref()

  const close = async () => {
    clearTimeout(timeout)
    server.closeIdleConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  return { ready, done, close }
}

export function createFireworksAuthHooks(deps: FireworksAuthDeps = {}): Hooks {
  const fetchFn = deps.fetchFn ?? fetch
  const openUrl = deps.openUrl ?? ((url: string) => open(url))
  const hostname = deps.hostname ?? os.hostname()
  const timeoutMs = deps.timeoutMs ?? OAUTH_TIMEOUT_MS

  return {
    auth: {
      provider: PROVIDER,
      methods: [
        {
          type: "oauth",
          label: "Log in with Fireworks Connect",
          async authorize(): Promise<AuthOAuthResult> {
            const pkce = await generatePkce()
            const state = generateState()
            const server = startCallbackServer(state, timeoutMs)
            await server.ready.catch(async (error: unknown) => {
              await server.close()
              throw error
            })
            const url = buildAuthorizeUrl(state, pkce.challenge)
            await openUrl(url).catch(() => undefined)
            return {
              url,
              instructions: "Complete sign-in in your browser. This window will close automatically.",
              method: "auto",
              async callback() {
                try {
                  const code = await server.done
                  const idToken = await exchangeCode(fetchFn, code, pkce.verifier)
                  const key = await mintApiKey(fetchFn, idToken, hostname)
                  await verifyApiKey(fetchFn, key)
                  return { type: "success" as const, key, provider: PROVIDER }
                } catch {
                  return { type: "failed" as const }
                } finally {
                  await server.close()
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "Manually enter a Fireworks API key",
        },
      ],
    },
  }
}

export async function FireworksAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return createFireworksAuthHooks()
}
