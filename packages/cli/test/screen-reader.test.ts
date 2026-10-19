import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { ConfigProvider, Effect, type FileSystem, type Scope, Option } from "effect"
import { afterAll, expect, mock, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Config } from "../src/config"
import type { MiniCommandInput } from "../src/mini"
import { OPENCODE_VERSION } from "../src/version"

let received: MiniCommandInput["tuiConfig"] | undefined
const mini = await import("../src/mini")
mock.module("../src/mini", () => ({
  ...mini,
  validateMiniTerminal() {},
  runMini(options: Pick<MiniCommandInput, "tuiConfig">) {
    received = options.tuiConfig
    return Promise.resolve()
  },
}))
const handler = (await import("../src/commands/handlers/mini")).default
const plainHandler = (await import("../src/commands/handlers/default")).default
afterAll(() => mock.restore())

async function miniSettings(input: Parameters<typeof runHandler>[0]) {
  return (await runHandler(input))?.mini
}

async function runHandler(input: {
  config: object
  flag: Option.Option<boolean>
  env?: Record<string, string>
  plain?: boolean
  auto?: boolean
}) {
  const root = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const configDirectory = path.join(root, "config")
  await mkdir(configDirectory, { recursive: true })
  await Bun.write(path.join(configDirectory, "cli.json"), JSON.stringify(input.config))
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [] }),
  })

  try {
    const url = Option.some(server.url.toString())
    const command = input.plain
      ? plainHandler({
          server: url,
          standalone: false,
          auto: false,
          yolo: false,
          dangerouslySkipPermissions: false,
          directory: Option.none(),
          continue: false,
          session: Option.none(),
          prompt: Option.none(),
          screenReader: input.flag,
        })
      : handler({
          server: url,
          standalone: false,
          continue: false,
          session: Option.none(),
          fork: false,
          replay: Option.none(),
          replayLimit: Option.none(),
          model: Option.none(),
          agent: Option.none(),
          prompt: Option.none(),
          demo: false,
          screenReader: input.flag,
          auto: input.auto ?? false,
          yolo: false,
          dangerouslySkipPermissions: false,
        })
    await Effect.runPromise(
      // The plain handler also needs services that it only reaches after the screen reader handoff.
      (command as Effect.Effect<void, unknown, Config.Service | Global.Service | FileSystem.FileSystem | Scope.Scope>).pipe(
        Effect.provide(Config.layer),
        // The default provider reads process.env once per process, so inject the environment.
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnvRecord(input.env ?? {}),
          ),
        ),
        Effect.provide(Global.layerWith({ config: configDirectory, state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
        Effect.scoped,
      ),
    )
    return await received
  } finally {
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}

const quiet = { splash: "hide", footer: "hide", mono: true }

test("config screen_reader quiets the mini interface", async () => {
  expect(await miniSettings({ config: { screen_reader: true }, flag: Option.none() })).toMatchObject(quiet)
})

test("interface stays unchanged without screen reader mode", async () => {
  expect((await miniSettings({ config: {}, flag: Option.none() }))?.mono).not.toBe(true)
})

test("env overrides config, flag overrides env", async () => {
  expect(await miniSettings({ config: {}, flag: Option.none(), env: { OPENCODE_SCREEN_READER: "true" } })).toMatchObject(quiet)
  expect((await miniSettings({ config: { screen_reader: true }, flag: Option.none(), env: { OPENCODE_SCREEN_READER: "false" } }))?.mono).not.toBe(
    true,
  )
  expect(await miniSettings({ config: {}, flag: Option.some(true), env: { OPENCODE_SCREEN_READER: "false" } })).toMatchObject(quiet)
})

test("an unrecognised env value is ignored", async () => {
  expect(await miniSettings({ config: { screen_reader: true }, flag: Option.none(), env: { OPENCODE_SCREEN_READER: "maybe" } })).toMatchObject(quiet)
})

test("NO_COLOR makes the interface monochrome without the rest of screen reader mode", async () => {
  const mini = await miniSettings({ config: {}, flag: Option.none(), env: { NO_COLOR: "1" } })
  expect(mini?.mono).toBe(true)
  expect(mini?.splash).not.toBe("hide")
  expect((await miniSettings({ config: {}, flag: Option.none(), env: { NO_COLOR: "" } }))?.mono).not.toBe(true)
})

test("plain opencode hands off to the minimal interface in screen reader mode", async () => {
  expect(await miniSettings({ config: {}, flag: Option.some(true), plain: true })).toMatchObject(quiet)
  expect(await miniSettings({ config: { screen_reader: true }, flag: Option.none(), plain: true })).toMatchObject(quiet)
})

test("the autoaccept config setting alone does not auto-accept in the minimal interface", async () => {
  const config = { session: { permissions: "autoaccept" } }
  expect((await runHandler({ config, flag: Option.none() }))?.session).toMatchObject({ permissions: "prompt" })
})

test("plain opencode keeps the autoaccept config setting across the handoff", async () => {
  const config = { session: { permissions: "autoaccept" } }
  const session = (await runHandler({ config, flag: Option.some(true), plain: true }))?.session
  expect(session).toMatchObject({ permissions: "autoaccept" })
})

test("--auto auto-accepts permissions in the minimal interface", async () => {
  expect((await runHandler({ config: {}, flag: Option.none(), auto: true }))?.session).toMatchObject({
    permissions: "autoaccept",
  })
})
