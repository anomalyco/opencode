import { describe, expect, test } from "bun:test"
import photon from "@silvia-odwyer/photon-node"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { Deferred, Effect, Exit, Fiber, Logger, Ref } from "effect"
import { Photon } from "@opencode/core/image/photon"
import { it } from "./lib/effect"

const limits = { autoResize: true, maxWidth: 2_000, maxHeight: 2_000, maxBase64Bytes: 5 * 1024 * 1024 }

// 2400×1200 with a translucent right half: it resizes, tries PNG first, then lands on JPEG.
const content = (() => {
  const width = 2400
  const height = 1200
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      pixels[i] = (x * 7 + y * 3) & 255
      pixels[i + 1] = (x ^ y) & 255
      pixels[i + 2] = (x * y) & 255
      pixels[i + 3] = x < 1200 ? 255 : y & 255
    }
  const source = new photon.PhotonImage(pixels, width, height)
  const bytes = source.get_bytes()
  source.free()
  return {
    uri: "file:///fixture.png",
    content: Buffer.from(bytes).toString("base64"),
    encoding: "base64" as const,
    mime: "image/png",
  }
})()

// The output of the in-process resizer before it moved to a worker.
const expected = { mime: "image/jpeg", sha256: "356a08f3cd35a6277f6a066ab12141d26212a93d8ec5f53c66af7b9c5844db95" }
const digest = (result: { mime: string; content: string }) => ({
  mime: result.mime,
  sha256: createHash("sha256").update(result.content).digest("hex"),
})

const counted = (spawned: Ref.Ref<number>, url?: (count: number) => URL | undefined) =>
  Ref.getAndUpdate(spawned, (count) => count + 1).pipe(Effect.flatMap((count) => Photon.spawnWorker(url?.(count))))

// Runs the fixture in its own process and returns how long the process took to
// exit after its work was done.
const exitLag = async (mode: string) => {
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("./fixture/photon-exit.ts", import.meta.url)), mode],
    {
      stdout: "pipe",
      stderr: "inherit",
    },
  )
  const timeout = setTimeout(() => child.kill(), 20_000)
  const output = await new Response(child.stdout).text()
  const code = await child.exited
  clearTimeout(timeout)
  expect(code).toBe(0)
  return Date.now() - Number(output.trim())
}

describe("Image.Photon", () => {
  it.live("resizes in a worker to the same bytes as before", () =>
    Effect.gen(function* () {
      const normalize = Photon.makeWith(Photon.spawnWorker())
      expect(digest(yield* normalize("fixture.png", content, limits))).toEqual(expected)
    }),
  )

  it.live("shares one resizer across the process", () =>
    Effect.gen(function* () {
      expect(yield* Photon.make).toBe(yield* Photon.make)
    }),
  )

  it.live("falls back to resizing in-process when the worker cannot start, warning once", () => {
    const warnings: unknown[] = []
    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn") warnings.push(message)
    })
    return Effect.gen(function* () {
      const normalize = Photon.makeWith(Photon.spawnWorker(new URL("./missing-photon-worker.js", import.meta.url)))
      expect(digest(yield* normalize("fixture.png", content, limits))).toEqual(expected)
      expect(digest(yield* normalize("fixture.png", content, limits))).toEqual(expected)
      expect(warnings).toHaveLength(1)
    }).pipe(Effect.provide(Logger.layer([logger])))
  })

  it.live("queues concurrent calls on one worker", () =>
    Effect.gen(function* () {
      const spawned = yield* Ref.make(0)
      const normalize = Photon.makeWith(counted(spawned))
      const reference = Photon.makeWith(Photon.spawnWorker(new URL("./missing.js", import.meta.url)))
      const sizes = [400, 300, 200].map((maxWidth) => ({ ...limits, maxWidth, maxHeight: maxWidth }))
      const results = yield* Effect.forEach(sizes, (size) => normalize("fixture.png", content, size), {
        concurrency: "unbounded",
      })
      expect(yield* Ref.get(spawned)).toBe(1)
      expect(new Set(results.map((result) => result.content)).size).toBe(3)
      for (const [index, size] of sizes.entries())
        expect(digest(results[index]!)).toEqual(digest(yield* reference("fixture.png", content, size)))
    }),
  )

  it.live("fails only the request a crash interrupts, then runs the queue on a fresh worker", () =>
    Effect.gen(function* () {
      const spawned = yield* Ref.make(0)
      const normalize = Photon.makeWith(
        counted(spawned, (count) =>
          count === 0 ? new URL("./fixture/photon-crash-worker.ts", import.meta.url) : undefined,
        ),
      )
      const exits = yield* Effect.forEach(
        [0, 1, 2],
        () => normalize("fixture.png", content, limits).pipe(Effect.exit),
        { concurrency: "unbounded" },
      )
      expect(Exit.hasDies(exits[0]!)).toBe(true)
      for (const exit of exits.slice(1)) expect(Exit.isSuccess(exit) && digest(exit.value)).toEqual(expected)
      expect(yield* Ref.get(spawned)).toBe(2)
    }),
  )

  it.live("terminates a worker when interrupted between acquiring it and sending the request", () =>
    Effect.gen(function* () {
      const exited = yield* Deferred.make<void>()
      // Interrupts the caller as the new worker is stored, the last step before the request.
      const normalize = Photon.makeWith(
        Effect.withFiber((caller) =>
          Photon.spawnWorker().pipe(
            Effect.tap((worker) =>
              Effect.sync(() => {
                worker.once("exit", () => Deferred.doneUnsafe(exited, Effect.void))
                const unref = worker.unref.bind(worker)
                worker.unref = () => {
                  worker.unref = unref
                  unref()
                  caller.interruptUnsafe()
                }
              }),
            ),
          ),
        ),
      )
      const call = yield* Effect.forkChild(normalize("fixture.png", content, limits))
      expect(Exit.hasInterrupts(yield* Fiber.await(call))).toBe(true)
      yield* Deferred.await(exited).pipe(Effect.timeout("3 seconds"))
    }),
  )

  it.live("terminates the worker once it has been idle", () =>
    Effect.gen(function* () {
      const spawned = yield* Ref.make(0)
      const exited = yield* Deferred.make<void>()
      const normalize = Photon.makeWith(
        counted(spawned).pipe(
          Effect.tap((worker) =>
            Effect.sync(() => worker.once("exit", () => Deferred.doneUnsafe(exited, Effect.void))),
          ),
        ),
        200,
      )
      const small = { ...limits, maxWidth: 200, maxHeight: 200 }
      yield* normalize("fixture.png", content, small)
      yield* normalize("fixture.png", content, small)
      expect(yield* Ref.get(spawned)).toBe(1)
      expect(yield* Deferred.isDone(exited)).toBe(false)

      yield* Deferred.await(exited)

      yield* normalize("fixture.png", content, small)
      expect(yield* Ref.get(spawned)).toBe(2)
    }),
  )

  test("an idle worker does not keep the process alive", async () => {
    expect(await exitLag("resize")).toBeLessThan(3_000)
  }, 30_000)

  test("terminates a worker whose startup is interrupted", async () => {
    expect(await exitLag("abandon-spawn")).toBeLessThan(3_000)
  }, 30_000)
})
