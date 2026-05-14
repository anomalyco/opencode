import { expect, mock, beforeEach } from "bun:test"
import { EventEmitter } from "events"
import { Deferred, Effect, Layer, Option } from "effect"
import type { Duration } from "effect"
import { testEffect } from "../lib/effect"
import type { MCP as MCPNS } from "../../src/mcp/index"

// Track open() calls and control failure behavior
let openShouldFail = false
let openCalledWith: string | undefined
let openDeferred: Deferred.Deferred<string> | undefined

void mock.module("open", () => ({
  default: async (url: string) => {
    openCalledWith = url
    if (openDeferred) Effect.runSync(Deferred.succeed(openDeferred, url).pipe(Effect.ignore))

    // Return a mock subprocess that emits an error if openShouldFail is true
    const subprocess = new EventEmitter()
    if (openShouldFail) {
      // Emit error asynchronously like a real subprocess would
      setTimeout(() => {
        subprocess.emit("error", new Error("spawn xdg-open ENOENT"))
      }, 10)
    }
    return subprocess
  },
}))

// Mock UnauthorizedError
class MockUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown }
}> = []

// Mock the transport constructors
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    url: string
    authProvider: { redirectToAuthorization?: (url: URL) => Promise<void> } | undefined
    constructor(url: URL, options?: { authProvider?: { redirectToAuthorization?: (url: URL) => Promise<void> } }) {
      this.url = url.toString()
      this.authProvider = options?.authProvider
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      // Simulate OAuth redirect by calling the authProvider's redirectToAuthorization
      if (this.authProvider?.redirectToAuthorization) {
        await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?client_id=test"))
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {
      // Mock successful auth completion
    }
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: {},
      })
    }
    async start() {
      throw new Error("Mock SSE transport cannot connect")
    }
  },
}))

// Mock the MCP SDK Client to trigger OAuth flow
void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }
  },
}))

// Mock UnauthorizedError in the auth module
void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

beforeEach(() => {
  openShouldFail = false
  openCalledWith = undefined
  openDeferred = undefined
  transportCalls.length = 0
})

// Import modules after mocking
const { MCP } = await import("../../src/mcp/index")
const { Bus } = await import("../../src/bus")
const { Config } = await import("../../src/config/config")
const { McpAuth } = await import("../../src/mcp/auth")
const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
const { AppFileSystem } = await import("@opencode-ai/core/filesystem")
const { CrossSpawnSpawner } = await import("@opencode-ai/core/cross-spawn-spawner")
const mcpTest = testEffect(
  MCP.layer.pipe(
    Layer.provide(McpAuth.defaultLayer),
    Layer.provideMerge(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  ),
)
const service = MCP.Service as unknown as Effect.Effect<MCPNS.Interface, never, never>

const config = (name: string) => ({
  mcp: {
    [name]: {
      type: "remote" as const,
      url: "https://example.com/mcp",
    },
  },
})

const withCallbackStop = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

const awaitWithTimeout = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  message: string,
  duration: Duration.Input = "5 seconds",
) =>
  self.pipe(
    Effect.timeoutOrElse({
      duration,
      orElse: () => Effect.fail(new Error(message)),
    }),
  )

const trackBrowserOpen = Effect.gen(function* () {
  const opened = yield* Deferred.make<string>()
  openDeferred = opened
  yield* Effect.addFinalizer(() => Effect.sync(() => (openDeferred = undefined)))
  return opened
})

const trackBrowserOpenFailed = Effect.gen(function* () {
  const bus = yield* Bus.Service
  const event = yield* Deferred.make<{ mcpName: string; url: string }>()
  const unsubscribe = yield* bus.subscribeCallback(MCP.BrowserOpenFailed, (evt) => {
    Effect.runSync(Deferred.succeed(event, evt.properties).pipe(Effect.ignore))
  })
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
  return event
})

const authenticateScoped = (name: string) =>
  Effect.gen(function* () {
    const mcp = yield* service
    yield* mcp.authenticate(name).pipe(
      Effect.ignore,
      Effect.catchCause(() => Effect.void),
      Effect.forkScoped,
    )
  })

mcpTest.instance(
  "BrowserOpenFailed event is published when open() throws",
  () =>
    Effect.gen(function* () {
      yield* withCallbackStop
      openShouldFail = true

      const event = yield* trackBrowserOpenFailed
      yield* authenticateScoped("test-oauth-server")

      const failure = yield* awaitWithTimeout(Deferred.await(event), "Timed out waiting for BrowserOpenFailed event")

      expect(failure.mcpName).toBe("test-oauth-server")
      expect(failure.url).toContain("https://")
    }),
  { config: config("test-oauth-server") },
)

mcpTest.instance(
  "BrowserOpenFailed event is NOT published when open() succeeds",
  () =>
    Effect.gen(function* () {
      yield* withCallbackStop
      openShouldFail = false

      const opened = yield* trackBrowserOpen
      const event = yield* trackBrowserOpenFailed
      yield* authenticateScoped("test-oauth-server-2")

      yield* awaitWithTimeout(Deferred.await(opened), "Timed out waiting for open()")
      const failure = yield* Deferred.await(event).pipe(Effect.timeoutOption("700 millis"))

      expect(failure).toEqual(Option.none())
      expect(openCalledWith).toBeDefined()
    }),
  { config: config("test-oauth-server-2") },
)

mcpTest.instance(
  "open() is called with the authorization URL",
  () =>
    Effect.gen(function* () {
      yield* withCallbackStop
      openShouldFail = false
      openCalledWith = undefined

      const opened = yield* trackBrowserOpen
      const event = yield* trackBrowserOpenFailed
      yield* authenticateScoped("test-oauth-server-3")

      const url = yield* awaitWithTimeout(Deferred.await(opened), "Timed out waiting for open()")
      const failure = yield* Deferred.await(event).pipe(Effect.timeoutOption("700 millis"))

      expect(failure).toEqual(Option.none())
      expect(typeof url).toBe("string")
      expect(url).toContain("https://")
    }),
  { config: config("test-oauth-server-3") },
)
