import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode-ai/util/global"
import { expect, test } from "bun:test"
import { Effect, Exit, FileSystem } from "effect"
import { Command } from "effect/unstable/cli"
import path from "node:path"
import { Commands } from "../src/commands/commands"
import { ServiceConfig } from "../src/services/service-config"
import { it } from "../../core/test/lib/effect"

it.live("service CORS config persists multiple origins and preserves other settings on set and unset", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-cors-" })
    const config = path.join(root, "config")
    const state = path.join(root, "state")
    const file = path.join(config, ServiceConfig.filename())
    const existing = { hostname: "127.0.0.1", port: 4321, password: "test-secret", env: { TEST: "value" } }
    yield* fs.makeDirectory(config)
    yield* fs.makeDirectory(state)
    yield* fs.writeFileString(file, JSON.stringify(existing))
    yield* Effect.gen(function* () {
      expect(yield* ServiceConfig.get("cors")).toBe("[]")
      yield* ServiceConfig.set("cors", " http://192.0.2.10:3001, https://app.example.com ")
      const cors = ["http://192.0.2.10:3001", "https://app.example.com"]
      expect(yield* ServiceConfig.read()).toEqual({ ...existing, cors })
      expect(yield* ServiceConfig.get("cors")).toBe(JSON.stringify(cors, null, 2))
      expect(JSON.parse(yield* ServiceConfig.get())).toEqual({
        hostname: existing.hostname,
        port: existing.port,
        env: existing.env,
        cors,
      })
      expect(JSON.parse(yield* fs.readFileString(file))).toEqual({ ...existing, cors })
      yield* ServiceConfig.set("cors", "https://replacement.example.com")
      expect((yield* ServiceConfig.read()).cors).toEqual(["https://replacement.example.com"])
      yield* ServiceConfig.unset("cors")
      expect(yield* ServiceConfig.get("cors")).toBe("[]")
      expect(JSON.parse(yield* fs.readFileString(file))).toEqual(existing)
    }).pipe(Effect.provideService(Global.Service, Global.make({ config, state })))
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.live("service CORS config rejects empty lists, invalid origins, and extra arguments without changing config", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-cors-invalid-" })
    const config = path.join(root, "config")
    const state = path.join(root, "state")
    const file = path.join(config, ServiceConfig.filename())
    const existing = { port: 4321, cors: ["https://app.example.com"] }
    yield* fs.makeDirectory(config)
    yield* fs.makeDirectory(state)
    yield* fs.writeFileString(file, JSON.stringify(existing))
    yield* Effect.gen(function* () {
      yield* Effect.forEach(
        [
          "",
          " ",
          ",",
          "https://app.example.com,",
          ",https://app.example.com",
          "https://app.example.com,,https://other.example.com",
          "not-a-url",
          "*",
          "null",
          "ftp://app.example.com",
          "https://app.example.com/",
          "https://app.example.com/path",
          "https://app.example.com?query=1",
          "https://app.example.com#fragment",
          "https://user:password@app.example.com",
        ],
        (value) =>
          Effect.gen(function* () {
            expect(Exit.isFailure(yield* ServiceConfig.set("cors", value).pipe(Effect.exit))).toBe(true)
            expect(yield* ServiceConfig.read()).toEqual(existing)
          }),
      )
      yield* Effect.forEach(
        [
          ServiceConfig.get("cors", "extra"),
          ServiceConfig.set("cors", "https://app.example.com", "extra"),
          ServiceConfig.unset("cors", "extra"),
        ],
        (operation) =>
          Effect.gen(function* () {
            expect(Exit.isFailure(yield* operation.pipe(Effect.exit))).toBe(true)
          }),
      )
      expect(JSON.parse(yield* fs.readFileString(file))).toEqual(existing)
    }).pipe(Effect.provideService(Global.Service, Global.make({ config, state })))
  }).pipe(Effect.provide(NodeServices.layer)),
)

test.each([
  { args: [], cors: [] },
  { args: ["--cors", "https://app.example.com"], cors: ["https://app.example.com"] },
  {
    args: ["--service", "--cors", "http://192.0.2.10:3001", "--cors", "https://app.example.com"],
    cors: ["http://192.0.2.10:3001", "https://app.example.com"],
  },
])("serve parses CORS flags: $args", async ({ args, cors }) => {
  const received: (readonly string[])[] = []
  const command = Commands.commands.serve.spec.pipe(
    Command.withHandler((input) => Effect.sync(() => void received.push(input.cors))),
  )
  await Effect.runPromise(Command.runWith(command, { version: "test" })(args).pipe(Effect.provide(NodeServices.layer)))
  expect(received).toEqual([cors])
})

test.each([{ args: ["--cors"] }, { args: ["--cors", ""] }])(
  "serve rejects a missing or empty CORS flag value: $args",
  async ({ args }) => {
    const command = Commands.commands.serve.spec.pipe(Command.withHandler(() => Effect.void))
    const result = await Effect.runPromise(
      Command.runWith(command, { version: "test", renderErrors: false })(args).pipe(
        Effect.exit,
        Effect.provide(NodeServices.layer),
      ),
    )
    expect(Exit.isFailure(result)).toBe(true)
  },
)
