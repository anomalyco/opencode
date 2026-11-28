import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import FastCheck from "fast-check"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Integration } from "@opencode/core/integration"
import { McpPool } from "@opencode/core/mcp/pool"
import { isRecord } from "@opencode/util/record"
import { Effect, Layer } from "effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { serve } from "./fixture/http"
import { DIRECTORIES, remote, stdio, until, world } from "./harness"

const it = testEffect(Layer.empty)

describe("MCP pool keys", () => {
  // Writing the same server another way: defaults spelled out or left out, keys in another order, and the fields that
  // decide only whether a connection opens. Config files fill `timeout`; `mcp.add` does not.
  const remotes = FastCheck.record({
    url: FastCheck.constantFrom("https://mcp.example.com/mcp", "http://127.0.0.1:1/mcp?x=1"),
    headers: FastCheck.option(FastCheck.dictionary(FastCheck.constantFrom("a", "b"), FastCheck.string()), {
      nil: undefined,
    }),
    oauth: FastCheck.option(
      FastCheck.oneof(
        FastCheck.constant(false as const),
        FastCheck.record({ client_id: FastCheck.string(), scope: FastCheck.string() }, { requiredKeys: [] }),
      ),
      { nil: undefined },
    ),
    timeout: FastCheck.option(
      FastCheck.record({ startup: FastCheck.nat(), catalog: FastCheck.nat() }, { requiredKeys: [] }),
      { nil: undefined },
    ),
    protocol: FastCheck.constantFrom(undefined, "auto" as const, "legacy" as const, "2026-07-28" as const),
    codemode: FastCheck.constantFrom(undefined, true, false),
  })
  const spelled = (config: Record<string, unknown>, extra: { disabled?: boolean; pool?: boolean; order: boolean }) => {
    const filled = {
      type: "remote",
      ...config,
      timeout: config.timeout ?? {},
      protocol: config.protocol ?? "auto",
      codemode: config.codemode ?? true,
      headers: config.headers ?? {},
      oauth: config.oauth ?? {},
      disabled: extra.disabled,
      pool: extra.pool,
    }
    const entries = Object.entries(filled).map(([key, value]): [string, unknown] => [
      key,
      isRecord(value)
        ? Object.fromEntries(extra.order ? Object.entries(value).toReversed() : Object.entries(value))
        : value,
    ])
    return Object.fromEntries(extra.order ? entries.toReversed() : entries) as unknown as ConfigMCP.Remote
  }
  const key = (config: ConfigMCP.Remote, input: { credential?: string; skills?: boolean } = {}) =>
    McpPool.key({ config, credential: input.credential, skills: input.skills })

  test("are equal for equivalent remote configs and differ when a connection would behave differently", () =>
    FastCheck.assert(
      FastCheck.property(
        remotes,
        FastCheck.record({ disabled: FastCheck.boolean(), pool: FastCheck.boolean(), order: FastCheck.boolean() }),
        (config, extra) => {
          const plain = { type: "remote", ...config } as ConfigMCP.Remote
          expect(key(spelled(config, extra))).toBe(key(plain))
          expect(key(plain)).not.toContain("hunter2")
          for (const changed of [
            { ...plain, url: plain.url + "/other" },
            { ...plain, headers: { ...plain.headers, a: "hunter2" + String(plain.headers?.a) } },
            { ...plain, codemode: plain.codemode === false },
            { ...plain, oauth: plain.oauth === false ? undefined : false },
            { ...plain, protocol: plain.protocol === "legacy" ? "auto" : "legacy" },
          ] as ConfigMCP.Remote[])
            expect(key(changed)).not.toBe(key(plain))
          expect(key(plain, { credential: "cred_a" })).not.toBe(key(plain))
          expect(key(plain, { skills: true })).not.toBe(key(plain))
        },
      ),
    ))

  test("are equal for equivalent local configs and differ by command, directory and environment", () => {
    const local = (fields: Partial<ConfigMCP.Local>, cwd = "/a") =>
      McpPool.key({ config: { type: "local", command: ["server"], ...fields }, cwd })
    expect(local({ environment: {}, timeout: {}, protocol: "auto", codemode: false, disabled: true })).toBe(local({}))
    expect(local({ environment: { TOKEN: "hunter2" } })).not.toContain("hunter2")
    for (const changed of [
      local({ command: ["server", "--other"] }),
      local({}, "/b"),
      local({ environment: { TOKEN: "x" } }),
    ])
      expect(changed).not.toBe(local({}))
  })
})

describe("MCP pool", () => {
  it.live("shares one connection among Locations that configure a server alike, however they configure it", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const places = yield* world
      const config = remote(server.url, { pool: true })
      // One from a config file, which fills in the timeout defaults, one added at runtime.
      const a = yield* places.open({ directory: DIRECTORIES[0], servers: { fixture: config } })
      const b = yield* places.open({ directory: DIRECTORIES[1] })
      yield* b.mcp.add("fixture", { type: "remote", url: server.url, oauth: false, pool: true })
      for (const place of [a, b]) expect(yield* place.settled("fixture")).toEqual({ status: "connected" })
      expect(server.seen.lists).toBe(1)

      // A Location that reconnects joins the open connection, and gets its catalogs announced again.
      yield* b.mcp.disconnect("fixture")
      yield* until("the prompt command to go", b.commands.get("fixture:greet"), (command) => command === undefined)
      expect(yield* a.mcp.callTool({ server: "fixture", name: "echo" })).toMatchObject({ isError: false })
      yield* b.mcp.connect("fixture")
      yield* until("the prompt command", b.commands.get("fixture:greet"), Boolean)
      expect(server.seen.lists).toBe(1)

      // The last Location to let go closes it; the next one opens a new one.
      yield* a.close
      yield* b.mcp.callTool({ server: "fixture", name: "echo" })
      yield* b.close
      const c = yield* places.open({ directory: DIRECTORIES[0], servers: { fixture: config } })
      expect(yield* c.settled("fixture")).toEqual({ status: "connected" })
      expect(server.seen.lists).toBe(2)
    }),
  )

  it.live("connects each Location on its own when the server refuses the shared connection", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      // Like a server that needs a root: it refuses a client that declares none, as a shared connection does.
      server.intercept((_, body) => {
        const meta = isRecord(body?.params) && isRecord(body.params._meta) ? body.params._meta : undefined
        const capabilities = meta?.["io.modelcontextprotocol/clientCapabilities"]
        if (body?.method !== "server/discover" || (isRecord(capabilities) && capabilities.roots)) return undefined
        return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "a root is required" } })
      })
      const places = yield* world
      const config = remote(server.url, { pool: true })
      for (const directory of DIRECTORIES) {
        const place = yield* places.open({ directory, servers: { fixture: config } })
        expect(yield* place.settled("fixture")).toEqual({ status: "connected" })
      }
      expect(server.seen.lists).toBe(2)
      // Only the first start tried to share; the refusal is remembered for the key.
      expect(server.seen.discovers).toBe(3)
    }),
  )

  it.live("signs every Location sharing a connection in and out together", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const token = { accepted: "good" }
      const sent: Array<string | null> = []
      server.intercept((request, body) => {
        if (body?.method === "tools/call") sent.push(request.headers.get("authorization"))
        return request.headers.get("authorization") === `Bearer ${token.accepted}`
          ? undefined
          : new Response(null, { status: 401 })
      })
      const places = yield* world
      const config = remote(server.url, { pool: true, oauth: undefined })
      const a = yield* places.open({ directory: DIRECTORIES[0], servers: { fixture: config } })
      const b = yield* places.open({ directory: DIRECTORIES[1], servers: { fixture: config } })
      for (const place of [a, b]) expect((yield* place.settled("fixture")).status).toBe("needs_auth")

      // Signing in reconnects every Location, and they share the connection the credential opened.
      const integrationID = (yield* a.mcp.servers())[0]?.integrationID ?? ""
      const signIn = (access: string) =>
        places.credentials.create({
          integrationID: Integration.ID.make(integrationID),
          value: {
            type: "oauth",
            methodID: Integration.MethodID.make("oauth"),
            access,
            refresh: "",
            expires: Date.now() + 3_600_000,
          },
        })
      yield* signIn("good")
      for (const place of [a, b])
        yield* until("sign-in", place.status("fixture"), (status) => status?.status === "connected")
      yield* b.mcp.callTool({ server: "fixture", name: "echo" })
      expect(sent).toEqual(["Bearer good"])
      expect(server.seen.lists).toBe(1)

      // A credential the server stops taking signs both out; a new sign-in brings both back.
      token.accepted = "better"
      yield* a.mcp.callTool({ server: "fixture", name: "echo" }).pipe(Effect.flip)
      for (const place of [a, b])
        yield* until("needs_auth", place.status("fixture"), (status) => status?.status === "needs_auth")
      yield* signIn("better")
      for (const place of [a, b])
        yield* until("sign-in", place.status("fixture"), (status) => status?.status === "connected")
      expect(yield* b.mcp.callTool({ server: "fixture", name: "echo" })).toMatchObject({ isError: false })
    }),
  )

  it.live(
    "shares a local process only with a fixed cwd, fails every holder when it dies, and stops it after the last",
    () =>
      Effect.gen(function* () {
        const tmp = (yield* tmpdirScoped()).path
        const pids = (file: string) =>
          Effect.promise(() => fs.readFile(path.join(tmp, file), "utf8").catch(() => "")).pipe(
            Effect.map((text) => text.trim().split("\n").filter(Boolean).map(Number)),
          )
        const alive = (pid: number) =>
          Effect.sync(() => {
            try {
              return process.kill(pid, 0)
            } catch {
              return false
            }
          })
        const places = yield* world
        const open = (config: ConfigMCP.Local, directory: string) =>
          places.open({ directory, servers: { fixture: config } }).pipe(Effect.tap((place) => place.settled("fixture")))

        // Without a cwd each directory runs its own.
        const loose = stdio({ era: "modern" }, { pool: true, pids: path.join(tmp, "loose") })
        for (const directory of DIRECTORIES) yield* (yield* open(loose, directory)).close
        expect(yield* pids("loose")).toHaveLength(2)

        const fixed = stdio({ era: "modern" }, { pool: true, pids: path.join(tmp, "fixed"), cwd: DIRECTORIES[0] })
        const a = yield* open(fixed, DIRECTORIES[0])
        const b = yield* open(fixed, DIRECTORIES[1])
        const [first] = yield* pids("fixed")
        expect(yield* pids("fixed")).toHaveLength(1)

        process.kill(first!, "SIGKILL")
        for (const place of [a, b])
          yield* until("failed", place.status("fixture"), (status) => status?.status === "failed")
        yield* a.mcp.connect("fixture")
        yield* b.mcp.connect("fixture")
        for (const place of [a, b]) expect(yield* place.status("fixture")).toEqual({ status: "connected" })
        const [, second] = yield* pids("fixed")
        expect(yield* pids("fixed")).toHaveLength(2)

        yield* a.close
        expect(yield* alive(second!)).toBe(true)
        yield* b.mcp.callTool({ server: "fixture", name: "echo" })
        yield* b.close
        yield* until("the process to stop", alive(second!), (running) => !running)
      }),
  )
})
