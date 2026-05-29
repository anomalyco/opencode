import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as SDK from "@opencode-ai/sdk/v2"
import { Provider } from "../../../src/provider/provider"

const seen = {
  prompt: [] as any[],
  command: [] as any[],
  variant: [] as any[],
}

function setup() {
  spyOn(Provider, "resolveSelection").mockImplementation(async (model, variant) => ({
    model: model === "free" ? "opencode/freebie" : model,
    variant: variant === "any" ? "high" : variant,
  }))
  spyOn(SDK, "createOpencodeClient").mockImplementation(
    () =>
      ({
        config: {
          get: async () => ({ data: { share: "manual" } }),
        },
        event: {
          subscribe: async () => ({
            stream: (async function* () {})(),
          }),
        },
        path: {
          get: async () => ({ data: { directory: process.cwd() } }),
        },
        session: {
          create: async () => ({ data: { id: "session-1" } }),
          prompt: async (input: any) => {
            seen.prompt.push(input)
            seen.variant.push(input.variant)
            return {}
          },
          command: async (input: any) => {
            seen.command.push(input)
            seen.variant.push(input.variant)
            return {}
          },
        },
      }) as any,
  )
}

describe("run command", () => {
  afterEach(() => {
    mock.restore()
    seen.prompt.length = 0
    seen.command.length = 0
    seen.variant.length = 0
  })

  async function call(extra?: Record<string, unknown>) {
    setup()
    const { RunCommand } = await import("../../../src/cli/cmd/run")
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })

    try {
      await RunCommand.handler({
        _: [],
        $0: "opencode",
        message: ["hi"],
        command: undefined,
        continue: false,
        session: undefined,
        fork: false,
        share: false,
        model: "free",
        agent: undefined,
        format: "default",
        file: undefined,
        title: undefined,
        attach: "http://127.0.0.1:4096",
        password: undefined,
        dir: undefined,
        port: undefined,
        variant: undefined,
        thinking: false,
        "dangerously-skip-permissions": false,
        "--": [],
        ...extra,
      } as any)
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  }

  test("resolves free before prompting", async () => {
    await call()

    expect(seen.prompt).toHaveLength(1)
    expect(String(seen.prompt[0].model.providerID)).toBe("opencode")
    expect(String(seen.prompt[0].model.modelID)).toBe("freebie")
  })

  test("passes the resolved model to command sessions", async () => {
    await call({ command: "echo" })

    expect(seen.command).toHaveLength(1)
    expect(seen.command[0].model).toBe("opencode/freebie")
  })

  test("passes the resolved any variant to sessions", async () => {
    await call({ variant: "any" })

    expect(seen.prompt).toHaveLength(1)
    expect(seen.variant[0]).toBe("high")
  })
})
