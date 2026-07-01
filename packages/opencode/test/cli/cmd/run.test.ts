import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as SDK from "@opencode-ai/sdk/v2"
import { Provider } from "../../../src/provider/provider"
import { UI } from "../../../src/cli/ui"

const seen = {
  prompt: [] as any[],
  command: [] as any[],
}

function setup() {
  spyOn(Provider, "resolveSelection").mockImplementation(async (model) => ({
    model: model === "free" ? "opencode/freebie" : model,
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
            return {}
          },
          command: async (input: any) => {
            seen.command.push(input)
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
        attach: undefined,
        password: undefined,
        dir: undefined,
        port: undefined,
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

  test("passes a concrete attached model through unchanged", async () => {
    await call({ attach: "http://127.0.0.1:4096", model: "opencode/mimo-v2.5-free" })

    expect(seen.prompt).toHaveLength(1)
    expect(String(seen.prompt[0].model.providerID)).toBe("opencode")
    expect(String(seen.prompt[0].model.modelID)).toBe("mimo-v2.5-free")
  })

  test("rejects --model free combined with --attach", async () => {
    const errorSpy = spyOn(UI, "error").mockImplementation(() => {})
    const exitError = new Error("exit")
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw Object.assign(exitError, { code })
    }) as never)

    try {
      await expect(call({ attach: "http://127.0.0.1:4096", model: "free" })).rejects.toBe(exitError)
    } finally {
      exitSpy.mockRestore()
    }

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain("--model free is not supported with --attach")
    expect((exitError as { code?: number }).code).toBe(1)
    expect(seen.prompt).toHaveLength(0)
    expect(seen.command).toHaveLength(0)
  })
})
