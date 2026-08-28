#!/usr/bin/env bun

// THROWAWAY: native loopback diagnostic, not a fix or a regression test.
// Run: bun script/probe-callback-port.ts
import { createServer, type Server } from "node:http"
import { spawn } from "node:child_process"
import type { Socket } from "node:net"
import timers from "node:timers/promises"

const modes = [
  "no-connection",
  "force-first",
  "fixed-force-first",
  "listen-callback",
  "child-hold",
  "response-connection-close",
  "socket-reset-after-flush",
  "socket-destroy-after-flush",
  "client-consume-body",
  "client-connection-close",
] as const

const started = performance.now()
const deadline = new AbortController()
const guard = setTimeout(() => deadline.abort(new Error("28s probe deadline exceeded")), 28_000)
const hardGuard = setTimeout(() => {
  console.log(JSON.stringify({ event: "hard-deadline", note: "Cleanup did not finish by 30s" }))
  process.exit(1)
}, 30_000).unref()
const used = new Set<number>()

console.log(
  JSON.stringify({
    event: "probe-start",
    bun: Bun.version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    retryDelaysMs: [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800],
    note: "Nine retries after fetch settles; stop at first success. TCP observation at 2s. Child-hold adds one bind after child release if retries fail. No fallback port.",
  }),
)

try {
  for (const mode of modes) await probe(mode)
} catch (cause) {
  console.log(JSON.stringify({ event: "harness-error", error: describe(cause) }))
  process.exitCode = 1
} finally {
  clearTimeout(guard)
  if (!process.exitCode) clearTimeout(hardGuard)
  console.log(
    JSON.stringify({
      event: "probe-end",
      elapsedMs: Math.round(performance.now() - started),
      exitCode: process.exitCode ?? 0,
    }),
  )
}

async function probe(mode: (typeof modes)[number]) {
  const epoch = performance.now()
  const cancellation = new AbortController()
  const child = {
    process: undefined as ReturnType<typeof spawn> | undefined,
    closed: false,
    releaseRequested: false,
    exited: Promise.withResolvers<void>(),
    rebind: undefined as Awaited<ReturnType<typeof bind>> | undefined,
  }
  const state = {
    port: 0,
    cancelAt: 0,
    fetchAt: 0,
    requests: 0,
    stopped: false,
    socketOperation: "not-requested",
    snapshots: [] as Promise<void>[],
  }
  const log = (event: string, detail: object = {}) =>
    console.log(
      JSON.stringify({
        mode,
        port: state.port,
        event,
        tMs: Math.round(performance.now() - epoch),
        afterCancelMs: state.cancelAt ? Math.round(performance.now() - state.cancelAt) : null,
        afterFetchMs: state.fetchAt ? Math.round(performance.now() - state.fetchAt) : null,
        ...detail,
      }),
    )
  const sockets = new Set<Socket>()
  const servers = ["127.0.0.1", "::1", "localhost"].map((host) => {
    const item = { host, server: createServer(), closed: false }
    item.server.on("listening", () => {
      item.closed = false
      log("listening", { host, address: item.server.address(), listening: item.server.listening })
    })
    item.server.on("close", () => {
      item.closed = true
      log("server-close-event", { host, listening: item.server.listening })
    })
    item.server.on("error", (error) => log("server-error", { host, error: describe(error) }))
    item.server.on("connection", (socket) => track(socket, host, "connection"))
    item.server.on("request", (request, response) => {
      state.requests++
      track(request.socket, host, "request")
      log("cancel-request", {
        host,
        socket: socketInfo(request.socket),
        connection: request.headers.connection ?? null,
      })
      if (request.url !== "/cancel" || host === "localhost") {
        response.writeHead(404).end()
        return
      }
      if (mode === "response-connection-close") response.setHeader("Connection", "close")
      response.end("cancelled", () => {
        log("response-flush-callback", { host, socket: socketInfo(request.socket) })
        if (mode === "socket-reset-after-flush" || mode === "socket-destroy-after-flush") {
          const operation = mode === "socket-reset-after-flush" ? "resetAndDestroy" : "destroy"
          // Bun may expose a FakeSocket whose resetAndDestroy throws. A return does not prove a wire-level RST.
          try {
            request.socket[operation]()
            state.socketOperation = "returned-not-wire-verified"
            log("socket-operation", { operation, result: state.socketOperation, socket: socketInfo(request.socket) })
          } catch (cause) {
            state.socketOperation = "unsupported-or-failed"
            log("socket-operation", { operation, result: state.socketOperation, error: describe(cause) })
          }
        }
        stop()
      })
    })
    return item
  })

  function track(socket: Socket, host: string, source: string) {
    if (sockets.has(socket)) return
    sockets.add(socket)
    if (socket.remotePort) used.add(socket.remotePort)
    log("socket-observed", { host, source, socket: socketInfo(socket) })
    socket.on("close", (hadError) => log("socket-close-event", { host, hadError, socket: socketInfo(socket) }))
    socket.on("error", (error) => log("socket-error", { host, error: describe(error) }))
  }

  function stop() {
    if (state.stopped) return
    state.stopped = true
    try {
      servers.slice(0, 2).forEach((item) => {
        log("force-before-close", { host: item.host, listening: item.server.listening })
        item.server.closeAllConnections()
        log("force-returned", { host: item.host, listening: item.server.listening })
        item.server.close()
        log("close-returned", { host: item.host, listening: item.server.listening })
      })
      // Observe asynchronously without delaying retries; route failures through the harness's finally cleanup.
      state.snapshots.push(tcp("after-close").catch((cause) => deadline.abort(cause)))
    } catch (cause) {
      deadline.abort(cause)
    }
  }

  async function tcp(phase: string) {
    const snapshotAtMs = Math.round(performance.now() - epoch)
    const snapshot = await tcpSnapshot(state.port, deadline.signal, child.process?.pid)
    log("tcp", { phase, snapshotAtMs, ...snapshot })
  }

  async function stopChild() {
    if (!child.process) return
    if (!child.closed) {
      child.releaseRequested = true
      log("child-release-request", { killRequested: child.process.kill("SIGKILL") })
    }
    await bounded(child.exited.promise, AbortSignal.timeout(1000))
    log("child-release-complete", { closed: child.closed })
  }

  try {
    log("mode-start", {
      variation: mode,
      baseline: "force-first; fetch body unread; both literal families; same target server reused",
    })
    const first = await bind(servers[0].server, mode === "fixed-force-first" ? 1455 : 0, "127.0.0.1", deadline.signal)
    if (!first.ok) throw new Error(`IPv4 setup failed: ${JSON.stringify(first.error)}`)
    const address = servers[0].server.address()
    if (!address || typeof address === "string") throw new Error("Missing ephemeral TCP address")
    state.port = address.port
    if (used.has(state.port)) throw new Error("OS reused a previous mode's port; comparison would be contaminated")
    used.add(state.port)
    const second = await bind(servers[1].server, state.port, "::1", deadline.signal)
    if (!second.ok) throw new Error(`IPv6 setup failed: ${JSON.stringify(second.error)}`)
    const occupied = await bind(servers[2].server, state.port, "localhost", deadline.signal, mode === "listen-callback")
    log("occupied-bind", occupied)
    if (occupied.ok || occupied.error.code !== "EADDRINUSE")
      throw new Error("Expected localhost bind to fail with EADDRINUSE while both families are occupied")
    if (mode === "child-hold") {
      const ready = Promise.withResolvers<void>()
      const pipe = process.platform === "win32" ? "overlapped" : "pipe"
      // Match the normal Git spawner, including Windows overlapped stdio; the child opens no sockets itself.
      child.process = spawn(
        process.execPath,
        ["-e", 'setTimeout(() => process.exit(1), 10000); process.stdout.write("ready\\n");'],
        { detached: false, windowsHide: process.platform === "win32", stdio: ["ignore", pipe, pipe] },
      )
      child.process.once("error", () => ready.reject(new Error("Owned child failed to spawn")))
      child.process.once("close", (code, signal) => {
        child.closed = true
        ready.reject(new Error("Owned child exited before readiness"))
        child.exited.resolve()
        log("child-close", { code, signal, releaseRequested: child.releaseRequested })
      })
      child.process.stderr?.resume()
      const output = { text: "" }
      child.process.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
        output.text += chunk
        if (output.text === "ready\n") ready.resolve()
        if (!"ready\n".startsWith(output.text)) ready.reject(new Error("Unexpected owned child readiness output"))
      })
      await bounded(ready.promise, AbortSignal.any([deadline.signal, AbortSignal.timeout(1000)]))
      if (child.closed) throw new Error("Owned child exited before the hold window")
      log("child-ready", { owned: true, detached: false, outputPipe: pipe, selfGuardMs: 10_000 })
    }
    await tcp("occupied-baseline")

    state.cancelAt = performance.now()
    if (mode === "no-connection") {
      log("cancel-skipped", { reason: "control: close listeners without accepting a connection" })
      stop()
    }
    if (mode !== "no-connection") {
      try {
        const signal = AbortSignal.any([deadline.signal, cancellation.signal, AbortSignal.timeout(2000)])
        const response = await bounded(
          fetch(`http://localhost:${state.port}/cancel`, {
            // Empty proxy overrides environment proxy settings; never follow redirects off loopback.
            proxy: "",
            redirect: "error",
            signal,
            headers: mode === "client-connection-close" ? { Connection: "close" } : undefined,
          }),
          signal,
        )
        log("cancel-response", {
          status: response.status,
          connection: response.headers.get("connection"),
          bodyUsed: response.bodyUsed,
        })
        if (mode === "client-consume-body") {
          await bounded(response.arrayBuffer(), signal)
          log("client-body-consumed", { bodyUsed: response.bodyUsed })
        }
      } catch (cause) {
        log("cancel-error-ignored", { error: describe(cause) })
      }
    }
    deadline.signal.throwIfAborted()
    state.fetchAt = performance.now()
    log("retry-window-start")
    const attempts = [] as { attempt: number; afterFetchMs: number; ok: boolean; error?: ReturnType<typeof describe> }[]
    // These are production's nine 200ms retries, not a sleep-based proposed fix.
    for (const attempt of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      await timers.setTimeout(200, undefined, { signal: deadline.signal })
      const result = await bind(servers[2].server, state.port, "localhost", deadline.signal, mode === "listen-callback")
      const observation = { attempt, afterFetchMs: Math.round(performance.now() - state.fetchAt), ...result }
      attempts.push(observation)
      log("rebind", observation)
      if (child.process && child.closed) throw new Error("Owned child exited during the hold window")
      if (result.ok) break
      if (result.error.code !== "EADDRINUSE")
        throw new Error(`Unexpected rebind error: ${JSON.stringify(result.error)}`)
    }
    await timers.setTimeout(Math.max(0, 2000 - (performance.now() - state.fetchAt)), undefined, {
      signal: deadline.signal,
    })
    await tcp("window-end")
    await Promise.all(state.snapshots)
    deadline.signal.throwIfAborted()
    if (child.process) {
      if (child.closed) throw new Error("Owned child exited before the hold window ended")
      log("child-window-end", { alive: true })
      if (!attempts.some((item) => item.ok)) {
        await stopChild()
        await tcp("after-child-release")
        child.rebind = await bind(servers[2].server, state.port, "localhost", deadline.signal)
        log("child-release-rebind", child.rebind)
        await tcp("after-child-release-rebind")
      }
    }
    log("mode-result", {
      expected:
        mode === "child-hold"
          ? "rebind succeeds while child lives, or child release restores bind after nine rejected retries"
          : "localhost rebind succeeds within nine retries",
      outcome: child.rebind?.ok
        ? "child-release-restored-bind"
        : attempts.some((item) => item.ok)
          ? "success"
          : "failed",
      occupiedRejected: true,
      firstSuccessAfterFetchMs: attempts.find((item) => item.ok)?.afterFetchMs ?? null,
      attempts,
      requests: state.requests,
      stopInvoked: state.stopped,
      fixtures: servers
        .slice(0, 2)
        .map((item) => ({ host: item.host, listening: item.server.listening, closeEventObserved: item.closed })),
      socketOperation: state.socketOperation,
      childReleaseRebind: child.rebind ?? null,
    })
  } finally {
    // Cleanup occurs only AFTER observations, so destroy() cannot silently change a mode's measured behavior.
    cancellation.abort()
    const cleanup = Promise.allSettled([
      stopChild(),
      ...servers.map(
        (item) =>
          new Promise<void>((resolve) => {
            try {
              item.server.closeAllConnections()
            } finally {
              item.server.close(() => resolve())
            }
          }),
      ),
      ...Array.from(sockets, async (socket) => {
        socket.destroy()
      }),
    ])
    const results = await bounded(cleanup, AbortSignal.timeout(1000))
    await Promise.all(state.snapshots)
    log("cleanup-complete", {
      serversListening: servers.map((item) => item.server.listening),
      ownedChildClosed: child.process ? child.closed : null,
    })
    const failed = results.find((item) => item.status === "rejected")
    if (failed?.status === "rejected") throw failed.reason
  }
}

async function bind(server: Server, port: number, host: string, signal: AbortSignal, callback = false) {
  signal.throwIfAborted()
  const result = Promise.withResolvers<{ ok: true } | { ok: false; error: ReturnType<typeof describe> }>()
  const onError = (cause: unknown) => result.resolve({ ok: false, error: describe(cause) })
  const onListening = () => result.resolve({ ok: true })
  server.once("error", onError)
  if (!callback) server.once("listening", onListening)
  try {
    if (callback) server.listen(port, host, onListening)
    if (!callback) server.listen(port, host)
    return await bounded(result.promise, AbortSignal.any([signal, AbortSignal.timeout(1000)]))
  } finally {
    server.off("error", onError)
    if (!callback) server.off("listening", onListening)
  }
}

function bounded<T>(promise: Promise<T>, signal: AbortSignal) {
  const result = Promise.withResolvers<T>()
  const abort = () => result.reject(signal.reason)
  if (signal.aborted) abort()
  if (!signal.aborted) signal.addEventListener("abort", abort, { once: true })
  promise.then(result.resolve, result.reject)
  return result.promise.finally(() => signal.removeEventListener("abort", abort))
}

function describe(cause: unknown) {
  return {
    name: cause instanceof Error ? cause.name : "UnknownError",
    code: cause && typeof cause === "object" && "code" in cause ? String(cause.code) : null,
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

function socketInfo(socket: Socket) {
  return {
    localAddress: socket.localAddress ?? null,
    localFamily: socket.localFamily ?? null,
    localPort: socket.localPort ?? null,
    remoteAddress: socket.remoteAddress ?? null,
    remoteFamily: socket.remoteFamily ?? null,
    remotePort: socket.remotePort ?? null,
    destroyed: socket.destroyed,
  }
}

async function tcpSnapshot(port: number, signal: AbortSignal, ownedChildPID?: number) {
  signal.throwIfAborted()
  const tool = process.platform === "win32" ? "netstat" : Bun.which("ss") ? "ss" : "lsof"
  if (!Bun.which(tool)) return { tool, unavailable: true, rows: [] }
  const command =
    tool === "netstat"
      ? [tool, "-ano"]
      : tool === "ss"
        ? [tool, "-Htan", `( sport = :${port} or dport = :${port} )`]
        : [tool, "-nP", `-iTCP:${port}`, "-F", "nT"]
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" })
  const state = { timedOut: false }
  const kill = () => child.kill()
  const timer = setTimeout(() => {
    state.timedOut = true
    kill()
  }, 700)
  signal.addEventListener("abort", kill, { once: true })
  try {
    const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
    // netstat has no port filter. Never print its table, process IDs, command names, or account fields.
    // Retain only the chosen port and loopback/unspecified endpoints, even when a tool returns extra rows.
    const rows = [] as {
      local: string
      peer: string | null
      state: string
      thisProcess?: boolean
      ownedChild?: boolean
    }[]
    const safe = (endpoint: string) => /^(127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0|\[?::\]?|\*):[0-9*]+$/.test(endpoint)
    const selected = (endpoint: string) => endpoint.endsWith(`:${port}`)
    const add = (local: string, peer: string | null, status: string, owner?: string) => {
      if (!safe(local) || (peer !== null && !safe(peer))) return
      if (!selected(local) && (peer === null || !selected(peer))) return
      rows.push({
        local,
        peer,
        state: status,
        ...(owner === undefined
          ? {}
          : { thisProcess: owner === String(process.pid), ownedChild: owner === String(ownedChildPID) }),
      })
    }
    if (tool === "lsof") {
      const current = { name: "" }
      output.split(/\r?\n/).forEach((line) => {
        if (line.startsWith("f") || line.startsWith("p")) current.name = ""
        if (line.startsWith("n")) current.name = line.slice(1)
        if (!line.startsWith("TST=")) return
        const endpoints = current.name.split("->")
        add(endpoints[0], endpoints[1] ?? null, line.slice(4))
      })
    }
    if (tool !== "lsof") {
      output.split(/\r?\n/).forEach((line) => {
        const fields = line.trim().split(/\s+/)
        if (tool === "netstat" && fields[0] === "TCP" && fields.length >= 5)
          add(fields[1], fields[2], fields[3], fields[4])
        if (tool === "ss" && fields.length >= 5) add(fields[3], fields[4], fields[0])
      })
    }
    return { tool, exitCode, timedOut: state.timedOut, timeWaitVisible: tool !== "lsof", rows }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", kill)
    if (child.exitCode === null) child.kill()
  }
}
