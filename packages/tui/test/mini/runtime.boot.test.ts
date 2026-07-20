import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import type { Resolved } from "../../src/config"
import { resolveModelInfo, resolveRunTuiConfig } from "../../src/mini/runtime.boot"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

function ok<T>(data: T) {
  return Promise.resolve(data)
}

function provider(id: string, name: string) {
  return {
    id,
    name,
    api: { type: "native" as const, settings: {} },
    request: { headers: {}, body: {} },
  }
}

function model(id: string, providerID: string, context: number, variants: string[] = []) {
  return {
    id,
    providerID,
    api: {
      id: providerID,
      type: "native" as const,
      settings: {},
    },
    name: id,
    capabilities: {
      tools: true,
      input: ["text"],
      output: ["text"],
    },
    request: {
      headers: {},
      body: {},
    },
    variants: variants.map((variant) => ({
      id: variant,
      headers: {},
      body: {},
    })),
    time: {
      released: 1,
    },
    cost: [
      {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    ],
    limit: {
      context,
      output: 8192,
    },
    status: "active" as const,
    enabled: true,
  }
}

function config(input?: {
  leader?: string
  leaderTimeout?: number
  bindings?: Partial<{
    commandList: string[]
    variantCycle: string[]
    interrupt: string[]
    historyPrevious: string[]
    historyNext: string[]
    inputClear: string[]
    inputSubmit: string[]
    inputNewline: string[]
  }>
}): Resolved {
  const bind = input?.bindings
  return createTuiResolvedConfig({
    leader_timeout: input?.leaderTimeout,
    keybinds: {
      ...(input?.leader && { leader: input.leader }),
      ...(bind?.commandList && { command_list: bind.commandList }),
      ...(bind?.variantCycle && { variant_cycle: bind.variantCycle }),
      ...(bind?.interrupt && { session_interrupt: bind.interrupt }),
      ...(bind?.historyPrevious && { history_previous: bind.historyPrevious }),
      ...(bind?.historyNext && { history_next: bind.historyNext }),
      ...(bind?.inputClear && { input_clear: bind.inputClear }),
      ...(bind?.inputSubmit && { input_submit: bind.inputSubmit }),
      ...(bind?.inputNewline && { input_newline: bind.inputNewline }),
    },
  })
}

describe("run runtime boot", () => {
  afterEach(() => {
    mock.restore()
  })

  test("reads footer keybinds from resolved keybind config", async () => {
    const input = config({
      leader: "ctrl+g",
      bindings: {
        commandList: ["ctrl+p"],
        variantCycle: ["ctrl+t", "alt+t"],
        interrupt: ["ctrl+c"],
        historyPrevious: ["k"],
        historyNext: ["j"],
        inputClear: ["ctrl+l"],
        inputSubmit: ["ctrl+s"],
        inputNewline: ["alt+return"],
      },
    })

    const result = await resolveRunTuiConfig(input)

    expect(result.keybinds.get("leader")?.[0]?.key).toBe("ctrl+g")
    expect(result.leader.timeout).toBe(2000)
    expect(result.keybinds.get("command.palette.show")?.[0]?.key).toBe("ctrl+p")
    expect(result.keybinds.get("variant.cycle").map((item) => item.key)).toEqual(["ctrl+t", "alt+t"])
    expect(result.keybinds.get("session.interrupt")?.[0]?.key).toBe("ctrl+c")
    expect(result.keybinds.get("prompt.history.previous")?.[0]?.key).toBe("k")
    expect(result.keybinds.get("prompt.history.next")?.[0]?.key).toBe("j")
    expect(result.keybinds.get("prompt.clear")?.[0]?.key).toBe("ctrl+l")
    expect(result.keybinds.get("input.submit")?.[0]?.key).toBe("ctrl+s")
    expect(result.keybinds.get("input.newline")?.[0]?.key).toBe("alt+return")
  })

  test("falls back to default tui keymap config when config load fails", async () => {
    const result = await resolveRunTuiConfig(Promise.reject(new Error("boom")))

    expect(result.keybinds.get("leader")?.[0]?.key).toBe("ctrl+x")
    expect(result.leader.timeout).toBe(2000)
    expect(result.keybinds.get("command.palette.show")?.[0]?.key).toBe("ctrl+p")
    expect(result.keybinds.get("variant.cycle")?.[0]?.key).toBe("ctrl+t")
    expect(result.keybinds.get("session.interrupt")?.[0]?.key).toBe("escape")
    expect(result.keybinds.get("prompt.history.previous")?.[0]?.key).toBe("up")
    expect(result.keybinds.get("prompt.history.next")?.[0]?.key).toBe("down")
    expect(result.keybinds.get("prompt.clear")?.[0]?.key).toBe("ctrl+c")
    expect(result.keybinds.get("input.submit")?.[0]?.key).toBe("return")
    expect(result.keybinds.get("input.newline")?.[0]?.key).toBe("shift+return,ctrl+return,alt+return,ctrl+j")
  })

  test("preserves disabled leader from resolved tui config", async () => {
    const result = await resolveRunTuiConfig(config({ leader: "none" }))

    expect(result.keybinds.get("leader")).toEqual([])
  })

  test("preserves current theme mode, leader, and thinking config", async () => {
    const result = await resolveRunTuiConfig(
      createTuiResolvedConfig({
        theme: { mode: "light" },
        leader_timeout: 450,
        session: { thinking: "hide" },
      }),
    )

    expect(result.theme).toEqual({ mode: "light" })
    expect(result.leader.timeout).toBe(450)
    expect(result.session?.thinking).toBe("hide")
  })

  test("loads v2 providers and models for model selector data", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const providers = [provider("openai", "OpenAI")]
    const models = [model("gpt-5", "openai", 128000, ["high", "minimal"])]
    const providerList = spyOn(sdk.provider, "list").mockImplementation(() => ok({ data: providers }) as never)
    spyOn(sdk.model, "list").mockImplementation(() => ok({ data: models }) as never)

    await expect(resolveModelInfo(sdk, { directory: "/workspace" })).resolves.toEqual({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-5": {
              name: "gpt-5",
              cost: {
                input: 0,
              },
              status: "active",
              variants: {
                high: {},
                minimal: {},
              },
            },
          },
        },
      ],
    })
    expect(providerList).toHaveBeenCalledWith({
      location: {
        directory: "/workspace",
      },
    })
  })
})
