import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  FireworksAuthPlugin,
  buildAuthorizeUrl,
  buildKeyDisplayName,
  buildTokenRequestBody,
  createFireworksAuthHooks,
  decodeGrpcWebFrames,
  encodeCreateApiKeyRequest,
  encodeField,
  encodeGrpcWebFrame,
  encodeListUsersRequest,
  encodeVarint,
  extractEmail,
  generatePkce,
  generateState,
  parseResourceNames,
  readFields,
  readString,
} from "../../src/plugin/fireworks"

const CLIENT_ID = "sueas7prsfrdp16nantbeqcjv"
const AUTHORIZE_URL = "https://fireworks.auth.us-west-2.amazoncognito.com/oauth2/authorize"
const TOKEN_URL = "https://fireworks.auth.us-west-2.amazoncognito.com/oauth2/token"
const GATEWAY_URL = "https://gateway.fireworks.ai/web/gateway.Gateway"
const VERIFY_URL = "https://api.fireworks.ai/verifyApiKey"
const CALLBACK_URL = "http://127.0.0.1:18000"

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

function jwt(payload: Record<string, unknown>) {
  return ["eyJhbGciOiJSUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".")
}

function grpcResponse(message: Uint8Array, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(encodeGrpcWebFrame(message), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/grpc-web+proto", "grpc-status": "0", ...init?.headers },
  })
}

type FetchCall = { url: string; init?: RequestInit }

function fireworksFetch(options: {
  email?: string | null
  accounts?: string[]
  users?: string[]
  verifyStatus?: number
  calls?: FetchCall[]
}) {
  const email = options.email === undefined ? "dev@example.com" : options.email
  const accounts = options.accounts ?? ["accounts/acct-1"]
  const users = options.users ?? ["accounts/acct-1/users/user-1"]
  const calls = options.calls ?? []
  const payload: Record<string, unknown> = { sub: "user-1" }
  if (email) payload.email = email
  const idToken = jwt(payload)
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    if (url === TOKEN_URL) {
      return Response.json({ id_token: idToken, access_token: "access-token", token_type: "Bearer" })
    }
    if (url === `${GATEWAY_URL}/ListAccounts`) {
      return grpcResponse(concat(...accounts.map((account) => encodeField(1, encodeField(1, text(account))))))
    }
    if (url === `${GATEWAY_URL}/ListUsers`) {
      return grpcResponse(concat(...users.map((user) => encodeField(1, encodeField(1, text(user))))))
    }
    if (url === `${GATEWAY_URL}/CreateApiKey`) {
      return grpcResponse(concat(encodeField(1, text("key-id-1")), encodeField(3, text("fw_test_key"))))
    }
    if (url === VERIFY_URL) return new Response(null, { status: options.verifyStatus ?? 200 })
    return new Response("unexpected request", { status: 500 })
  }
  return { fn: fn as unknown as typeof fetch, calls, idToken }
}

function oauthMethod(hooks: Awaited<ReturnType<typeof FireworksAuthPlugin>>) {
  const method = hooks.auth?.methods.find((method) => method.type === "oauth")
  if (!method || method.type !== "oauth") throw new Error("Fireworks OAuth method is missing")
  return method
}

async function startLogin(fetchFn: typeof fetch) {
  const hooks = createFireworksAuthHooks({
    fetchFn,
    openUrl: async () => undefined,
    hostname: "Test-Host",
  })
  const authorization = await oauthMethod(hooks).authorize()
  if (authorization.method !== "auto") throw new Error("Unexpected Fireworks authorization method")
  const state = new URL(authorization.url).searchParams.get("state")
  if (!state) throw new Error("Fireworks authorize URL is missing state")
  return { authorization, state }
}

function requestBody(call: FetchCall) {
  const body = call.init?.body
  if (!(body instanceof Uint8Array)) throw new Error(`Expected a binary request body for ${call.url}`)
  return decodeGrpcWebFrames(body).messages[0]
}

describe("plugin.fireworks", () => {
  test("exposes the fireworks-ai provider with browser and api-key methods", async () => {
    const hooks = await FireworksAuthPlugin({} as PluginInput)

    expect(hooks.auth?.provider).toBe("fireworks-ai")
    expect(hooks.auth?.methods.map((method) => [method.type, method.label])).toEqual([
      ["oauth", "Log in with Fireworks Connect"],
      ["api", "Manually enter a Fireworks API key"],
    ])
  })

  test("generates a PKCE verifier and S256 challenge", async () => {
    const pkce = await generatePkce()

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const digest = await crypto.subtle.digest("SHA-256", text(pkce.verifier))
    expect(pkce.challenge).toBe(Buffer.from(digest).toString("base64url"))
    expect(await generatePkce()).not.toEqual(pkce)
  })

  test("generates URL-safe state", () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(generateState()).not.toBe(generateState())
  })

  test("builds the Cognito authorize URL without a scope parameter", () => {
    expect(buildAuthorizeUrl("test-state", "test-challenge")).toBe(
      `${AUTHORIZE_URL}?client_id=${CLIENT_ID}&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A18000&state=test-state&code_challenge_method=S256&code_challenge=test-challenge`,
    )
  })

  test("builds the token exchange body", () => {
    const params = new URLSearchParams(buildTokenRequestBody("the-code", "the-verifier"))

    expect(params.get("grant_type")).toBe("authorization_code")
    expect(params.get("client_id")).toBe(CLIENT_ID)
    expect(params.get("code")).toBe("the-code")
    expect(params.get("redirect_uri")).toBe("http://localhost:18000")
    expect(params.get("code_verifier")).toBe("the-verifier")
    expect([...params.keys()]).toEqual(["grant_type", "client_id", "code", "redirect_uri", "code_verifier"])
  })

  test("extracts the email claim from a JWT payload", () => {
    expect(extractEmail(jwt({ email: "dev@example.com", sub: "user-1" }))).toBe("dev@example.com")
    expect(extractEmail(jwt({ sub: "user-1" }))).toBeUndefined()
    expect(extractEmail("not-a-jwt")).toBeUndefined()
    expect(extractEmail("a.@@.c")).toBeUndefined()
  })

  test("encodes unsigned varints", () => {
    expect([...encodeVarint(0)]).toEqual([0])
    expect([...encodeVarint(127)]).toEqual([0x7f])
    expect([...encodeVarint(128)]).toEqual([0x80, 0x01])
    expect([...encodeVarint(300)]).toEqual([0xac, 0x02])
  })

  test("encodes length-delimited protobuf fields", () => {
    expect([...encodeField(1, text("ab"))]).toEqual([0x0a, 0x02, 0x61, 0x62])
    expect([...encodeField(4, text("x"))]).toEqual([0x22, 0x01, 0x78])
  })

  test("round-trips gRPC-web frames", () => {
    const frames = decodeGrpcWebFrames(
      concat(
        encodeGrpcWebFrame(text("first")),
        encodeGrpcWebFrame(text("second")),
        concat(new Uint8Array([0x80, 0, 0, 0, 15]), text("grpc-status:0\r\n")),
      ),
    )

    expect(frames.messages.map((message) => Buffer.from(message).toString())).toEqual(["first", "second"])
    expect(frames.trailers["grpc-status"]).toBe("0")
  })

  test("parses repeated resource names from a gateway response", () => {
    const message = concat(
      encodeField(1, encodeField(1, text("accounts/a1"))),
      encodeField(1, encodeField(1, text("accounts/a2"))),
    )

    expect(parseResourceNames(message)).toEqual(["accounts/a1", "accounts/a2"])
  })

  test("reads strings and sub-messages from protobuf messages", () => {
    const message = concat(encodeField(1, text("parent")), encodeField(2, encodeField(2, text("nested"))))
    const sub = readFields(message).find((field) => field.field === 2)

    expect(readString(message, 1)).toBe("parent")
    expect(readString(message, 9)).toBeUndefined()
    expect(sub?.wire).toBe(2)
    expect(readString(sub?.value as Uint8Array, 2)).toBe("nested")
  })

  test("encodes ListUsers requests with and without an email filter", () => {
    const filtered = encodeListUsersRequest("accounts/a1", "dev@example.com")
    const unfiltered = encodeListUsersRequest("accounts/a1")

    expect(readString(filtered, 1)).toBe("accounts/a1")
    expect(readString(filtered, 4)).toBe('email="dev@example.com"')
    expect(readString(unfiltered, 1)).toBe("accounts/a1")
    expect(readString(unfiltered, 4)).toBeUndefined()
  })

  test("encodes CreateApiKey requests with a nested display name", () => {
    const message = encodeCreateApiKeyRequest("accounts/a1/users/u1", "opencode-cli")
    const sub = readFields(message).find((field) => field.field === 2)

    expect(readString(message, 1)).toBe("accounts/a1/users/u1")
    expect(readString(sub?.value as Uint8Array, 2)).toBe("opencode-cli")
  })

  test("builds API key display names from the hostname", () => {
    expect(buildKeyDisplayName("Darrens-MacBook-Pro.local")).toBe("opencode-darrens-macbook-pro")
    expect(buildKeyDisplayName("weird_host")).toBe("opencode-weird-host")
    expect(buildKeyDisplayName("!!!")).toBe("opencode-cli")
    expect(buildKeyDisplayName("")).toBe("opencode-cli")
  })

  test("completes the browser login flow and stores the minted API key", async () => {
    const calls: FetchCall[] = []
    const { fn, idToken } = fireworksFetch({ calls })
    const { authorization, state } = await startLogin(fn)

    const url = new URL(authorization.url)
    expect(url.origin + url.pathname).toBe(AUTHORIZE_URL)
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:18000")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBeTruthy()
    expect(url.searchParams.has("scope")).toBe(false)
    expect(authorization.instructions).toContain("browser")

    expect((await fetch(`${CALLBACK_URL}/favicon.ico`)).status).toBe(404)
    const page = await fetch(`${CALLBACK_URL}/?code=test-code&state=${state}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("Authorization successful")

    expect(await authorization.callback()).toEqual({
      type: "success",
      key: "fw_test_key",
      provider: "fireworks-ai",
    })

    const token = calls.find((call) => call.url === TOKEN_URL)
    const body = new URLSearchParams(String(token?.init?.body))
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("client_id")).toBe(CLIENT_ID)
    expect(body.get("code")).toBe("test-code")
    expect(body.get("redirect_uri")).toBe("http://localhost:18000")
    const verifier = body.get("code_verifier") ?? ""
    const digest = await crypto.subtle.digest("SHA-256", text(verifier))
    expect(url.searchParams.get("code_challenge")).toBe(Buffer.from(digest).toString("base64url"))

    const listAccounts = calls.find((call) => call.url === `${GATEWAY_URL}/ListAccounts`)
    expect(requestBody(listAccounts!).length).toBe(0)
    const listUsers = calls.find((call) => call.url === `${GATEWAY_URL}/ListUsers`)
    expect(readString(requestBody(listUsers!), 1)).toBe("accounts/acct-1")
    expect(readString(requestBody(listUsers!), 4)).toBe('email="dev@example.com"')
    const createKey = calls.find((call) => call.url === `${GATEWAY_URL}/CreateApiKey`)
    const createBody = requestBody(createKey!)
    expect(readString(createBody, 1)).toBe("accounts/acct-1/users/user-1")
    const keyMessage = readFields(createBody).find((field) => field.field === 2)
    expect(readString(keyMessage?.value as Uint8Array, 2)).toBe("opencode-test-host")

    for (const call of [listAccounts, listUsers, createKey]) {
      const headers = new Headers(call?.init?.headers)
      expect(headers.get("content-type")).toBe("application/grpc-web+proto")
      expect(headers.get("x-grpc-web")).toBe("1")
      expect(headers.get("authorization")).toBe(`bearer ${idToken}`)
    }

    const verify = calls.find((call) => call.url === VERIFY_URL)
    expect(new Headers(verify?.init?.headers).get("authorization")).toBe("Bearer fw_test_key")
  })

  test("uses the first account when several exist", async () => {
    const calls: FetchCall[] = []
    const { fn } = fireworksFetch({ accounts: ["accounts/first", "accounts/second"], calls })
    const { authorization, state } = await startLogin(fn)

    await fetch(`${CALLBACK_URL}/?code=test-code&state=${state}`)

    expect((await authorization.callback()).type).toBe("success")
    const listUsers = calls.find((call) => call.url.endsWith("/ListUsers"))
    expect(readString(requestBody(listUsers!), 1)).toBe("accounts/first")
  })

  test("fails when the user denies access", async () => {
    const { fn } = fireworksFetch({})
    const { authorization, state } = await startLogin(fn)

    const page = await fetch(`${CALLBACK_URL}/?error=access_denied&state=${state}`)
    expect(page.status).toBe(200)

    expect(await authorization.callback()).toEqual({ type: "failed" })
  })

  test("fails when the callback state does not match", async () => {
    const { fn } = fireworksFetch({})
    const { authorization } = await startLogin(fn)

    const page = await fetch(`${CALLBACK_URL}/?code=test-code&state=forged-state`)
    expect(page.status).toBe(400)

    expect(await authorization.callback()).toEqual({ type: "failed" })
  })

  test("fails when no user matches and no email is available", async () => {
    const calls: FetchCall[] = []
    const { fn } = fireworksFetch({ email: null, users: ["accounts/acct-1/users/u1", "accounts/acct-1/users/u2"], calls })
    const { authorization, state } = await startLogin(fn)

    await fetch(`${CALLBACK_URL}/?code=test-code&state=${state}`)

    expect(await authorization.callback()).toEqual({ type: "failed" })
    const listUsers = calls.find((call) => call.url.endsWith("/ListUsers"))
    expect(readString(requestBody(listUsers!), 4)).toBeUndefined()
  })

  test("fails when the token response has no id_token", async () => {
    const fn = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url === TOKEN_URL) return Response.json({ access_token: "access-token" })
      return new Response("unexpected request", { status: 500 })
    }) as typeof fetch
    const { authorization, state } = await startLogin(fn)

    await fetch(`${CALLBACK_URL}/?code=test-code&state=${state}`)

    expect(await authorization.callback()).toEqual({ type: "failed" })
  })

  test("fails when Fireworks rejects the minted key", async () => {
    const { fn } = fireworksFetch({ verifyStatus: 401 })
    const { authorization, state } = await startLogin(fn)

    await fetch(`${CALLBACK_URL}/?code=test-code&state=${state}`)

    expect(await authorization.callback()).toEqual({ type: "failed" })
  })

  test("fails when the browser never completes the login", async () => {
    const hooks = createFireworksAuthHooks({
      fetchFn: fireworksFetch({}).fn,
      openUrl: async () => undefined,
      hostname: "Test-Host",
      timeoutMs: 50,
    })
    const authorization = await oauthMethod(hooks).authorize()
    if (authorization.method !== "auto") throw new Error("Unexpected Fireworks authorization method")

    expect(await authorization.callback()).toEqual({ type: "failed" })
  })

  test("surfaces non-zero grpc statuses", async () => {
    const fn = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url === TOKEN_URL) return Response.json({ id_token: jwt({ email: "dev@example.com" }) })
      if (url.endsWith("/ListAccounts")) {
        return new Response(encodeGrpcWebFrame(new Uint8Array()), {
          status: 200,
          headers: { "grpc-status": "7", "grpc-message": "permission%20denied" },
        })
      }
      return new Response("unexpected request", { status: 500 })
    }) as typeof fetch
    const { authorization, state } = await startLogin(fn)

    await fetch(`${CALLBACK_URL}/?code=test-code&state=${state}`)

    expect(await authorization.callback()).toEqual({ type: "failed" })
  })
})
