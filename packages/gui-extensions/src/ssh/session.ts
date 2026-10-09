import { Cause, Deferred, Effect, Fiber, Queue, Semaphore, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { randomUUID } from "node:crypto"
import { createServer, connect, type AddressInfo, type Socket } from "node:net"
import { commandFailureDetail, parseTarget, sshArgs, sshExecutable, SshFailure } from "./command"

// Runs every bootstrap step and the HTTP forward over one SSH connection, so the
// user authenticates once per attempt on every platform, including Windows
// OpenSSH, which has no connection multiplexing.
//
// `sh -l -s` parses this group before running it, and the client sends no frame
// until the ready marker, so the shell has nothing buffered past the group. Each
// frame is `<id> <script bytes> <stdin bytes>\n` followed by both payloads; `dd`
// with `count=1` never reads past the frame. The reply is a result header and
// the step's stdout and stderr.
export function driver(nonce: string) {
  return `{
dir=$(mktemp -d) || exit 1
trap 'rm -rf "$dir"' EXIT
trap 'exit 1' HUP INT TERM PIPE
take() {
  : > "$2"
  size=0
  while [ "$size" -lt "$1" ]; do
    chunk=$(($1 - size))
    if [ "$chunk" -gt 65536 ]; then chunk=65536; fi
    dd bs="$chunk" count=1 2>/dev/null >> "$2" || return 1
    next=$(($(wc -c < "$2")))
    if [ "$next" -eq "$size" ]; then return 1; fi
    size=$next
  done
}
printf '\\nOPENCODE_SSH_READY_${nonce}\\n'
while read -r id script input; do
  take "$script" "$dir/script" && take "$input" "$dir/input" || exit 1
  ( . "$dir/script" ) < "$dir/input" > "$dir/stdout" 2> "$dir/stderr"
  printf 'OPENCODE_SSH_RESULT %s %s %s %s\\n' "$id" "$?" "$(($(wc -c < "$dir/stdout")))" "$(($(wc -c < "$dir/stderr")))"
  cat "$dir/stdout" "$dir/stderr"
  rm -f "$dir/script" "$dir/input" "$dir/stdout" "$dir/stderr"
done
exit 0
}
`
}

export function sessionArgs(target: ReturnType<typeof parseTarget>, socks: number) {
  // Our own process must hold the forward: a ControlMaster from the user's
  // config could keep it alive in the background after this attempt ends.
  return [
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPath=none",
    ...sshArgs(target),
    "-o",
    "ExitOnForwardFailure=yes",
    "-D",
    `127.0.0.1:${socks}`,
    target.host,
    "sh -l -s",
  ]
}

type Result = { id: number; code: number; stdout: string; stderr: string }

export const openSession = Effect.fn("Ssh.session")(function* (input: {
  target: ReturnType<typeof parseTarget>
  env: NodeJS.ProcessEnv
  socks: number
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const nonce = randomUUID().replaceAll("-", "")
  const marker = Buffer.from(`\nOPENCODE_SSH_READY_${nonce}\n`)
  const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const results = yield* Queue.unbounded<Result, SshFailure>()
  const ready = yield* Deferred.make<void, SshFailure>()
  const exited = yield* Deferred.make<never, SshFailure>()
  const steps = yield* Semaphore.make(1)
  const state = { buffer: Buffer.alloc(0), ready: false, id: 0, stderr: "" }
  yield* Effect.addFinalizer(() => Queue.end(stdin))
  yield* Queue.offer(stdin, Buffer.from(driver(nonce)))

  const child = yield* spawner.spawn(
    ChildProcess.make(sshExecutable(), sessionArgs(input.target, input.socks), {
      env: input.env,
      extendEnv: true,
      windowsHide: true,
      killSignal: "SIGTERM",
      forceKillAfter: "2 seconds",
      stdin: { stream: Stream.fromQueue(stdin), endOnDone: true },
    }),
  )

  const deliver = Effect.fnUntraced(function* (chunk: Uint8Array) {
    state.buffer = Buffer.concat([state.buffer, chunk])

    if (!state.ready) {
      const at = state.buffer.indexOf(marker)

      // Login shells may print before the driver starts. Keep only a possible
      // partial marker.
      if (at === -1) {
        state.buffer = state.buffer.subarray(-marker.length)

        return
      }

      state.buffer = state.buffer.subarray(at + marker.length)
      state.ready = true
      yield* Deferred.succeed(ready, undefined)
    }

    while (true) {
      const end = state.buffer.indexOf(10)

      if (end === -1) return
      const header = /^OPENCODE_SSH_RESULT (\d+) (\d+) (\d+) (\d+)$/.exec(state.buffer.subarray(0, end).toString())

      if (!header) return yield* Effect.fail(new SshFailure("connection", "Unexpected remote shell output"))
      const stdout = end + 1 + Number(header[3])
      const stderr = stdout + Number(header[4])

      if (state.buffer.length < stderr) return
      yield* Queue.offer(results, {
        id: Number(header[1]),
        code: Number(header[2]),
        stdout: state.buffer.subarray(end + 1, stdout).toString(),
        stderr: state.buffer.subarray(stdout, stderr).toString(),
      })
      state.buffer = state.buffer.subarray(stderr)
    }
  })

  const stderr = yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((text) => Effect.sync(() => (state.stderr = (state.stderr + text).slice(-16_384)))),
    Effect.forkScoped,
  )

  // Every step fails once the connection closes or its output stops following
  // the protocol; an SSH failure carries ssh's own diagnostics.
  yield* child.stdout.pipe(
    Stream.runForEach(deliver),
    Effect.matchEffect({
      onFailure: (error) => Effect.succeed(SshFailure.from(error)),
      onSuccess: () =>
        Effect.gen(function* () {
          const code = yield* child.exitCode.pipe(Effect.orElseSucceed(() => null))
          yield* Fiber.join(stderr).pipe(Effect.ignore)

          return new SshFailure("connection", commandFailureDetail(code, { stdout: "", stderr: state.stderr }))
        }),
    }),
    Effect.flatMap((failure) =>
      Effect.all([Deferred.fail(ready, failure), Queue.fail(results, failure), Deferred.fail(exited, failure)]),
    ),
    Effect.forkScoped,
  )

  return {
    /** Fails with the SSH diagnostic once the connection closes. */
    closed: Deferred.await(exited),
    /** The connection's latest SSH diagnostics, for failures it did not cause. */
    detail: Effect.sync(() => state.stderr),
    /** Runs one remote shell script and returns its stdout, like `ssh host sh -l -s`. */
    run: (script: string, data?: Uint8Array) =>
      steps
        .withPermit(
          Effect.gen(function* () {
            yield* Deferred.await(ready)
            const id = ++state.id
            const body = Buffer.from(script)
            yield* Queue.offer(
              stdin,
              Buffer.concat([
                Buffer.from(`${id} ${body.length} ${data?.length ?? 0}\n`),
                body,
                data ?? Buffer.alloc(0),
              ]),
            )
            const result = yield* Queue.take(results)

            if (result.id !== id)
              return yield* Effect.fail(new SshFailure("connection", "Unexpected remote shell output"))

            if (result.code !== 0)
              return yield* Effect.fail(new SshFailure("connection", commandFailureDetail(result.code, result)))

            return result.stdout
          }),
        )
        .pipe(
          Effect.timeoutOrElse({
            duration: "10 minutes",
            orElse: () => Effect.fail(new SshFailure("connection", "Remote command timed out")),
          }),
        ),
  }
})

// Serves the remote OpenCode service on a local port through the session's
// SOCKS forward, so the forward needs no port before bootstrap finds the service.
export const forward = Effect.fn("Ssh.forward")(function* (socks: number, remote: { host: string; port: number }) {
  const host = Buffer.from(remote.host.replace(/^\[(.*)\]$/, "$1"))

  const request = Buffer.concat([
    Buffer.from([5, 1, 0, 3, host.length]),
    host,
    Buffer.from([remote.port >> 8, remote.port & 255]),
  ])

  const sockets = new Set<Socket>()

  const server = createServer((client) => {
    const upstream = connect(socks, "127.0.0.1")
    const state = { pending: Buffer.alloc(0), method: false }

    const close = () => {
      client.destroy()
      upstream.destroy()
      sockets.delete(client)
      sockets.delete(upstream)
    }

    sockets.add(client).add(upstream)
    client.pause()
    client.on("error", close).on("close", close)
    upstream.on("error", close).on("close", close)
    upstream.on("connect", () => upstream.write(Buffer.from([5, 1, 0])))

    const handshake = (chunk: Buffer) => {
      state.pending = Buffer.concat([state.pending, chunk])

      if (!state.method) {
        if (state.pending.length < 2) return

        if (state.pending[0] !== 5 || state.pending[1] !== 0) return close()
        state.method = true
        state.pending = state.pending.subarray(2)
        upstream.write(request)
      }

      // OpenSSH always answers CONNECT with an IPv4 address: 10 bytes.
      if (state.pending.length < 10) return

      if (state.pending[0] !== 5 || state.pending[1] !== 0 || state.pending[3] !== 1) return close()
      upstream.off("data", handshake)

      if (state.pending.length > 10) client.write(state.pending.subarray(10))
      client.pipe(upstream)
      upstream.pipe(client)
      client.resume()
    }

    upstream.on("data", handshake)
  })

  yield* Effect.acquireRelease(
    Effect.callback<void, SshFailure>((resume) => {
      server.once("error", (error) => resume(Effect.fail(SshFailure.from(error))))
      server.listen(0, "127.0.0.1", () => resume(Effect.void))
    }),
    () =>
      Effect.sync(() => {
        server.close()
        sockets.forEach((socket) => socket.destroy())
      }),
  )

  // SAFETY: a TCP server listening on a host and port reports an AddressInfo.
  return (server.address() as AddressInfo).port
})
