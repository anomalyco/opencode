import { NodeFileSystem } from "@effect/platform-node"
import { OpenTunnelStorage } from "@opentunnel/client/effect"
import { Global } from "@opencode/util/global"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, FileSystem, Option } from "effect"
import { TestClock } from "effect/testing"
import path from "node:path"
import pair from "../src/commands/handlers/pair"
import { ServiceConfig } from "../src/services/service-config"
import { withEnv } from "../../core/test/fixture/env"
import { advance } from "../../core/test/lib/clock"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeFileSystem.layer)

it.effect("remote pairing explains how to recover when the saved route is not running", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-pair-retry-" })
    const requests: string[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            requests.push(new URL(request.url).pathname)
            return Response.json({ version: "local", pid: process.pid, urls: [new URL(request.url).origin] })
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    yield* fs.makeDirectory(path.join(root, "state"))
    yield* fs.writeFileString(
      path.join(root, "state", ServiceConfig.filename()),
      JSON.stringify({ version: "local", pid: process.pid, url: server.url.href }),
    )
    yield* withEnv({ XDG_DATA_HOME: root }, () =>
      Effect.gen(function* () {
        yield* OpenTunnelStorage.xdg().save("default", {
          id: "test-tunnel",
          hostname: "test.example.com",
          token: "test-token",
          privateKey: "test-key",
          certificate: "test-certificate",
          chain: "",
          certificateExpiry: new Date("2099-01-01T00:00:00Z"),
        })
        yield* ServiceConfig.remote()
        const saved = yield* ServiceConfig.read()
        const running = yield* pair({ remote: true, yes: true, url: Option.none() }).pipe(
          Effect.exit,
          Effect.forkChild({ startImmediately: true }),
        )
        yield* advance(() => requests.length >= 2)
        yield* TestClock.adjust("3 minutes")
        const result = yield* Fiber.join(running)
        const error = Exit.match(result, { onFailure: Cause.pretty, onSuccess: () => "" })
        expect(error).toContain("Timed out waiting for the remote tunnel")
        expect(error).toContain("run `opencode service restart`, then `opencode pair --remote`")
        expect(requests.every((pathname) => pathname === "/api/info")).toBe(true)
        expect(yield* ServiceConfig.read()).toEqual(saved)
      }).pipe(
        Effect.provideService(
          Global.Service,
          Global.make({ config: path.join(root, "config"), state: path.join(root, "state") }),
        ),
      ),
    )
  }),
)
