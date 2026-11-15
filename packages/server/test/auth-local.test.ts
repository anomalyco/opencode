import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

const basic = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`

const start = Effect.fnUntraced(function* (options: {
  readonly local: boolean
  readonly directory: string
}) {
  return yield* ServerProcess.start<never, never>({
    hostname: "127.0.0.1",
    port: 0,
    password: "secret",
    auth: options.local ? { local: true } : undefined,
    app: { version: "test-version" },
    database: { path: ":memory:" },
    config: { directory: options.directory },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
})

it.live("local accounts gate the server and the shared password stops authorizing", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-auth-local-")))
    const server = yield* start({ local: true, directory: tmp.path })
    const base = HttpServer.formatAddress(server.address)
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      Effect.promise(() =>
        fetch(new URL(path, base), {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
      )

    // Unauthenticated requests stay out, and the 401 says what sign-ins the server accepts.
    const anonymous = yield* Effect.promise(() => fetch(new URL("/api/info", base)))
    expect(anonymous.status).toBe(401)
    const refused = (yield* Effect.promise(() => anonymous.json())) as { methods?: string[] }
    expect(refused.methods).toEqual(["local"])

    // The shared password no longer grants anything.
    const withPassword = yield* Effect.promise(() =>
      fetch(new URL("/api/info", base), { headers: { authorization: basic("opencode", "secret") } }),
    )
    expect(withPassword.status).toBe(401)

    // Registration is open and signs the new account in; the token is a database session.
    const register = yield* post("/api/experimental/auth/register", { username: "ada", password: "s3cure-passw" })
    expect(register.status).toBe(200)
    const registered = (yield* Effect.promise(() => register.json())) as { token: string }
    expect(registered.token).toMatch(/^v2\./)

    const withToken = yield* Effect.promise(() =>
      fetch(new URL("/api/info", base), { headers: { authorization: basic("opencode", registered.token) } }),
    )
    expect(withToken.status).toBe(200)

    // The register response's cookie also authorizes.
    const cookie = (register.headers.get("set-cookie") ?? "").split(";")[0]
    expect(cookie).toMatch(/^opencode_session_\d+=v2\./)
    const withCookie = yield* Effect.promise(() =>
      fetch(new URL("/api/info", base), { headers: { cookie } }),
    )
    expect(withCookie.status).toBe(200)

    // Signing in again works; wrong credentials report the same 401 for unknown and wrong alike, and
    // advertise the local sign-in the shared password form should switch to.
    const login = yield* post("/api/experimental/auth/login", { username: "ada", password: "s3cure-passw" })
    expect(login.status).toBe(200)
    const badLogin = yield* post("/api/experimental/auth/login", { username: "ada", password: "wrong-passw" })
    expect(badLogin.status).toBe(401)
    expect(yield* Effect.promise(() => badLogin.json())).toMatchObject({ methods: ["local"] })

    // Usernames are taken once registered, and weak passwords are rejected up front.
    const taken = yield* post("/api/experimental/auth/register", { username: "ada", password: "s3cure-passw" })
    expect(taken.status).toBe(409)
    const weak = yield* post("/api/experimental/auth/register", { username: "grace", password: "short" })
    expect(weak.status).toBe(400)

    // Pairing still works in local mode: the redeemed link is a possession-only database session.
    const pair = yield* Effect.promise(() =>
      fetch(new URL("/api/pair", base), {
        method: "POST",
        headers: { authorization: basic("opencode", registered.token) },
      }),
    )
    expect(pair.status).toBe(200)
    const { code } = (yield* Effect.promise(() => pair.json())) as { code: string }
    const connect = yield* Effect.promise(() =>
      fetch(new URL(`/auth/connect/${code}`, base), { headers: { accept: "application/json" } }),
    )
    expect(connect.status).toBe(200)
    const pairingSession = (yield* Effect.promise(() => connect.json())) as { token: string }
    expect(pairingSession.token).toMatch(/^v2\./)
    const withPairing = yield* Effect.promise(() =>
      fetch(new URL("/api/info", base), { headers: { authorization: basic("opencode", pairingSession.token) } }),
    )
    expect(withPairing.status).toBe(200)
  }),
)

it.live("servers without local accounts keep the shared password and refuse the auth endpoints", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-auth-password-")))
    const server = yield* start({ local: false, directory: tmp.path })
    const base = HttpServer.formatAddress(server.address)
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      Effect.promise(() =>
        fetch(new URL(path, base), {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
      )

    const anonymous = yield* Effect.promise(() => fetch(new URL("/api/info", base)))
    expect(anonymous.status).toBe(401)
    const refused = (yield* Effect.promise(() => anonymous.json())) as { methods?: string[] }
    expect(refused.methods).toEqual(["password"])

    const withPassword = yield* Effect.promise(() =>
      fetch(new URL("/api/info", base), { headers: { authorization: basic("opencode", "secret") } }),
    )
    expect(withPassword.status).toBe(200)
    const info = (yield* Effect.promise(() => withPassword.json())) as {
      capabilities?: { auth?: { methods?: string[] } }
    }
    expect(info.capabilities?.auth?.methods).toEqual(["password"])

    const register = yield* post("/api/experimental/auth/register", { username: "ada", password: "s3cure-passw" })
    expect(register.status).toBe(503)
    const login = yield* post("/api/experimental/auth/login", { username: "ada", password: "s3cure-passw" })
    expect(login.status).toBe(503)

    // Shared-password access has no account, so its sessions record no creator.
    const created = yield* post("/api/session", {}, { authorization: basic("opencode", "secret") })
    expect(created.status).toBe(200)
    const made = (yield* Effect.promise(() => created.json())) as { data: { createdBy?: string } }
    expect(made.data.createdBy).toBeUndefined()
  }),
)

it.live("sessions record the local account that created them", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-auth-created-by-")))
    const server = yield* start({ local: true, directory: tmp.path })
    const base = HttpServer.formatAddress(server.address)
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      Effect.promise(() =>
        fetch(new URL(path, base), {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
      )
    const register = Effect.fnUntraced(function* (username: string) {
      const response = yield* post("/api/experimental/auth/register", { username, password: "s3cure-passw" })
      expect(response.status).toBe(200)
      return ((yield* Effect.promise(() => response.json())) as { token: string }).token
    })
    const createSession = Effect.fnUntraced(function* (token: string) {
      const response = yield* post("/api/session", {}, { authorization: basic("opencode", token) })
      expect(response.status).toBe(200)
      return ((yield* Effect.promise(() => response.json())) as { data: { createdBy?: string } }).data.createdBy
    })

    // Each account signs its own sessions, so two accounts never share a creator.
    const adaToken = yield* register("ada")
    const ada = yield* createSession(adaToken)
    const grace = yield* createSession(yield* register("grace"))
    expect(ada).toMatch(/^usr_/)
    expect(grace).toMatch(/^usr_/)
    expect(grace).not.toBe(ada)

    // A pairing token is a database session without an account, so its sessions record no creator.
    const pair = yield* Effect.promise(() =>
      fetch(new URL("/api/pair", base), { method: "POST", headers: { authorization: basic("opencode", adaToken) } }),
    )
    expect(pair.status).toBe(200)
    const { code } = (yield* Effect.promise(() => pair.json())) as { code: string }
    const connect = yield* Effect.promise(() =>
      fetch(new URL(`/auth/connect/${code}`, base), { headers: { accept: "application/json" } }),
    )
    expect(connect.status).toBe(200)
    const pairing = ((yield* Effect.promise(() => connect.json())) as { token: string }).token
    expect(yield* createSession(pairing)).toBeUndefined()
  }),
)
