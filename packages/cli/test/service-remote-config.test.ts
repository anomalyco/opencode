import { NodeFileSystem } from "@effect/platform-node"
import { OpenTunnelStorage } from "@opentunnel/client/effect"
import { Global } from "@opencode/util/global"
import { expect } from "bun:test"
import { Effect, Exit, FileSystem } from "effect"
import { FetchHttpClient } from "effect/http"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeFileSystem.layer)

it.live("remote settings are persisted before stopping the service", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-remote-config-" })
    const config = path.join(root, "config", ServiceConfig.filename())
    const registration = path.join(root, "state", ServiceConfig.filename())
    const observed: ServiceConfig.Info[] = []
    const requests: string[] = []
    const outbound = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        requests.push(String(input))
        return Response.json({
          id: "test-certificate",
          state: { type: "ready", certificate: "test-certificate", chain: "", expiry: "2099-01-01T00:00:00Z" },
        })
      },
      { preconnect: fetch.preconnect },
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
        yield* ServiceConfig.acceptRemote()
        yield* ServiceConfig.set("remote", "true")
        expect(requests).toEqual(["https://opentunnel.xyz/api/tunnel/test-tunnel/certificate"])
        expect(observed).toHaveLength(1)
        expect(observed[0]?.remote?.route).toMatch(/^[0-9a-f]{16}$/)
        expect(observed[0]).toEqual(yield* ServiceConfig.read())

        yield* ServiceConfig.set("remote", "false")
        expect(observed[1]).toEqual({ remoteAccepted: true })

        yield* ServiceConfig.remote()
        yield* ServiceConfig.unset("remote")
        expect(observed[2]).toEqual({ remoteAccepted: true })

        const failed = yield* ServiceConfig.set("remote", "true").pipe(
          Effect.provideService(
            FetchHttpClient.Fetch,
            Object.assign(async () => new Response(null, { status: 401 }), { preconnect: fetch.preconnect }),
          ),
          Effect.exit,
        )
        expect(Exit.isFailure(failed)).toBe(true)
        expect(observed).toHaveLength(3)
        expect(yield* ServiceConfig.read()).toEqual({ remoteAccepted: true })
      }).pipe(
        Effect.provideService(
          Global.Service,
          Global.make({ config: path.dirname(config), state: path.dirname(registration) }),
        ),
        Effect.provideService(FetchHttpClient.Fetch, outbound),
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          // A competing client can read this configuration as soon as stop reads the registration.
          readFileString: (file, options) =>
            Effect.gen(function* () {
              if (file === registration) observed.push(JSON.parse(yield* fs.readFileString(config)))
              return yield* fs.readFileString(file, options)
            }),
        }),
      ),
    )
  }),
)
