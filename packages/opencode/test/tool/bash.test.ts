import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { Agent } from "../../src/agent/agent"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test.each([
    {
      name: "loads bash.timeout from agent config",
      config: { timeout: 5000 },
      expected: { bash_timeout: 5000 },
    },
    {
      name: "loads bash.timeout from agent config with higher value",
      config: { timeout: 300000 },
      expected: { bash_timeout: 300000 },
    },
  ])("$name", async ({ config, expected }) => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            agent: {
              build: {
                bash: config,
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("build")
        if (expected.bash_timeout !== undefined) {
          expect(agent.options.bash_timeout).toBe(expected.bash_timeout)
        }
      },
    })
  })

  test.each([
    {
      name: "uses configured bash.timeout when no params.timeout specified",
      config: { timeout: 5000 },
      params: {},
      expectedTimeout: 5000,
    },
    {
      name: "uses max of bash.timeout and params.timeout",
      config: { timeout: 5000 },
      params: { timeout: 30000 },
      expectedTimeout: 30000,
    },
    {
      name: "allows params.timeout to exceed bash.timeout",
      config: { timeout: 5000 },
      params: { timeout: 500000 },
      expectedTimeout: 500000,
    },
    {
      name: "enforces bash.timeout as minimum",
      config: { timeout: 10000 },
      params: { timeout: 2000 },
      expectedTimeout: 10000,
    },
  ])("$name", async ({ config, params, expectedTimeout }) => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            agent: {
              build: {
                bash: config,
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'timeout test'",
            description: "Test timeout calculation",
            ...params,
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.timeout).toBe(expectedTimeout)
      },
    })
  })

  // TODO: better test
  // test("cd ../ should ask for permission for external directory", async () => {
  //   await Instance.provide({
  //     directory: projectRoot,
  //     fn: async () => {
  //       bash.execute(
  //         {
  //           command: "cd ../",
  //           description: "Try to cd to parent directory",
  //         },
  //         ctx,
  //       )
  //       // Give time for permission to be asked
  //       await new Promise((resolve) => setTimeout(resolve, 1000))
  //       expect(Permission.pending()[ctx.sessionID]).toBeDefined()
  //     },
  //   })
  // })
})
