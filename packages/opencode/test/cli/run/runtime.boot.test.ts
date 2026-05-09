import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { KeyEvent, Renderable } from "@opentui/core"
import type { Binding } from "@opentui/keymap"
import { createBindingLookup } from "@opentui/keymap/extras"
import { OpencodeClient, type Provider } from "@opencode-ai/sdk/v2"
import { TuiConfig, type Resolved } from "@/cli/cmd/tui/config/tui"
import { formatBindings } from "@/cli/cmd/run/keymap.shared"
import { TuiKeybind } from "@/cli/cmd/tui/config/keybind"
import { resolveDiffStyle, resolveFooterKeybinds, resolveModelInfo } from "@/cli/cmd/run/runtime.boot"

type RunBinding = Binding<Renderable, KeyEvent>

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

function bindings(...keys: string[]) {
  return keys.map((key) => ({ key }))
}

function config(input?: {
  leader?: string
  leaderTimeout?: number
  diff_style?: "auto" | "stacked"
  bindings?: Partial<{
    commandList: RunBinding[]
    variantCycle: RunBinding[]
    interrupt: RunBinding[]
    historyPrevious: RunBinding[]
    historyNext: RunBinding[]
    inputClear: RunBinding[]
    inputSubmit: RunBinding[]
    inputNewline: RunBinding[]
  }>
}): Resolved {
  const bind = input?.bindings
  const keybinds = TuiKeybind.Keybinds.parse({
    ...(input?.leader && { leader: input.leader }),
    ...(bind?.commandList && { command_list: bind.commandList }),
    ...(bind?.variantCycle && { variant_cycle: bind.variantCycle }),
    ...(bind?.interrupt && { session_interrupt: bind.interrupt }),
    ...(bind?.historyPrevious && { history_previous: bind.historyPrevious }),
    ...(bind?.historyNext && { history_next: bind.historyNext }),
    ...(bind?.inputClear && { input_clear: bind.inputClear }),
    ...(bind?.inputSubmit && { input_submit: bind.inputSubmit }),
    ...(bind?.inputNewline && { input_newline: bind.inputNewline }),
  })
  return {
    diff_style: input?.diff_style,
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: input?.leaderTimeout ?? 2000,
  }
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
          commandList: bindings("ctrl+p"),
          variantCycle: bindings("ctrl+t", "alt+t"),
          interrupt: bindings("ctrl+c"),
          historyPrevious: bindings("k"),
          historyNext: bindings("j"),
          inputClear: bindings("ctrl+l"),
          inputSubmit: bindings("ctrl+s"),
          inputNewline: bindings("alt+return"),
        },
      }),
    )

    const result = await resolveFooterKeybinds()

    expect(result.leader).toBe("ctrl+g")
    expect(result.leaderTimeout).toBe(2000)
    expect(formatBindings(result.commandList, result.leader)).toBe("ctrl+p")
    expect(formatBindings(result.variantCycle, result.leader)).toBe("ctrl+t, alt+t")
    expect(formatBindings(result.interrupt, result.leader)).toBe("ctrl+c")
    expect(formatBindings(result.historyPrevious, result.leader)).toBe("k")
    expect(formatBindings(result.historyNext, result.leader)).toBe("j")
    expect(formatBindings(result.inputClear, result.leader)).toBe("ctrl+l")
    expect(formatBindings(result.inputSubmit, result.leader)).toBe("ctrl+s")
    expect(formatBindings(result.inputNewline, result.leader)).toBe("alt+return")
  })

  test("falls back to default keybinds when config load fails", async () => {
    spyOn(TuiConfig, "get").mockRejectedValue(new Error("boom"))

    const result = await resolveFooterKeybinds()

    expect(result.leader).toBe("ctrl+x")
    expect(result.leaderTimeout).toBe(2000)
    expect(formatBindings(result.commandList, result.leader)).toBe("ctrl+p")
    expect(formatBindings(result.variantCycle, result.leader)).toBe("ctrl+t")
    expect(formatBindings(result.interrupt, result.leader)).toBe("esc")
    expect(formatBindings(result.historyPrevious, result.leader)).toBe("up")
    expect(formatBindings(result.historyNext, result.leader)).toBe("down")
    expect(formatBindings(result.inputClear, result.leader)).toBe("ctrl+c")
    expect(formatBindings(result.inputSubmit, result.leader)).toBe("return")
    expect(formatBindings(result.inputNewline, result.leader)).toBe("shift+return, ctrl+return, alt+return, ctrl+j")
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
