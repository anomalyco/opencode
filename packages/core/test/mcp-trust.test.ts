import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { createServer } from "node:net"
import { describe, expect, test } from "bun:test"
import { Document, Info } from "@opencode/schema/config"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Config } from "@opencode/core/config"
import { ConfigMcpPlugin } from "@opencode/core/config/plugin/mcp"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { ID, type Payload } from "@opencode/schema/event"
import { Form } from "@opencode/core/form"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { Mcp } from "@opencode/core/mcp/index"
import { McpTls } from "@opencode/core/mcp/tls"
import { McpTrustedHost } from "@opencode/core/mcp/trust"
import { AbsolutePath } from "@opencode/core/schema"
import { State } from "@opencode/core/state"
import { Cause, Effect, Exit, Layer, Schedule, Stream } from "effect"
import { registerIntegrationPolicy } from "./fixture/policy"
import { location } from "./fixture/location"
import { hostEnvironmentLayer } from "./fixture/environment"
import { CERT, CERT_ROTATED, KEY_ROTATED, startTlsMcpServer } from "./fixture/tls-server"

const FINGERPRINT = fingerprintOf(CERT)
const FINGERPRINT_ROTATED = fingerprintOf(CERT_ROTATED)

function fingerprintOf(cert: string) {
  return createHash("sha256").update(Buffer.from(cert.split("\n").slice(1, -1).join(""), "base64")).digest("hex")
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port
      probe.close(() => resolve(port))
    })
  })
}

const storeLayer = LayerNode.compile(LayerNode.group([McpTrustedHost.node, Database.node]))

const seedProject = Effect.fnUntraced(function* (id: Project.ID = Project.ID.global) {
  const db = (yield* Database.Service).db
  yield* db.run(
    `INSERT INTO project (id, worktree, time_created, time_updated, time_active, sandboxes) VALUES ('${id}', '/seed', 1, 1, 1, '[]')`,
  )
})

function trustMcpLayer(url: string) {
  const directory = AbsolutePath.make(import.meta.dir)
  const unusedIntegration = () => Effect.die("unused integration service")
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const mcp = yield* Mcp.Service
      yield* State.batch(
        Effect.gen(function* () {
          yield* ConfigMcpPlugin.register(bus.subscribe())
          yield* registerIntegrationPolicy({ mcp, events: bus.subscribe() })
        }),
      )
    }),
  ).pipe(
    Layer.provideMerge(Mcp.layer()),
    Layer.provideMerge(Form.layer),
    Layer.provideMerge(storeLayer),
    Layer.provide(
      Layer.mergeAll(
        Config.testLayer([
          new Document({
            type: "document",
            info: new Info({
              policies: [],
              mcp: new ConfigMCP.Info({
                servers: { appliance: new ConfigMCP.Remote({ type: "remote", url, oauth: false }) },
              }),
            }),
          }),
        ]),
        Layer.succeed(Location.Service, Location.Service.of(location({ directory }))),
        Layer.mock(Bus.Service, {
          subscribe: () => Stream.never,
          publish: (definition, data) => {
            const event = {
              id: ID.create(),
              type: definition.type,
              data,
            } as Payload<typeof definition>
            return Effect.succeed(event)
          },
        }),
        Layer.mock(Integration.Service, {
          revision: () => 0,
          connection: {
            active: unusedIntegration,
            resolve: unusedIntegration,
            key: unusedIntegration,
            external: unusedIntegration,
            activate: unusedIntegration,
            update: unusedIntegration,
            remove: unusedIntegration,
            status: unusedIntegration,
          },
          oauth: {
            connect: unusedIntegration,
            status: unusedIntegration,
            complete: unusedIntegration,
            cancel: unusedIntegration,
          },
          command: {
            connect: unusedIntegration,
            status: unusedIntegration,
            cancel: unusedIntegration,
          },
        }),
        Layer.mock(Credential.Service, {}),
        hostEnvironmentLayer,
      ),
    ),
  )
}

const settled = (service: Mcp.Interface, name = "appliance") =>
  Effect.gen(function* () {
    const status = (yield* service.servers()).find((server) => server.name === name)?.status
    if (status?.status === "pending") return yield* Effect.fail(status)
    return status
  }).pipe(Effect.retry({ times: 300, schedule: Schedule.spaced("10 millis") }))

const errorMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  if (!(error instanceof Error)) throw error
  return error.message
}

const failedError = (status: Mcp.Status | undefined, what: string) => {
  if (status?.status !== "failed") throw new Error(`expected failed status for ${what}, got ${JSON.stringify(status)}`)
  return status.error
}

const connected = (status: Mcp.Status | undefined, what: string) => {
  if (status?.status !== "connected")
    throw new Error(`expected connected status for ${what}, got ${JSON.stringify(status)}`)
}

describe("McpTls.privateHost", () => {
  const cases: Array<[string, string | undefined]> = [
    ["127.0.0.1", "127.0.0.1"],
    ["10.0.0.5", "10.0.0.5"],
    ["172.16.0.1", "172.16.0.1"],
    ["172.31.255.254", "172.31.255.254"],
    ["192.168.1.1", "192.168.1.1"],
    ["169.254.10.20", "169.254.10.20"],
    ["[::1]", "::1"],
    ["[fe80::1]", "fe80::1"],
    ["[fd12:3456::1]", "fd12:3456::1"],
    ["[FC00::1]", "FC00::1"],
    ["172.15.0.1", undefined],
    ["172.32.0.1", undefined],
    ["100.64.0.1", undefined],
    ["8.8.8.8", undefined],
    ["[::2]", undefined],
    ["[2001:db8::1]", undefined],
    ["[fe80::1%25eth0]", undefined],
    ["localhost", undefined],
    ["192.168.example", undefined],
    ["example.com", undefined],
  ]
  for (const [input, expected] of cases) {
    test(input, () => expect(McpTls.privateHost(input)).toBe(expected))
  }
})

describe("McpTls.probeCertificate", () => {
  test("reads the presented certificate details", async () => {
    const server = await startTlsMcpServer()
    try {
      const cert = await McpTls.probeCertificate("127.0.0.1", server.port)
      expect(cert.fingerprint).toBe(FINGERPRINT)
      expect(cert.subject).toContain("CN=localhost")
      expect(cert.pem).toStartWith("-----BEGIN CERTIFICATE-----")
      expect(cert.validTo).toBeGreaterThan(Date.now())
    } finally {
      await server.close()
    }
  })

  test("rejects when nothing is listening", async () => {
    const port = await freePort()
    await expect(McpTls.probeCertificate("127.0.0.1", port)).rejects.toThrow("TLS pre-flight connection failed")
  })
})

describe("McpTrustedHost store", () => {
  const key = { projectID: Project.ID.global, host: "192.168.1.1", port: 443 }

  test("stores and retrieves entries, upserting on the same key", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedProject()
        const store = yield* McpTrustedHost.Service
        expect(yield* store.get(key)).toBeUndefined()
        yield* store.put({ ...key, fingerprint: "a".repeat(64), subject: "CN=first", validTo: 1000 })
        expect(yield* store.get(key)).toMatchObject({ fingerprint: "a".repeat(64), subject: "CN=first" })
        yield* store.put({ ...key, fingerprint: "b".repeat(64), subject: "CN=second", validTo: 2000 })
        const updated = yield* store.get(key)
        expect(updated?.fingerprint).toBe("b".repeat(64))
        expect((yield* store.list(Project.ID.global))).toHaveLength(1)
      }).pipe(Effect.scoped, Effect.provide(storeLayer)),
    )
  })

  test("keeps entries separate per project", async () => {
    const other = Project.ID.make("proj_other")
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedProject()
        yield* seedProject(other)
        const store = yield* McpTrustedHost.Service
        yield* store.put({ ...key, fingerprint: "a".repeat(64), subject: "CN=first", validTo: 1000 })
        expect((yield* store.list(Project.ID.global))).toHaveLength(1)
        expect(yield* store.list(other)).toHaveLength(0)
        expect(yield* store.get({ ...key, projectID: other })).toBeUndefined()
      }).pipe(Effect.scoped, Effect.provide(storeLayer)),
    )
  })

  test("removes entries", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedProject()
        const store = yield* McpTrustedHost.Service
        yield* store.put({ ...key, fingerprint: "a".repeat(64), subject: "CN=first", validTo: 1000 })
        yield* store.remove(key)
        expect(yield* store.get(key)).toBeUndefined()
      }).pipe(Effect.scoped, Effect.provide(storeLayer)),
    )
  })
})

describe("trust on first use", () => {
  test("first use fails with a trust hint; trusting and reconnecting connects", async () => {
    const server = await startTlsMcpServer()
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* seedProject()
          const mcp = yield* Mcp.Service
          const error = failedError(yield* settled(mcp), "first use")
          expect(error).toContain(`TLS certificate for 127.0.0.1:${server.port} is not trusted`)
          expect(error).toContain(`SHA256:${FINGERPRINT}`)
          expect(error).toContain("Subject: CN=localhost")
          expect(error).toContain(`opencode mcp trust ${server.url}`)

          const store = yield* McpTrustedHost.Service
          expect(yield* store.get({ projectID: Project.ID.global, host: "127.0.0.1", port: server.port })).toBeUndefined()

          const inspect = yield* mcp.trustInspect({ url: server.url })
          expect(inspect.cert.fingerprint).toBe(FINGERPRINT)
          expect(inspect.stored).toBeUndefined()

          const result = yield* mcp.trust({ url: server.url })
          expect(result.fingerprint).toBe(FINGERPRINT)
          expect(result.replaced).toBe(false)

          const after = yield* mcp.trustInspect({ url: server.url })
          expect(after.stored?.fingerprint).toBe(FINGERPRINT)

          yield* mcp.connect("appliance")
          connected(yield* settled(mcp), "after trust")
        }).pipe(Effect.scoped, Effect.provide(trustMcpLayer(server.url))),
      )
    } finally {
      await server.close()
    }
  })

  test("a rotated certificate fails the connection until it is re-pinned with force", async () => {
    const port = await freePort()
    const url = `https://127.0.0.1:${port}/mcp`
    const servers: Array<{ close: () => Promise<void> }> = []
    const start = (options: Parameters<typeof startTlsMcpServer>[0]) =>
      Effect.promise(() => startTlsMcpServer(options)).pipe(
        Effect.tap((server) => Effect.sync(() => servers.push(server))),
      )
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedProject()
        const mcp = yield* Mcp.Service
        const store = yield* McpTrustedHost.Service
        const first = yield* start({ port })

        failedError(yield* settled(mcp), "first use")
        const pinned = yield* mcp.trust({ url })
        expect(pinned.fingerprint).toBe(FINGERPRINT)
        yield* mcp.connect("appliance")
        connected(yield* settled(mcp), "after pin")

        yield* Effect.promise(() => first.close())
        yield* start({ port, cert: CERT_ROTATED, key: KEY_ROTATED })
        // The live session from before the rotation keeps running; the pin is enforced on reconnect.
        yield* mcp.connect("appliance")

        const error = failedError(yield* settled(mcp), "after rotation")
        expect(error).toContain("changed since it was last trusted")
        expect(error).toContain(FINGERPRINT)
        expect(error).toContain(FINGERPRINT_ROTATED)
        expect(error).toContain(`opencode mcp trust ${url} --force`)

        const rejected = yield* mcp.trust({ url }).pipe(Effect.exit)
        if (Exit.isSuccess(rejected)) throw new Error("trust unexpectedly succeeded")
        expect(errorMessage(rejected.cause)).toContain("changed since it was last trusted")

        const forced = yield* mcp.trust({ url, force: true })
        expect(forced.fingerprint).toBe(FINGERPRINT_ROTATED)
        expect(forced.replaced).toBe(true)
        const stored = yield* store.get({ projectID: Project.ID.global, host: "127.0.0.1", port })
        expect(stored?.fingerprint).toBe(FINGERPRINT_ROTATED)

        yield* mcp.connect("appliance")
        connected(yield* settled(mcp), "after re-pin")
      }).pipe(
        Effect.ensuring(
          Effect.forEach(servers, (server) => Effect.promise(() => server.close()).pipe(Effect.ignore), { discard: true }),
        ),
        Effect.scoped,
        Effect.provide(trustMcpLayer(url)),
      ),
    )
  })

  test("a pin from another project is not applied", async () => {
    const server = await startTlsMcpServer()
    const other = Project.ID.make("proj_other")
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* seedProject()
          yield* seedProject(other)
          const mcp = yield* Mcp.Service
          const store = yield* McpTrustedHost.Service
          yield* store.put({
            projectID: other,
            host: "127.0.0.1",
            port: server.port,
            fingerprint: FINGERPRINT,
            subject: "CN=localhost",
            validTo: Date.now() + 86_400_000,
          })

          const error = failedError(yield* settled(mcp), "first use")
          expect(error).toContain(`TLS certificate for 127.0.0.1:${server.port} is not trusted`)

          const result = yield* mcp.trust({ url: server.url })
          expect(result.replaced).toBe(false)
          expect((yield* store.list(Project.ID.global))).toHaveLength(1)
          expect((yield* store.list(other))).toHaveLength(1)
        }).pipe(Effect.scoped, Effect.provide(trustMcpLayer(server.url))),
      )
    } finally {
      await server.close()
    }
  })

  test("hostname servers are not offered trust-on-first-use", async () => {
    const server = await startTlsMcpServer()
    const url = server.url.replace("127.0.0.1", "localhost")
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* seedProject()
          const mcp = yield* Mcp.Service
          const error = failedError(yield* settled(mcp), "localhost")
          expect(error).not.toContain("opencode mcp trust")
          const store = yield* McpTrustedHost.Service
          expect(yield* store.list(Project.ID.global)).toHaveLength(0)
        }).pipe(Effect.scoped, Effect.provide(trustMcpLayer(url))),
      )
    } finally {
      await server.close()
    }
  })

  test("trust operations reject non-private hosts and non-https URLs", async () => {
    const layer = trustMcpLayer("https://127.0.0.1:1/mcp")
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedProject()
        const mcp = yield* Mcp.Service
        const publicIp = yield* mcp.trust({ url: "https://8.8.8.8/mcp" }).pipe(Effect.exit)
        if (Exit.isSuccess(publicIp)) throw new Error("trust unexpectedly succeeded")
        expect(errorMessage(publicIp.cause)).toContain("not a private IP address")
        const hostname = yield* mcp.trust({ url: "https://localhost/mcp" }).pipe(Effect.exit)
        if (Exit.isSuccess(hostname)) throw new Error("trust unexpectedly succeeded")
        expect(errorMessage(hostname.cause)).toContain("not a private IP address")
        const plain = yield* mcp.trust({ url: "http://192.168.1.1/mcp" }).pipe(Effect.exit)
        if (Exit.isSuccess(plain)) throw new Error("trust unexpectedly succeeded")
        expect(errorMessage(plain.cause)).toContain("requires an https URL")
        const bogus = yield* mcp.trust({ url: "not a url" }).pipe(Effect.exit)
        if (Exit.isSuccess(bogus)) throw new Error("trust unexpectedly succeeded")
        expect(errorMessage(bogus.cause)).toContain("Invalid URL")
      }).pipe(Effect.scoped, Effect.provide(layer)),
    )
  })

  test("trust rejects a certificate that changed after the check", async () => {
    const server = await startTlsMcpServer()
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* seedProject()
          const mcp = yield* Mcp.Service
          const exit = yield* mcp.trust({ url: server.url, expectFingerprint: "f".repeat(64) }).pipe(Effect.exit)
          if (Exit.isSuccess(exit)) throw new Error("trust unexpectedly succeeded")
          expect(errorMessage(exit.cause)).toContain("certificate changed between the check and the confirmation")
        }).pipe(Effect.scoped, Effect.provide(trustMcpLayer(server.url))),
      )
    } finally {
      await server.close()
    }
  })
})
