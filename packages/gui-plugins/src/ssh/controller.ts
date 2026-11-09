import { NodeSocketServer } from "@effect/platform-node"
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Path,
  Predicate,
  PubSub,
  Ref,
  Schedule,
  Scope,
  Stream,
} from "effect"
import { HttpClient } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type { SshConfig, SshHttp, SshStart, SshState } from "./contract"
import { createAskpass } from "./askpass"
import { bootstrap } from "./bootstrap"
import { parseTarget, quote, runSsh, sshArgs, sshExecutable, tunnelArgs, SshFailure } from "./command"
import {
  createSshMainState,
  selectSshAuthenticating,
  selectSshServers,
  transitionSshMain,
  type SshMainEffect,
  type SshMainEvent,
} from "./main-machine"

/** Runs the SSH machine's effects and reports their outcomes back to it; the machine alone decides what is current. */
export const createSshController = Effect.fn("Ssh.controller")(function* (input: {
  version: string
  development?: boolean
  binary: string
  command?: readonly string[]
  configs: readonly SshConfig[]
  save: (configs: readonly SshConfig[]) => Effect.Effect<void, SshFailure>
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const httpClient = yield* HttpClient.HttpClient
  const parent = yield* Scope.Scope
  const lifetime = yield* Scope.fork(parent)
  const changed = yield* PubSub.unbounded<void>()
  yield* Scope.addFinalizer(lifetime, PubSub.shutdown(changed))

  const current = { machine: createSshMainState(input.configs) }
  // Handles by attempt, for stopping and answering them only.
  const connections = new Map<number, { readonly id: string; readonly fiber: Fiber.Fiber<void> }>()
  const responders = new Map<number, (prompt: string, value: string) => Effect.Effect<void>>()
  const timers = new Map<number, Fiber.Fiber<void>>()
  const waiters = new Map<number, Deferred.Deferred<SshHttp | null>>()
  const issued = { waiter: 0 }

  const dispatch = (event: SshMainEvent): Effect.Effect<void> =>
    Effect.suspend(() => {
      const transition = transitionSshMain(current.machine, event)
      const updated = transition.state !== current.machine
      current.machine = transition.state

      return Effect.forEach(transition.effects, run, { discard: true }).pipe(
        Effect.andThen(updated ? PubSub.publish(changed, undefined) : Effect.void),
        Effect.asVoid,
      )
    }).pipe(Effect.uninterruptible)

  const run = (effect: SshMainEffect): Effect.Effect<void> => {
    if (effect.type === "attempt.start") return startAttempt(effect)

    if (effect.type === "attempt.stop") {
      const connection = connections.get(effect.attempt)

      // Stopping runs its finalizers (askpass, tunnel, control master) while the machine moves on; whatever the
      // stopped attempt reports meanwhile carries its attempt and is ignored.
      return connection ? Fiber.interrupt(connection.fiber).pipe(Effect.forkIn(lifetime), Effect.asVoid) : Effect.void
    }

    if (effect.type === "attempt.respond")
      return responders.get(effect.attempt)?.(effect.promptID, effect.value) ?? Effect.void

    if (effect.type === "retry.schedule")
      return Effect.sleep(effect.delayMs).pipe(
        Effect.andThen(dispatch({ type: "retry.due", id: effect.id, attempt: effect.attempt })),
        Effect.ensuring(Effect.sync(() => timers.delete(effect.attempt))),
        Effect.forkIn(lifetime),
        Effect.map((fiber) => void timers.set(effect.attempt, fiber)),
      )

    if (effect.type === "retry.cancel") {
      const timer = timers.get(effect.attempt)

      return timer ? Fiber.interrupt(timer).pipe(Effect.asVoid) : Effect.void
    }

    if (effect.type === "health.probe")
      return checkHealth(effect.http).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.flatMap((healthy) =>
          dispatch({ type: "health.probed", id: effect.id, attempt: effect.attempt, waiter: effect.waiter, healthy }),
        ),
        Effect.forkIn(lifetime),
        Effect.asVoid,
      )

    if (effect.type === "waiters.resolve")
      return Effect.forEach(
        effect.waiters,
        (id) => {
          const waiter = waiters.get(id)
          waiters.delete(id)

          return waiter ? Deferred.succeed(waiter, effect.http) : Effect.void
        },
        { discard: true },
      )

    return input
      .save(effect.configs)
      .pipe(Effect.catch((error) => Effect.logError("Failed to save SSH servers", error)))
  }

  const startAttempt = Effect.fnUntraced(function* (effect: Extract<SshMainEffect, { type: "attempt.start" }>) {
    // The attempt this one replaces finishes stopping first.
    const previous = [...connections.values()].filter((connection) => connection.id === effect.id)

    const fiber = yield* Effect.forEach(previous, (connection) => Fiber.interrupt(connection.fiber), {
      discard: true,
    }).pipe(
      Effect.andThen(connect(effect.config, effect.attempt, effect.replace)),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.void
        const failure = SshFailure.from(Cause.squash(cause))

        return dispatch({
          type: "attempt.failed",
          id: effect.id,
          attempt: effect.attempt,
          code: failure.code,
          detail: failure.message,
        })
      }),
      Effect.ensuring(Effect.sync(() => connections.delete(effect.attempt))),
      Effect.forkIn(lifetime, { uninterruptible: false }),
    )

    connections.set(effect.attempt, { id: effect.id, fiber })
  })

  const exec = (options: Parameters<typeof runSsh>[0]) =>
    runSsh(options).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))

  const connect = Effect.fn("Ssh.connect")(function* (config: SshConfig, attempt: number, replace: boolean) {
    const id = config.id
    const target = yield* Effect.try({ try: () => parseTarget(config.target), catch: SshFailure.from })
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "oc-ssh-" })
    const control = path.join(directory, "s")

    const helper =
      input.command && input.command.length > 1 && process.platform !== "win32"
        ? path.join(directory, "askpass")
        : input.binary

    if (helper !== input.binary)
      yield* fs.writeFileString(helper, `#!/bin/sh\nexec ${input.command?.map(quote).join(" ")} "$@"\n`, {
        mode: 0o700,
      })

    if (process.platform !== "win32") {
      target.args.unshift("-o", "ControlMaster=auto", "-o", "ControlPersist=60", "-o", `ControlPath=${control}`)
      // Close only our local SSH master. The remote OpenCode service owns its
      // own lifetime and must survive disconnect, failure, and app shutdown.
      yield* Effect.addFinalizer(() =>
        exec({ args: ["-o", `ControlPath=${control}`, "-O", "exit", target.host], timeout: 2000 }).pipe(Effect.ignore),
      )
    }

    const askpass = yield* createAskpass({
      binary: helper,
      prompt: (prompt) => dispatch({ type: "prompt.received", id, attempt, prompt }),
      clear: (promptID) => dispatch({ type: "prompt.cleared", id, attempt, promptID }),
    })

    responders.set(attempt, askpass.respond)
    yield* Effect.addFinalizer(() => Effect.sync(() => responders.delete(attempt)))

    yield* Effect.gen(function* () {
      const resolved = yield* exec({ args: [...sshArgs(target), "-G", target.host], timeout: 10_000 }).pipe(
        Effect.orElseSucceed(() => ""),
      )

      const fields = new Map(
        resolved.split(/\r?\n/).map((line) => {
          const separator = line.indexOf(" ")

          return [line.slice(0, separator), line.slice(separator + 1)] as const
        }),
      )

      if (fields.has("hostname"))
        yield* dispatch({
          type: "destination.resolved",
          id,
          attempt,
          destination: `${fields.get("user") ?? ""}@${fields.get("hostname")}:${fields.get("port") ?? "22"}`,
        })

      const remote = yield* bootstrap({
        target,
        version: input.version,
        development: input.development,
        env: askpass.env,
        replace,
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      )

      const port = yield* freePort
      const http = { url: `http://127.0.0.1:${port}`, password: remote.password }

      const tunnel = yield* spawner.spawn(
        ChildProcess.make(sshExecutable(), tunnelArgs(target, port, remote), {
          env: askpass.env,
          extendEnv: true,
          windowsHide: true,
          stdin: "pipe",
          stdout: "ignore",
          killSignal: "SIGTERM",
          forceKillAfter: "2 seconds",
        }),
      )

      const detail = yield* Ref.make("")

      const stderr = yield* tunnel.stderr.pipe(
        Stream.decodeText(),
        Stream.runForEach((text) => Ref.update(detail, (tail) => (tail + text).slice(-8192))),
        Effect.forkScoped,
      )

      const closed = Effect.gen(function* () {
        const exitCode = yield* tunnel.exitCode
        yield* Fiber.join(stderr)

        return yield* Effect.fail(
          new SshFailure("connection", (yield* Ref.get(detail)) || JSON.stringify({ exitCode })),
        )
      })

      yield* waitReady(http, () => selectSshAuthenticating(current.machine, id, attempt)).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.catch(() =>
          Ref.get(detail).pipe(Effect.flatMap((detail) => Effect.fail(new SshFailure("service", detail)))),
        ),
        Effect.raceFirst(closed),
      )
      yield* dispatch({ type: "attempt.ready", id, attempt, http })
      // The tunnel closing fails the attempt, which the machine reads as a ready server that dropped.
      yield* closed
    }).pipe(Effect.raceFirst(askpass.closed))
  }, Effect.scoped)

  const close = dispatch({ type: "close" }).pipe(
    Effect.andThen(
      Effect.suspend(() =>
        Effect.forEach([...connections.values()], (connection) => Fiber.interrupt(connection.fiber), {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
    ),
    Effect.andThen(Scope.close(lifetime, Exit.void)),
  )

  yield* Effect.addFinalizer(() => close)

  const state = (owner?: number): Effect.Effect<Pick<SshState, "servers">> =>
    Effect.sync(() => ({ servers: selectSshServers(current.machine, owner) }))

  return {
    state,
    changes: (owner?: number) => Stream.fromPubSub(changed).pipe(Stream.mapEffect(() => state(owner))),
    start: (request: SshStart, owner?: number) => dispatch({ type: "start", request, owner }),
    /** Waits until the server is ready, or until main stops reconnecting it by itself (`null`). */
    resolve: Effect.fn("Ssh.resolve")(function* (id: string) {
      const waiter = ++issued.waiter
      const deferred = yield* Deferred.make<SshHttp | null>()
      waiters.set(waiter, deferred)
      yield* dispatch({ type: "resolve.requested", id, waiter })

      return yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => waiters.delete(waiter)).pipe(
            Effect.andThen(dispatch({ type: "resolve.aborted", id, waiter })),
          ),
        ),
      )
    }),
    respond: (id: string, prompt: string, value: string, owner: number) =>
      dispatch({ type: "respond", id, promptID: prompt, value, owner }),
    cancel: (id: string, owner: number) => dispatch({ type: "cancel", id, owner }),
    forget: (id: string) => dispatch({ type: "forget", id }),
    detach: (owner: number) => dispatch({ type: "window.detached", owner }),
    close,
  }
})

const freePort = Effect.gen(function* () {
  const server = yield* NodeSocketServer.make({ host: "127.0.0.1", port: 0 })

  if (Predicate.isTagged(server.address, "UnixPathAddress")) return yield* Effect.fail(new SshFailure("connection"))

  return server.address.port
}).pipe(Effect.scoped)

const waitReady = Effect.fn("Ssh.waitReady")(function* (http: SshHttp, authenticating: () => boolean) {
  const clock = { deadline: (yield* Clock.currentTimeMillis) + 30_000 }
  yield* Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis

    if (authenticating()) clock.deadline = now + 30_000

    if (now >= clock.deadline) return yield* Effect.fail(new SshFailure("service"))

    return yield* checkHealth(http)
  }).pipe(Effect.repeat({ until: (ready) => ready, schedule: Schedule.spaced(100) }))
})

const checkHealth = Effect.fn("Ssh.checkHealth")(function* (http: SshHttp) {
  const client = yield* HttpClient.HttpClient

  return yield* client
    .get(`${http.url}/api/info`, {
      headers: { authorization: `Basic ${Buffer.from(`opencode:${http.password}`).toString("base64")}` },
    })
    .pipe(
      Effect.timeout(2000),
      Effect.map((response) => response.status >= 200 && response.status < 300),
      Effect.orElseSucceed(() => false),
    )
})
