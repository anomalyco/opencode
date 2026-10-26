export * as Photon from "./photon.js"

import { Effect, Exit, Schema, Semaphore } from "effect"
import type { Worker } from "node:worker_threads"
import type { FileSystem } from "../filesystem.js"
import { DecodeError, ResizerUnavailableError, SizeError, type Limits } from "../image.js"
import { PhotonNormalize } from "./photon-normalize.js"
import type { Reply, Request } from "./photon-worker.js"

// The worker holds photon's wasm heap (hundreds of MB after a large image);
// terminating it when idle returns that memory to the OS.
const WORKER_IDLE_MILLIS = 10_000

export class WorkerUnavailableError extends Schema.TaggedError<WorkerUnavailableError>()(
  "Image.Photon.WorkerUnavailableError",
  { cause: Schema.Defect() },
) {}

// Resolves once the worker has loaded photon. Anything else (no worker_threads,
// a bundle without the worker entry, photon failing to load) means the worker
// is unavailable, and a worker that never got ready is terminated.
export const spawnWorker = (url?: URL) =>
  Effect.tryPromise({
    try: async (signal) => {
      const { Worker } = await import("node:worker_threads")
      const worker = new Worker(url ?? new URL("./photon-worker.js", import.meta.url))
      // Only fires on interruption, which discards the worker even if it just got ready.
      const abort = () => void worker.terminate()
      if (signal.aborted) abort()
      signal.addEventListener("abort", abort, { once: true })
      try {
        await new Promise<void>((resolve, reject) => {
          worker.once("message", () => resolve())
          worker.once("error", reject)
          worker.once("exit", (code) => reject(new Error(`photon worker exited with code ${code}`)))
        })
      } catch (cause) {
        void worker.terminate()
        throw cause
      }
      return worker
    },
    catch: (cause) => new WorkerUnavailableError({ cause }),
  })

// A panic or an unreadable reply fails the request the way an in-process
// photon throw would. The worker is only ref'd while a request is pending.
const request = (worker: Worker, content: PhotonNormalize.Content, limits: Readonly<Limits>) =>
  Effect.callback<PhotonNormalize.Result>((resume) => {
    const settle = (effect: Effect.Effect<PhotonNormalize.Result>) => {
      cleanup()
      resume(effect)
    }
    const reply = (reply: Reply) => {
      if (reply._tag === "Done") settle(Effect.succeed(reply.result))
    }
    const error = (error: Error) => settle(Effect.die(new Error(error.message)))
    const exit = (code: number) => settle(Effect.die(new Error(`photon worker exited with code ${code}`)))
    const cleanup = () => {
      worker.off("message", reply).off("messageerror", error).off("error", error).off("exit", exit)
      worker.unref()
    }
    worker.on("message", reply).on("messageerror", error).on("error", error).on("exit", exit)
    worker.ref()
    worker.postMessage({ content, limits } satisfies Request)
    return Effect.sync(cleanup)
  })

export function makeWith(spawn: Effect.Effect<Worker, WorkerUnavailableError>, idleMillis = WORKER_IDLE_MILLIS) {
  // One request at a time, so a worker never holds a queue that a panic could
  // take down with it, and a stale reply can never answer the next request.
  const permit = Semaphore.makeUnsafe(1)
  let current: Worker | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let useWorker = true
  let photon: Promise<PhotonNormalize.Photon> | undefined

  const discard = (worker: Worker) => {
    if (current === worker) current = undefined
    void worker.terminate()
  }
  const track = (worker: Worker) =>
    Effect.sync(() => {
      current = worker
      worker.unref()
      // A worker that dies while idle is replaced by the next call.
      const forget = () => {
        if (current === worker) current = undefined
      }
      worker.on("error", forget).once("exit", forget)
      return worker
    })
  // Interruptible only while spawning and while the request runs, so from the
  // moment a worker exists it is either tracked with an idle timer or discarded.
  // A failed or interrupted request takes its worker down: the heap may be
  // poisoned, or the worker is still busy with a reply nobody will read.
  const inWorker = (content: PhotonNormalize.Content, limits: Readonly<Limits>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        clearTimeout(idle)
        const worker = current ?? (yield* restore(spawn).pipe(Effect.flatMap(track)))
        return yield* restore(request(worker, content, limits)).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isFailure(exit)) return discard(worker)
              // Unref'd so an idle worker never holds the process open.
              idle = setTimeout(() => discard(worker), idleMillis)
              idle.unref()
            }),
          ),
        )
      }),
    ).pipe(permit.withPermits(1))
  const inProcess = (content: PhotonNormalize.Content, limits: Readonly<Limits>) =>
    Effect.tryPromise({
      try: () => (photon ??= PhotonNormalize.load()),
      catch: () => new ResizerUnavailableError(),
    }).pipe(Effect.map((photon) => PhotonNormalize.normalize(photon, content, limits)))

  return Effect.fn("Image.Photon.normalize")(function* (
    resource: string,
    content: FileSystem.Content & { readonly encoding: "base64" },
    limits: Readonly<Limits>,
  ) {
    // Fail typed before touching URLs, workers or module loading: workerd has
    // no photon artifact, and a throw outside the typed path (its undefined
    // import.meta.url was one) turns any image-bearing prompt into a 500.
    if (!PhotonNormalize.available) return yield* new ResizerUnavailableError()
    const result = useWorker
      ? yield* inWorker(content, limits).pipe(
          Effect.catchTag("Image.Photon.WorkerUnavailableError", (error) => {
            if (!useWorker) return inProcess(content, limits)
            useWorker = false
            return Effect.logWarning("photon worker unavailable, resizing images on the main thread", {
              cause: error.cause,
            }).pipe(Effect.andThen(inProcess(content, limits)))
          }),
        )
      : yield* inProcess(content, limits)
    switch (result._tag) {
      case "Unchanged":
        return content
      case "Content":
        return result.content
      case "DecodeError":
        return yield* new DecodeError({ resource })
      case "SizeError": {
        const { _tag, ...size } = result
        return yield* new SizeError({ resource, ...size })
      }
    }
  })
}

// One worker per process, shared by every Location.
export const make = Effect.succeed(makeWith(spawnWorker()))
