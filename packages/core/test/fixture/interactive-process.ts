import { Deferred, Duration, Effect, Exit, Layer, Queue, Stream } from "effect"
import { InteractiveProcess } from "@opencode-ai/core/tool/interactive/runtime"

/**
 * Scripted fake for the interactive process runtime port (spec R34): every
 * child replays `(bytes, delay)` output events, reacts to stdin writes, and
 * signals exit — so settle boundaries (exit / quiescence / cap / kill) are
 * deterministic without real PTYs or wall-clock sensitivity beyond the
 * quiet windows the tests inject.
 */

export interface Step {
  /** Bytes appended to the merged output stream. */
  readonly bytes?: string
  /** Delay before the step runs, in ms (live clock; keep gaps well above the injected quiet window). */
  readonly delayMs?: number
  /** Exit code to complete the child with after the step. */
  readonly exit?: number
  /** Fatal signal to complete the child with instead of an exit code. */
  readonly signal?: string
}

export interface FakeChild {
  readonly pgid: number
  /** Exact stdin bytes appended so far, in write order. */
  readonly writes: ReadonlyArray<string>
  /** Every chunk emitted on the output stream, in emission order. */
  readonly emitted: ReadonlyArray<string>
  /** How many times EOF (^D) was signalled. */
  readonly eofs: ReadonlyArray<boolean>
  /** How many times the child was killed. */
  readonly kills: ReadonlyArray<boolean>
  get exited(): boolean
  /** Emit more output from the test; awaited inline so emissions sequence deterministically. */
  readonly emit: (bytes: string, delayMs?: number) => Effect.Effect<void>
  /** Complete the child's exit from the test (default exit code 0). */
  readonly finish: (status?: InteractiveProcess.ExitStatus) => Effect.Effect<void>
}

export interface FakeRuntime {
  readonly layer: Layer.Layer<InteractiveProcess.Service>
  readonly pty: boolean
  readonly spawned: ReadonlyArray<{
    readonly command: string
    readonly cwd: string
    readonly shell?: string
    readonly child: FakeChild
  }>
}

export interface FakeOptions {
  /** Reported by the port; tests never branch on it (the store may, spec R22). */
  readonly pty?: boolean
  /** When set, every spawn fails with this cause (spec R8 spawn-failure path). */
  readonly failSpawn?: unknown
  /** Output schedule replayed by each spawned child. */
  readonly schedule?: ReadonlyArray<Step>
  /** Reaction to one stdin write: emit bytes and/or complete the exit. */
  readonly respond?: (input: string) => Step | undefined
}

export const fakeProcess = (options: FakeOptions = {}): FakeRuntime => {
  const pty = options.pty ?? true
  const spawned: Array<{
    readonly command: string
    readonly cwd: string
    readonly shell?: string
    readonly child: FakeChild
  }> = []
  let nextPgid = 4200

  const spawn = options.failSpawn !== undefined
    ? () =>
        Effect.fail(
          new InteractiveProcess.SpawnError({
            command: "<fake>",
            cause: options.failSpawn instanceof Error ? options.failSpawn : new Error(String(options.failSpawn)),
          }),
        )
    : (request: InteractiveProcess.SpawnRequest) =>
        Effect.gen(function* () {
          const out = yield* Queue.unbounded<Uint8Array>()
          const exit = yield* Deferred.make<InteractiveProcess.ExitStatus>()
          const pgid = nextPgid++
          const state = {
            writes: [] as string[],
            emitted: [] as string[],
            eofs: [] as boolean[],
            kills: [] as boolean[],
            exited: false,
          }

          const offer = (bytes: string) =>
            Effect.gen(function* () {
              state.emitted.push(bytes)
              yield* Queue.offer(out, Buffer.from(bytes, "utf8"))
            })

          const completeExit = (status: InteractiveProcess.ExitStatus) =>
            Effect.gen(function* () {
              state.exited = true
              yield* Deferred.done(exit, Exit.succeed(status))
              yield* Queue.shutdown(out)
            })

          const child: FakeChild = {
            pgid,
            writes: state.writes,
            emitted: state.emitted,
            eofs: state.eofs,
            kills: state.kills,
            get exited() {
              return state.exited
            },
            emit: (bytes, delayMs) =>
              Effect.gen(function* () {
                if (delayMs) yield* Effect.sleep(Duration.millis(delayMs))
                yield* offer(bytes)
              }),
            finish: (status) => completeExit(status ?? { exitCode: 0 }),
          }

          yield* Effect.gen(function* () {
            for (const step of options.schedule ?? []) {
              if (step.delayMs) yield* Effect.sleep(Duration.millis(step.delayMs))
              if (step.bytes !== undefined) yield* offer(step.bytes)
              if (step.exit !== undefined) yield* completeExit({ exitCode: step.exit })
              else if (step.signal !== undefined) yield* completeExit({ signal: step.signal })
            }
            yield* Deferred.await(exit)
          }).pipe(Effect.forkDetach)

          spawned.push({ command: request.command, cwd: request.cwd, shell: request.shell, child })

          return {
            pgid,
            output: Stream.fromQueue(out),
            write: (bytes) =>
              Effect.gen(function* () {
                state.writes.push(bytes)
                const reaction = options.respond?.(bytes)
                if (reaction?.bytes !== undefined) yield* offer(reaction.bytes)
                if (reaction?.exit !== undefined) yield* completeExit({ exitCode: reaction.exit })
                else if (reaction?.signal !== undefined) yield* completeExit({ signal: reaction.signal })
              }),
            signalEof: () =>
              Effect.sync(() => {
                state.eofs.push(true)
              }),
            exit: Deferred.await(exit),
            kill: () =>
              Effect.gen(function* () {
                state.kills.push(true)
                yield* completeExit({ signal: "SIGKILL" })
              }),
          } satisfies InteractiveProcess.Child
        })

  const layer = Layer.succeed(
    InteractiveProcess.Service,
    InteractiveProcess.Service.of({ pty, spawn }),
  )
  return { layer, pty, spawned }
}
