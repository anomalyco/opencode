import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { Server } from "../../src/server/server"
import { ServerAuth } from "../../src/server/auth"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { tmpdir } from "../fixture/fixture"

let issuer: ReturnType<typeof Bun.serve> | undefined

const auth = (issuerUrl: string) => ({
  mode: "oidc" as const,
  oidc: {
    issuer: issuerUrl,
    clientID: "opencode-test",
    allowedDomains: ["example.com"],
  },
  session: {
    secret: "test-session-secret-with-enough-entropy",
  },
})

beforeEach(() => {
  issuer = undefined
})

afterEach(async () => {
  issuer?.stop(true)
  delete process.env.OPENCODE_AUTH_MODE
  delete process.env.OPENCODE_OIDC_ISSUER
  delete process.env.OPENCODE_OIDC_CLIENT_ID
  delete process.env.OPENCODE_AUTH_SESSION_SECRET
})

async function createIssuer(input?: { nonce?: () => string | undefined }) {
  const keys = await generateKeyPair("RS256", { extractable: true })
  const publicKey = await exportJWK(keys.publicKey)
  publicKey.kid = "test-key"
  issuer = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          authorization_endpoint: `${issuer!.url.origin}/authorize`,
          token_endpoint: `${issuer!.url.origin}/token`,
          jwks_uri: `${issuer!.url.origin}/jwks`,
        })
      }
      if (url.pathname === "/jwks") return Response.json({ keys: [publicKey] })
      if (url.pathname === "/token") {
        return Response.json({
          id_token: await token({
            issuer: issuer!.url.origin,
            audience: "opencode-test",
            subject: "user-1",
            email: "dev@example.com",
            nonce: input?.nonce?.(),
            privateKey: keys.privateKey,
          }),
        })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return { issuer: issuer.url.origin, privateKey: keys.privateKey }
}

async function token(input: {
  issuer: string
  audience: string
  subject: string
  email: string
  nonce?: string
  privateKey: CryptoKey
}) {
  const jwt = new SignJWT({ email: input.email, email_verified: true, nonce: input.nonce })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime("5m")
  return await jwt.sign(input.privateKey)
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}

describe("OIDC server auth", () => {
  test("redirects browser requests to OIDC login", async () => {
    const testIssuer = await createIssuer()
    const server = await Server.listen({ hostname: "127.0.0.1", port: 0, auth: auth(testIssuer.issuer) })
    const response = await fetch(server.url, { headers: { accept: "text/html" }, redirect: "manual" }).finally(() =>
      server.stop(true),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toContain("/auth/login")
  })

  test("rejects invalid auth mode instead of disabling auth", () => {
    process.env.OPENCODE_AUTH_MODE = "oicd"

    expect(() => ServerAuth.fromConfig()).toThrow("invalid OPENCODE_AUTH_MODE: oicd")
  })

  test("returns 401 for unauthenticated API requests", async () => {
    const testIssuer = await createIssuer()
    const server = await Server.listen({ hostname: "127.0.0.1", port: 0, auth: auth(testIssuer.issuer) })
    const response = await fetch(new URL("/global/health", server.url), {
      headers: { accept: "application/json" },
    }).finally(() => server.stop(true))

    expect(response.status).toBe(401)
  })

  test("accepts bearer JWTs from the configured issuer", async () => {
    const testIssuer = await createIssuer()
    const server = await Server.listen({ hostname: "127.0.0.1", port: 0, auth: auth(testIssuer.issuer) })
    const response = await fetch(new URL("/global/health", server.url), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${await token({
          issuer: testIssuer.issuer,
          audience: "opencode-test",
          subject: "user-1",
          email: "dev@example.com",
          privateKey: testIssuer.privateKey,
        })}`,
      },
    }).finally(() => server.stop(true))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ healthy: true })
  })

  test("accepts OIDC bearer JWTs on protected Effect HttpApi routes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")
    const testIssuer = await createIssuer()
    process.env.OPENCODE_AUTH_MODE = "oidc"
    process.env.OPENCODE_OIDC_ISSUER = testIssuer.issuer
    process.env.OPENCODE_OIDC_CLIENT_ID = "opencode-test"
    process.env.OPENCODE_AUTH_SESSION_SECRET = "test-session-secret-with-enough-entropy"
    const server = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      const url = new URL(FilePaths.content, server.url)
      url.searchParams.set("path", "hello.txt")
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${await token({
            issuer: testIssuer.issuer,
            audience: "opencode-test",
            subject: "user-1",
            email: "dev@example.com",
            privateKey: testIssuer.privateKey,
          })}`,
          "x-opencode-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ content: "hello" })
    } finally {
      await server.stop(true)
    }
  })

  test("creates a browser session from the OIDC callback", async () => {
    let nonce: string | undefined
    const testIssuer = await createIssuer({ nonce: () => nonce })
    const server = await Server.listen({ hostname: "127.0.0.1", port: 0, auth: auth(testIssuer.issuer) })
    const login = await fetch(new URL("/auth/login?return_to=/global/health", server.url), { redirect: "manual" })
    const location = new URL(login.headers.get("location")!)
    nonce = location.searchParams.get("nonce") ?? undefined
    const callback = await fetch(
      new URL("/auth/callback?code=test-code&state=" + location.searchParams.get("state"), server.url),
      {
        headers: { cookie: cookies(login) },
        redirect: "manual",
      },
    )
    const session = await fetch(new URL("/global/health", server.url), {
      headers: {
        accept: "application/json",
        cookie: cookies(callback),
      },
    }).finally(() => server.stop(true))

    expect(callback.status).toBe(302)
    expect(callback.headers.get("location")).toBe("/global/health")
    expect(session.status).toBe(200)
  })

  test("returns 401 when the OIDC callback token is rejected", async () => {
    const testIssuer = await createIssuer({ nonce: () => "wrong-nonce" })
    const server = await Server.listen({ hostname: "127.0.0.1", port: 0, auth: auth(testIssuer.issuer) })
    const login = await fetch(new URL("/auth/login?return_to=/global/health", server.url), { redirect: "manual" })
    const location = new URL(login.headers.get("location")!)
    const callback = await fetch(
      new URL("/auth/callback?code=test-code&state=" + location.searchParams.get("state"), server.url),
      {
        headers: { cookie: cookies(login) },
      },
    ).finally(() => server.stop(true))

    expect(callback.status).toBe(401)
    expect(await callback.json()).toMatchObject({ error: "OIDC authentication failed" })
  })
})
