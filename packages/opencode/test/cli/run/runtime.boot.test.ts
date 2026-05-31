import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeClient, type Provider } from "@opencode-ai/sdk/v2"
import { TuiConfig, type Resolved } from "@/cli/cmd/tui/config/tui"
import { resolveDiffStyle, resolveModelInfo, resolveRunTuiConfig } from "@/cli/cmd/run/runtime.boot"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

function model(id: string, providerID: string, context: number, variants?: Record<string, Record<string, never>>) {
  return {
    id,
    providerID,
    api: {
      id: providerID,
      url: `https://${providerID}.test`,
      npm: `@ai-sdk/${providerID}`,
    },
    name: id,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context,
      output: 8192,
    },
    status: "active" as const,
    options: {},
    headers: {},
    release_date: "2026-01-01",
    variants,
  }
}

function config(input?: {
  leader?: string
  leaderTimeout?: number
  diff_style?: "auto" | "stacked"
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
    diff_style: input?.diff_style,
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
    spyOn(TuiConfig, "get").mockResolvedValue(
      config({
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
      }),
    )

    const result = await resolveRunTuiConfig()

    expect(result.keybinds.get("leader")?.[0]?.key).toBe("ctrl+g")
    expect(result.leader_timeout).toBe(2000)
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
    spyOn(TuiConfig, "get").mockRejectedValue(new Error("boom"))

    const result = await resolveRunTuiConfig()

    expect(result.keybinds.get("leader")?.[0]?.key).toBe("ctrl+x")
    expect(result.leader_timeout).toBe(2000)
    expect(result.diff_style).toBe("auto")
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
    spyOn(TuiConfig, "get").mockResolvedValue(config({ leader: "none" }))

    const result = await resolveRunTuiConfig()

    expect(result.keybinds.get("leader")).toEqual([])
  })

  test("reads diff style and falls back to auto", async () => {
    spyOn(TuiConfig, "get").mockResolvedValue(config({ diff_style: "stacked" }))
    await expect(resolveDiffStyle()).resolves.toBe("stacked")

    mock.restore()
    spyOn(TuiConfig, "get").mockRejectedValue(new Error("boom"))
    await expect(resolveDiffStyle()).resolves.toBe("auto")
  })

  test("prefers configured providers for model selector data", async () => {
    const sdk = new OpencodeClient()
    const data: {
      all: Provider[]
      default: Record<string, string>
      connected: string[]
    } = {
      all: [
        {
          id: "openai",
          name: "OpenAI",
          source: "api",
          env: [],
          options: {},
          models: {
            "gpt-5": model("gpt-5", "openai", 128000, {
              high: {},
              minimal: {},
            }),
          },
        },
        {
          id: "anthropic",
          name: "Anthropic",
          source: "api",
          env: [],
          options: {},
          models: {
            sonnet: model("sonnet", "anthropic", 200000),
          },
        },
      ],
      default: {},
      connected: [],
    }
    const configured = {
      providers: [data.all[0]!],
      default: {},
    }
    const list = spyOn(sdk.provider, "list").mockImplementation(() =>
      Promise.resolve({
        data,
        error: undefined,
        request: new Request("https://opencode.test"),
        response: new Response(),
      }),
    )
    spyOn(sdk.config, "providers").mockImplementation(() =>
      Promise.resolve({
        data: configured,
        error: undefined,
        request: new Request("https://opencode.test"),
        response: new Response(),
      }),
    )

    await expect(resolveModelInfo(sdk, "/workspace", { providerID: "openai", modelID: "gpt-5" })).resolves.toEqual({
      providers: configured.providers,
      variants: ["high", "minimal"],
      limits: {
        "openai/gpt-5": 128000,
      },
    })
    expect(list).not.toHaveBeenCalled()
  })

  test("falls back to provider list when configured providers are unavailable", async () => {
    const sdk = new OpencodeClient()
    const data: {
      all: Provider[]
      default: Record<string, string>
      connected: string[]
    } = {
      all: [
        {
          id: "openai",
          name: "OpenAI",
          source: "api",
          env: [],
          options: {},
          models: {
            "gpt-5": model("gpt-5", "openai", 128000, {
              high: {},
              minimal: {},
            }),
          },
        },
        {
          id: "anthropic",
          name: "Anthropic",
          source: "api",
          env: [],
          options: {},
          models: {
            sonnet: model("sonnet", "anthropic", 200000),
          },
        },
      ],
      default: {},
      connected: [],
    }
    spyOn(sdk.config, "providers").mockRejectedValue(new Error("boom"))
    spyOn(sdk.provider, "list").mockImplementation(() =>
      Promise.resolve({
        data,
        error: undefined,
        request: new Request("https://opencode.test"),
        response: new Response(),
      }),
    )

    await expect(resolveModelInfo(sdk, "/workspace", { providerID: "openai", modelID: "gpt-5" })).resolves.toEqual({
      providers: data.all,
      variants: ["high", "minimal"],
      limits: {
        "openai/gpt-5": 128000,
        "anthropic/sonnet": 200000,
      },
    })
  })
})
