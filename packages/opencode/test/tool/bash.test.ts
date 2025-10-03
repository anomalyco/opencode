import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

type Metadata = {
  output?: string
  exit?: number
}

const createContext = () => {
  const controller = new AbortController()
  const snapshots: Metadata[] = []
  return {
    controller,
    snapshots,
    ctx: {
      sessionID: "test",
      messageID: "",
      callID: "",
      agent: "build",
      abort: controller.signal,
      metadata(input: { metadata?: Metadata }) {
        if (!input?.metadata) return
        snapshots.push(input.metadata)
      },
    },
  }
}

const bash = await BashTool.init()
const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("tool.bash", () => {
  test("basic", async () => {
    const { ctx } = createContext()
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
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

  test("cd ../ should fail outside of project root", async () => {
    const { ctx } = createContext()
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        expect(
          bash.execute(
            {
              command: "cd ../",
              description: "Try to cd to parent directory",
            },
            ctx,
          ),
        ).rejects.toThrow("This command references paths outside of")
      },
    })
  })

  test("streams incremental metadata", async () => {
    const { ctx, snapshots } = createContext()
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await bash.execute(
          {
            command: "printf 'one\\n'; sleep 0.05; printf 'two\\n'",
            description: "stream output",
          },
          ctx,
        )
        const outputs = snapshots
          .map((entry) => entry.output || "")
          .filter((text) => text.length > 0)
        expect(outputs.length).toBeGreaterThanOrEqual(2)
        const first = outputs[0]
        expect(first.includes("one")).toBe(true)
        expect(first.includes("two")).toBe(false)
        expect(outputs.at(-1)).toContain("two")
        expect(result.metadata.output).toContain("two")
      },
    })
  })

  test("terminates on timeout", async () => {
    const { ctx, snapshots } = createContext()
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await bash.execute(
          {
            command: "sleep 2",
            timeout: 50,
            description: "timeout",
          },
          ctx,
        )
        const last = snapshots.at(-1)
        expect(last?.exit).not.toBe(0)
        expect(result.metadata.exit).not.toBe(0)
      },
    })
  })

  test("supports external abort", async () => {
    const { ctx, controller, snapshots } = createContext()
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const execution = bash.execute(
          {
            command: "sleep 5",
            description: "abort",
          },
          ctx,
        )
        setTimeout(() => controller.abort(), 50)
        const result = await execution
        const last = snapshots.at(-1)
        expect(controller.signal.aborted).toBe(true)
        expect(last?.exit).not.toBe(0)
        expect(result.metadata.exit).not.toBe(0)
      },
    })
  })
})
