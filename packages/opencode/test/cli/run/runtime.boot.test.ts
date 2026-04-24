import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { Binding } from "@opentui/keymap"
import { OpencodeClient, type Provider } from "@opencode-ai/sdk/v2"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { formatBindings } from "@/cli/cmd/run/keymap.shared"
import { ConfigKeybinds } from "@/config/keybinds"
import {
  resolveDiffStyle,
  resolveFooterKeybinds,
  resolveModelInfo,
} from "@/cli/cmd/run/runtime.boot"

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
    commandList: Binding[]
    variantCycle: Binding[]
    interrupt: Binding[]
    historyPrevious: Binding[]
    historyNext: Binding[]
    inputClear: Binding[]
    inputSubmit: Binding[]
    inputNewline: Binding[]
  }>
}) {
  const lookup = new Map<string, Binding[]>()
  const sections = {
    global: [] as Binding[],
    session: [] as Binding[],
    prompt: [] as Binding[],
    autocomplete: [] as Binding[],
    input: [] as Binding[],
    dialog_select: [] as Binding[],
    dialog_actions: [] as Binding[],
    model: [] as Binding[],
    permission: [] as Binding[],
    question: [] as Binding[],
    plugins: [] as Binding[],
    home_tips: [] as Binding[],
  }

  const set = (section: string, command: string, value: Binding[] | undefined) => {
    if (!value) {
      return
    }

    lookup.set(`${section}:${command}`, value)
  }

  set("global", "command.palette.show", input?.bindings?.commandList)
  set("global", "variant.cycle", input?.bindings?.variantCycle)
  set("prompt", "session.interrupt", input?.bindings?.interrupt)
  set("prompt", "prompt.history.previous", input?.bindings?.historyPrevious)
  set("prompt", "prompt.history.next", input?.bindings?.historyNext)
  set("prompt", "prompt.clear", input?.bindings?.inputClear)
  set("input", "input.submit", input?.bindings?.inputSubmit)
  set("input", "input.newline", input?.bindings?.inputNewline)

  return {
    diff_style: input?.diff_style,
    keybinds: ConfigKeybinds.Keybinds.parse({}),
    keymap: {
      leader: input?.leader ?? "ctrl+x",
      leader_timeout: input?.leaderTimeout ?? 2000,
      sections,
      get(section: string, command: string) {
        return lookup.get(`${section}:${command}`)
      },
      pick() {
        return []
      },
      omit() {
        return []
      },
    },
  }
}

describe("run runtime boot", () => {
  afterEach(() => {
    mock.restore()
  })

  test("reads footer keybinds from resolved keymap config", async () => {
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
