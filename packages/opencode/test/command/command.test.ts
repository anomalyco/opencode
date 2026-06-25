import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Command } from "../../src/command"
import { MCP } from "../../src/mcp"
import { Skill } from "../../src/skill"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const getPromptCalls: Array<readonly unknown[]> = []

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () =>
      Effect.succeed({
        "math:scientific_calculation": {
          client: "math",
          name: "scientific_calculation",
          description: "Run a typed scientific calculation",
          arguments: [{ name: "precision" }, { name: "calc_type" }],
        },
      } as any),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: (...args) =>
      Effect.sync(() => {
        getPromptCalls.push(args)
        throw new Error("command listing should not render MCP prompts")
      }),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in command tests"),
    authenticate: () => Effect.die("unexpected MCP auth in command tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in command tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const skills = Layer.succeed(
  Skill.Service,
  Skill.Service.of({
    get: () => Effect.succeed(undefined),
    require: () => Effect.die("unexpected skill lookup in command tests"),
    all: () => Effect.succeed([]),
    dirs: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
  }),
)

const layer = Command.layer.pipe(Layer.provide(Layer.mergeAll(TestConfig.layer(), mcp, skills)))
const it = testEffect(layer)

it.instance("lists MCP prompts without rendering typed prompt arguments", () =>
  Effect.gen(function* () {
    getPromptCalls.length = 0

    const command = yield* Command.Service
    const found = (yield* command.list()).find((item) => item.name === "math:scientific_calculation")

    expect(found?.source).toBe("mcp")
    expect(found?.hints).toEqual(["$1", "$2"])
    expect(yield* Effect.promise(() => Promise.resolve(found?.template))).toBe("$1 $2")
    expect(found?.mcp).toEqual({
      client: "math",
      name: "scientific_calculation",
      arguments: [{ name: "precision" }, { name: "calc_type" }],
    })
    expect(getPromptCalls).toEqual([])
  }),
)
