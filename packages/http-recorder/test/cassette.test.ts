import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { existsSync, readdirSync, writeFileSync } from "node:fs"
import type { Interaction } from "../src/cassette/model"
import { HttpRecorder } from "../src"
import { Service, hasCassetteSync, memory } from "../src/cassette/store"
import { cassetteLayer } from "../src/http/recorder"
import { failureText, post, readCassette, runFileCassette, seedCassetteDirectory, tempDirectory } from "./support"

describe("cassette", () => {
  test("UnsafeCassetteError fails the request when a recording would write a known secret", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("Bearer abcdefghijklmnopqrstuvwxyz1234"),
    })
    const url = `http://127.0.0.1:${server.port}/leaky`
    using directory = tempDirectory("http-recorder-unsafe-")

    const exit = await Effect.runPromise(
      Effect.exit(
        post(url, { ok: true }).pipe(
          Effect.provide(
            cassetteLayer("unsafe-record", {
              directory: directory.path,
              mode: "record",
            }),
          ),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(failureText(exit)).toContain("contains possible secrets")
    expect(existsSync(`${directory.path}/unsafe-record.json`)).toBe(false)
  })

  test("failed memory appends leave cassette state unchanged", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const cassette = yield* Service
        const interaction: Interaction = {
          transport: "http",
          request: {
            method: "GET",
            url: "https://example.test",
            headers: {},
            body: "",
          },
          response: { status: 200, headers: {}, body: "safe" },
        }
        yield* cassette.append("transactional", interaction)
        yield* cassette
          .append("transactional", {
            ...interaction,
            response: {
              ...interaction.response,
              body: "Bearer abcdefghijklmnopqrstuvwxyz1234",
            },
          })
          .pipe(Effect.flip)

        expect(yield* cassette.read("transactional")).toEqual([interaction])
      }).pipe(Effect.provide(memory())),
    )
  })

  test("concurrent file appends preserve every interaction", async () => {
    using directory = tempDirectory("http-recorder-concurrent-")
    await runFileCassette(
      directory.path,
      Effect.gen(function* () {
        const cassette = yield* Service
        yield* Effect.forEach(
          Array.from({ length: 20 }, (_, index) => index),
          (index) =>
            cassette.append("concurrent", {
              transport: "http",
              request: {
                method: "GET",
                url: `https://example.test/${index}`,
                headers: {},
                body: "",
              },
              response: { status: 200, headers: {}, body: String(index) },
            }),
          { concurrency: "unbounded" },
        )
      }),
    )

    const cassette = readCassette(`${directory.path}/concurrent.json`)
    expect(cassette.interactions).toHaveLength(20)
    expect(readdirSync(directory.path).filter((file) => file.endsWith(".tmp"))).toEqual([])
  })

  test("generated metadata cannot be overridden", async () => {
    using directory = tempDirectory("http-recorder-metadata-")
    await runFileCassette(
      directory.path,
      Effect.gen(function* () {
        const cassette = yield* Service
        yield* cassette.append(
          "metadata",
          {
            transport: "http",
            request: { method: "GET", url: "https://example.test", headers: {}, body: "" },
            response: { status: 200, headers: {}, body: "safe" },
          },
          { name: "wrong", recordedAt: "wrong" },
        )
      }),
    )

    const cassette = readCassette(`${directory.path}/metadata.json`)
    expect(cassette.metadata?.name).toBe("metadata")
    expect(cassette.metadata?.recordedAt).not.toBe("wrong")
  })

  test("reports malformed cassettes as invalid", async () => {
    using directory = tempDirectory("http-recorder-invalid-")
    writeFileSync(`${directory.path}/invalid.json`, "{not-json")

    const error = await runFileCassette(
      directory.path,
      Effect.gen(function* () {
        const cassette = yield* Service
        return yield* cassette.read("invalid").pipe(Effect.flip)
      }),
    )

    expect(error._tag).toBe("InvalidCassetteError")
  })

  test("rejects cassette paths outside the recordings directory", () => {
    using directory = tempDirectory("http-recorder-path-")
    expect(() => hasCassetteSync("../outside", { directory: directory.path })).toThrow("Invalid cassette name")
    expect(() => hasCassetteSync("C:\\outside", { directory: directory.path })).toThrow("Invalid cassette name")
  })

  test("public cassette lifecycle helpers check and remove a recording", async () => {
    using directory = tempDirectory("http-recorder-lifecycle-")
    const options = { directory: directory.path }
    expect(HttpRecorder.hasCassetteSync("nested/example", options)).toBe(false)

    await seedCassetteDirectory(directory.path, "nested/example", [
      {
        transport: "http",
        request: { method: "GET", url: "https://example.test", headers: {}, body: "" },
        response: { status: 200, headers: {}, body: "safe" },
      },
    ])
    expect(HttpRecorder.hasCassetteSync("nested/example", options)).toBe(true)

    HttpRecorder.removeCassetteSync("nested/example", options)
    expect(HttpRecorder.hasCassetteSync("nested/example", options)).toBe(false)
    expect(() => HttpRecorder.removeCassetteSync("nested/example", options)).not.toThrow()
    expect(() => HttpRecorder.removeCassetteSync("../outside", options)).toThrow("Invalid cassette name")
  })

  test("Cassette.list enumerates recorded cassette names", async () => {
    using directory = tempDirectory("http-recorder-list-")
    await seedCassetteDirectory(directory.path, "alpha/one", [
      {
        transport: "http",
        request: {
          method: "GET",
          url: "https://x.test/a",
          headers: {},
          body: "",
        },
        response: { status: 200, headers: {}, body: "a" },
      },
    ])
    await seedCassetteDirectory(directory.path, "beta", [
      {
        transport: "http",
        request: {
          method: "GET",
          url: "https://x.test/b",
          headers: {},
          body: "",
        },
        response: { status: 200, headers: {}, body: "b" },
      },
    ])

    const names = await runFileCassette(
      directory.path,
      Effect.gen(function* () {
        const cassette = yield* Service
        return yield* cassette.list()
      }),
    )
    expect(names).toEqual(["alpha/one", "beta"])
  })
})
