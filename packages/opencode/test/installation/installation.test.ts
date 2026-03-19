import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation/effect"

function mockHttpClient(handler: (request: Parameters<typeof HttpClientResponse.fromWeb>[0]) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function emptySpawner() {
  const spawner = ChildProcessSpawner.make(
    () =>
      Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(0),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
          getOutputFd: () => Stream.empty,
        }),
      ),
  )
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function testLayer(handler: (request: Parameters<typeof HttpClientResponse.fromWeb>[0]) => Response) {
  return Installation.layer.pipe(Layer.provide(mockHttpClient(handler)), Layer.provide(emptySpawner()))
}

describe("installation", () => {
  test("reads release version from GitHub releases", async () => {
    const layer = testLayer(
      () =>
        new Response(JSON.stringify({ tag_name: "v1.2.3" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )

    const result = await Effect.runPromise(
      Installation.Service.use((svc) => svc.latest("unknown")).pipe(Effect.provide(layer)),
    )
    expect(result).toBe("1.2.3")
  })

  test("reads scoop manifest versions", async () => {
    const layer = testLayer(
      () =>
        new Response(JSON.stringify({ version: "2.3.4" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )

    const result = await Effect.runPromise(
      Installation.Service.use((svc) => svc.latest("scoop")).pipe(Effect.provide(layer)),
    )
    expect(result).toBe("2.3.4")
  })

  test("reads chocolatey feed versions", async () => {
    const layer = testLayer(
      () =>
        new Response(JSON.stringify({ d: { results: [{ Version: "3.4.5" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )

    const result = await Effect.runPromise(
      Installation.Service.use((svc) => svc.latest("choco")).pipe(Effect.provide(layer)),
    )
    expect(result).toBe("3.4.5")
  })
})
