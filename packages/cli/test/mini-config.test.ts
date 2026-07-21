import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/util/global"
import { InstallationVersion } from "@opencode-ai/util/installation/version"
import { Effect, Option } from "effect"
import { expect, mock, test } from "bun:test"
import { Config } from "../src/config"
import type { MiniCommandInput } from "../src/mini"

test("mini handler passes resolved CLI keybinds to the runtime", async () => {
  let received: MiniCommandInput["tuiConfig"]
  const mini = await import("../src/mini")
  mock.module("../src/mini", () => ({
    ...mini,
    validateMiniTerminal() {},
    runMini(input: Pick<MiniCommandInput, "tuiConfig">) {
      received = input.tuiConfig
      return Promise.resolve()
    },
  }))
  const handler = (await import("../src/commands/handlers/mini")).default
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ healthy: true, version: InstallationVersion, pid: process.pid }),
  })

  try {
    await Effect.runPromise(
      handler({
        server: Option.some(server.url.toString()),
        standalone: false,
        continue: false,
        session: Option.none(),
        fork: false,
        replay: true,
        replayLimit: Option.none(),
        model: Option.none(),
        agent: Option.none(),
        prompt: Option.none(),
        demo: false,
      }).pipe(
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            path: "/tmp/cli.json",
            get: () => Effect.succeed({
              keybinds: { "composer.subagent.interrupt": "ctrl+i" },
              leader: { timeout: 321 },
            }),
            update: () => Effect.fail(new Error("not used")),
          }),
        ),
        Effect.provide(Global.layerWith({ config: "/tmp", state: "/tmp" })),
        Effect.provide(NodeFileSystem.layer),
        Effect.scoped,
      ),
    )

    const config = await received
    expect(config?.leader.timeout).toBe(321)
    expect(config?.keybinds.get("composer.subagent.interrupt")).toMatchObject([{ key: "ctrl+i" }])
  } finally {
    server.stop(true)
    mock.restore()
  }
})
