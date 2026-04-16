import { test, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Color } from "../../src/util"
import { AppRuntime } from "../../src/effect/app-runtime"

const load = () => AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
const agent = <A>(dir: string, fn: (svc: AgentSvc.Interface) => Effect.Effect<A>) =>
  Effect.runPromise(provideInstance(dir)(AgentSvc.Service.use(fn)).pipe(Effect.provide(AgentSvc.defaultLayer)))

test("agent color parsed from project config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            build: { color: "#FFA500" },
            plan: { color: "primary" },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const cfg = await load()
      expect(cfg.agent?.["build"]?.color).toBe("#FFA500")
      expect(cfg.agent?.["plan"]?.color).toBe("primary")
    },
  })
})

test("Agent.get includes color from config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            plan: { color: "#A855F7" },
            build: { color: "accent" },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await agent(tmp.path, (svc) => svc.get("plan"))
      expect(plan?.color).toBe("#A855F7")
      const build = await agent(tmp.path, (svc) => svc.get("build"))
      expect(build?.color).toBe("accent")
    },
  })
})

test("Color.hexToAnsiBold converts valid hex to ANSI", () => {
  const result = Color.hexToAnsiBold("#FFA500")
  expect(result).toBe("\x1b[38;2;255;165;0m\x1b[1m")
})

test("Color.hexToAnsiBold returns undefined for invalid hex", () => {
  expect(Color.hexToAnsiBold(undefined)).toBeUndefined()
  expect(Color.hexToAnsiBold("")).toBeUndefined()
  expect(Color.hexToAnsiBold("#FFF")).toBeUndefined()
  expect(Color.hexToAnsiBold("FFA500")).toBeUndefined()
  expect(Color.hexToAnsiBold("#GGGGGG")).toBeUndefined()
})
