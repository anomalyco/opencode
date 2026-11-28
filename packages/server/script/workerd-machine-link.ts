#!/usr/bin/env bun
/**
 * The machine link under real workerd: bundles `ServerWorkerd` into a Durable Object with wrangler, as a deployment
 * would, runs it in Miniflare, and drives `/api/experimental/machine/link` with real sockets: a worker that joins with
 * `Link.connect` and is served, and the strangers and limits the endpoint turns away. A second Durable Object takes
 * links with WebSocket Hibernation (`ctx.acceptWebSocket` and its `webSocket*` methods) and is woken twice over a
 * live link, which must carry on with no reconnect. `wrangler` is not a dependency
 * of this repository, so it and the Miniflare it brings are installed into a temporary directory.
 *
 *   bun run probe:workerd-machine-link
 */
import path from "node:path"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import { $ } from "bun"
import { Identity } from "@opencode/core/machine/identity"
import { Machine } from "@opencode/core/machine/index"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { WorkerClient } from "@opencode/core/machine/worker-client"
import { MachineInfo, MachineInvite } from "@opencode/protocol/groups/machine"
import { Effect, Option, Schema, Stream } from "effect"
import { Environment } from "@opencode/core/environment/index"
import { makeWorker } from "../../core/test/fixture/machine-worker"

// The wrangler the SDK's package check deploys with (packages/sdk/script/verify-package.ts).
const WRANGLER = "4.110.0"
const LINK = "/api/experimental/machine/link"
const upgrade = { headers: { upgrade: "websocket" } }
const authorization = `Basic ${btoa("opencode:secret")}`
/** Noise XX's second message as link.ts lays it out: e, s and its tag, the home's key and signature and their tag. */
const SECOND = 32 + (32 + 16) + (32 + 64 + 16)
const decodeInvite = Schema.decodeUnknownSync(Schema.Struct({ data: MachineInvite }))
const decodeList = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(MachineInfo) }))

async function run(directory: string) {
  await Bun.write(path.join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }))
  await Bun.write(
    path.join(directory, "wrangler.jsonc"),
    JSON.stringify({
      name: "opencode-workerd-machine-link",
      main: path.join(import.meta.dir, "workerd-machine-link.worker.ts"),
      compatibility_date: "2026-07-15",
      compatibility_flags: ["nodejs_compat"],
      durable_objects: {
        bindings: [
          { name: "HOME", class_name: "Home" },
          { name: "HIBERNATING", class_name: "HibernatingHome" },
        ],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["Home", "HibernatingHome"] }],
    }),
  )
  await $`npm install --ignore-scripts --no-audit --no-fund --package-lock=false wrangler@${WRANGLER}`
    .cwd(directory)
    .quiet()
  await $`node_modules/.bin/wrangler deploy --dry-run --config wrangler.jsonc --outdir dist`.cwd(directory).quiet()
  const { Miniflare } = await import(path.join(directory, "node_modules/miniflare/dist/src/index.js"))
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-15",
    compatibilityFlags: ["nodejs_compat"],
    modules: true,
    modulesRoot: path.join(directory, "dist"),
    // What wrangler's default rules emit beside the bundle.
    modulesRules: [
      { type: "ESModule", include: ["**/*.js", "**/*.mjs"] },
      { type: "Text", include: ["**/*.txt", "**/*.md", "**/*.html", "**/*.sql"] },
      { type: "CompiledWasm", include: ["**/*.wasm"] },
      { type: "Data", include: ["**/*.bin"] },
    ],
    scriptPath: path.join(directory, "dist/workerd-machine-link.worker.js"),
    durableObjects: {
      HOME: { className: "Home", useSQLite: true },
      HIBERNATING: { className: "HibernatingHome", useSQLite: true },
    },
    // The server's own event log goes to stdout; errors still reach stderr.
    handleRuntimeStdio: (stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream) => {
      stdout.resume()
      stderr.pipe(process.stderr)
    },
  })
  try {
    const fetch: Fetch = (home, input, init) => {
      const url = new URL(input, "http://home")
      if (home === "off") url.searchParams.set("machines", "off")
      if (home === "hibernating") url.searchParams.set("home", "hibernating")
      return miniflare.dispatchFetch(url, init)
    }
    const link = new URL(LINK, await miniflare.ready)
    link.protocol = "ws:"
    await joins(fetch, link)
    await checks(fetch)
    const hibernating = new URL(link)
    hibernating.searchParams.set("home", "hibernating")
    await hibernates(fetch, hibernating)
    console.log("workerd machine link OK")
  } finally {
    await miniflare.dispose()
  }
}

type Fetch = (
  home: "on" | "off" | "hibernating",
  path: string,
  init?: RequestInit,
) => Promise<{
  readonly status: number
  readonly webSocket: WorkerdSocket | null
  json(): Promise<unknown>
}>

interface WorkerdSocket {
  accept(): void
  send(message: Uint8Array | string): void
  close(code?: number): void
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
  addEventListener(type: "close", listener: (event: { readonly code: number }) => void): void
}

async function checks(fetch: Fetch) {
  expect("machines off: the upgrade is an unknown route", (await fetch("off", LINK, upgrade)).status, 404)
  // Only the upgrade skips the password, as on Node.
  expect("machines on: a GET that is no upgrade needs the password", (await fetch("on", LINK)).status, 401)
  // No POST upgrade: workerd refuses a WebSocket upgrade that is not a GET before any Worker sees it.
  expect(
    "machines on: a GET that is no upgrade, with the password, is no link",
    (await fetch("on", LINK, { headers: { authorization } })).status,
    404,
  )

  // Any 32 bytes are a first message, so the home proves itself to a stranger before the stranger proves anything.
  const stranger = await open(fetch)
  stranger.socket.send(new Uint8Array(randomBytes(32)))
  const second = await Promise.race([stranger.next, stranger.closed.then((code) => `closed ${code}`)])
  expect(
    "a stranger's first message gets the home's second",
    second instanceof Uint8Array ? second.length : second,
    SECOND,
  )
  stranger.socket.close(1000)
  await stranger.closed

  const big = await open(fetch)
  big.socket.send(new Uint8Array(65_536))
  expect("a message over 65,535 bytes closes with 1009", await big.closed, 1009)

  const text = await open(fetch)
  text.socket.send("hello")
  expect("a text message closes with 1008", await text.closed, 1008)

  // Every place a refused or abandoned handshake held is free again: more sockets than there are places, one after
  // another, are each upgraded.
  for (const index of Array.from({ length: 40 }, (_, index) => index)) {
    const peer = await open(fetch)
    if (index % 2 === 0) {
      peer.socket.send(new Uint8Array(15))
      expect(`peer ${index}: a message shorter than a frame closes with 1008`, await peer.closed, 1008, false)
      continue
    }
    peer.socket.close(1000)
    await peer.closed
  }
  console.log("  ok: 40 handshakes one after another, each upgraded")

  // Strangers that say nothing hold every place until their ten seconds run out; the next is answered as HTTP.
  const silent = await Promise.all(Array.from({ length: 32 }, () => open(fetch)))
  expect("with every place held, the next upgrade is 503", (await fetch("on", LINK, upgrade)).status, 503)
  expect("a silent stranger is closed with 1008 at its deadline", await silent[0].closed, 1008)
  await Promise.all(silent.map((peer) => peer.closed))
  const after = await open(fetch)
  after.socket.close(1000)
  console.log("  ok: places free again once the deadline closed them")
}

/**
 * A worker joins over a real WebSocket, as `opencode-worker` does: the invitation from the machine routes, `Link.connect`
 * with the join secret, and a hello listing a process the home never started, which the home answers by killing and
 * releasing it. That answer is the home's frames reaching the worker; the machine list showing it online over a
 * WebSocket is the worker's hello reaching the home. Closing the socket takes it offline.
 */
async function joins(fetch: Fetch, link: URL) {
  const invited = await fetch("on", "/api/experimental/machine", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ name: "gpu", reach: [] }),
  })
  expect("the machine routes invite a machine", invited.status, 200)
  const join = Option.getOrThrow(Join.decode(decodeInvite(await invited.json()).data.join))
  const orphan = Machine.ProcessID.make("orphan")
  await Effect.runPromise(
    Effect.gen(function* () {
      const carrier = yield* WorkerClient.fromWebSocket(new WebSocket(link))
      const linked = yield* Link.connect(carrier, {
        home: join.home,
        identity: Identity.fromSeed(randomBytes(32)),
        secret: join.secret,
      })
      expect("the worker is welcomed as the machine it was invited as", linked.machine, "gpu")
      linked.send({
        type: "hello",
        protocol: 3,
        os: "linux",
        arch: "x64",
        home: "/home/worker",
        instance: Machine.Instance.make(crypto.randomUUID()),
        processes: [{ id: orphan, pid: 4242, state: "running", bytes: 0 }],
      })
      const answered = yield* linked.messages.pipe(Stream.take(2), Stream.runCollect)
      expect(
        "the home answers the hello over the link: kill and release the process it never started",
        JSON.stringify(answered),
        JSON.stringify([
          { type: "kill", id: orphan, signal: "SIGKILL" },
          { type: "release", id: orphan },
        ]),
      )
      const online = yield* Effect.promise(() => machine(fetch))
      expect("the machine list shows it online", online?.online, true)
      expect("over a WebSocket", online?.connection?.kind, "websocket")
    }).pipe(Effect.scoped),
  )
  await until("closing the socket takes the machine offline", async () => (await machine(fetch))?.online === false)
}

/**
 * The same over WebSocket Hibernation. The worker joins and a file written on it and read back proves frames both ways.
 * Then the object wakes twice (see `HibernatingHome`): each time the machine is online at once over the first socket,
 * with files crossing it both ways, so nothing reconnected, nothing was sent to resume it, and no nonce slipped. A wake
 * while a process runs closes the socket with 1008 instead, and the worker's next connection lists the process, which
 * the new home, knowing nothing of it, stops. A reset drops the sockets, so nothing is resumed from what they held.
 * Closing the socket reaches `webSocketClose`, and the endpoint's limits hold for messages through `webSocketMessage`.
 */
async function hibernates(fetch: Fetch, link: URL) {
  const invited = await fetch("hibernating", "/api/experimental/machine", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ name: "gpu", reach: [] }),
  })
  expect("hibernating: the machine routes invite a machine", invited.status, 200)
  const join = Option.getOrThrow(Join.decode(decodeInvite(await invited.json()).data.join))
  const identity = Identity.fromSeed(randomBytes(32))
  const roundtrip = async () => {
    const response = await fetch("hibernating", "/__probe/roundtrip")
    if (response.status !== 200) throw new Error(`the roundtrip returned ${response.status}`)
    return Schema.decodeUnknownSync(Schema.Struct({ read: Schema.Boolean }))(await response.json()).read
  }
  const online = async () => (await machine(fetch, "hibernating"))?.online
  const dials = { count: 0 }
  await Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* makeWorker({
        connect: (connection) =>
          Effect.gen(function* () {
            dials.count++
            const carrier = yield* WorkerClient.fromWebSocket(new WebSocket(link))
            const linked = yield* Link.connect(carrier, { home: join.home, identity, secret: join.secret })
            linked.send(connection.hello)
            yield* Effect.raceFirst(
              Stream.runForEach(linked.messages, (message) => Effect.sync(() => connection.send(message))),
              Stream.runForEach(connection.messages, (message) => Effect.sync(() => linked.send(message))),
            )
          }).pipe(Effect.scoped),
      })
      const wake = Effect.promise(() => fetch("hibernating", "/__probe/wake"))
      yield* worker.restore
      yield* Effect.promise(() => until("hibernating: the worker joins", async () => (await online()) === true))
      expect("hibernating: a file crosses the link both ways", yield* Effect.promise(roundtrip), true)
      for (const index of [1, 2]) {
        expect(`wake ${index}: a fresh server boots over the same storage and sockets`, (yield* wake).status, 204)
        const listed = yield* Effect.promise(() => machine(fetch, "hibernating"))
        expect(`wake ${index}: the machine is online at once`, listed?.online, true)
        expect(`wake ${index}: over its WebSocket`, listed?.connection?.kind, "websocket")
        expect(`wake ${index}: a file crosses the resumed link both ways`, yield* Effect.promise(roundtrip), true)
        const written = yield* Environment.makeFiles(worker.files).read("/roundtrip")
        expect(`wake ${index}: the worker holds what the home wrote`, written.bytes.length, 200_000)
      }
      expect("the worker dialled once, whatever the home's wakes", dials.count, 1)

      const spawned = yield* Effect.promise(() => fetch("hibernating", "/__probe/spawn"))
      expect("the home starts a process on the machine", spawned.status, 204)
      const orphan = worker.runs[0].id
      yield* wake
      expect("a wake while a process runs resumes nothing", yield* Effect.promise(online), false)
      yield* worker.restore
      yield* Effect.promise(() =>
        until("the worker reconnects with a hello that lists its process", async () => (await online()) === true),
      )
      yield* Effect.promise(() =>
        until("the new home stops the process it knows nothing of", async () =>
          worker.received.some((message) => message.type === "kill" && message.id === orphan),
        ),
      )

      const reset = yield* Effect.promise(() => fetch("hibernating", "/__probe/abort"))
      expect("a reset fails the request it came in on", reset.status, 500)
      expect("and drops the sockets, so nothing is resumed from them", yield* Effect.promise(online), false)
    }).pipe(Effect.scoped),
  )

  // Over a socket of its own: the last one the reset dropped.
  const closing = await open(fetch, "hibernating")
  closing.socket.close(1000)
  expect("hibernating: closing a socket reaches webSocketClose", await closing.closed, 1000)
  const big = await open(fetch, "hibernating")
  big.socket.send(new Uint8Array(65_536))
  expect("hibernating: a message over 65,535 bytes closes with 1009", await big.closed, 1009)
  const text = await open(fetch, "hibernating")
  text.socket.send("hello")
  expect("hibernating: a text message closes with 1008", await text.closed, 1008)
  const short = await open(fetch, "hibernating")
  short.socket.send(new Uint8Array(15))
  expect("hibernating: a message shorter than a frame closes with 1008", await short.closed, 1008)
}

async function machine(fetch: Fetch, home: "on" | "hibernating" = "on") {
  const listed = await fetch(home, "/api/experimental/machine", { headers: { authorization } })
  return decodeList(await listed.json()).data.find((entry) => entry.id === "gpu")
}

async function until(name: string, condition: () => Promise<boolean>) {
  const deadline = performance.now() + 30_000
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error(`${name}: never happened`)
    await Bun.sleep(20)
  }
  console.log(`  ok: ${name}`)
}

async function open(fetch: Fetch, home: "on" | "hibernating" = "on") {
  const response = await fetch(home, LINK, upgrade)
  expect("machines on: the upgrade is 101", response.status, 101, false)
  const socket = response.webSocket
  if (!socket) throw new Error("the 101 carried no webSocket")
  socket.accept()
  const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)))
  const next = new Promise<Uint8Array>((resolve) =>
    socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) resolve(new Uint8Array(event.data))
    }),
  )
  return { socket, closed, next }
}

function expect(name: string, actual: unknown, expected: unknown, log = true) {
  if (actual !== expected) throw new Error(`${name}: expected ${String(expected)}, got ${String(actual)}`)
  if (log) console.log(`  ok: ${name}`)
}

const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-workerd-machine-link-"))
try {
  await run(directory)
} finally {
  rmSync(directory, { recursive: true, force: true })
}
