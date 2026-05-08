import path from "path"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { describe, expect, test } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import {
  createVariantRuntime,
  cycleVariant,
  formatModelLabel,
  pickVariant,
  resolveVariant,
} from "@/cli/cmd/run/variant.shared"
import type { SessionMessages } from "@/cli/cmd/run/session.shared"
import type { RunProvider } from "@/cli/cmd/run/types"
import { testEffect } from "../../lib/effect"

const model = {
  providerID: "openai",
  modelID: "gpt-5",
}

const providers: RunProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    source: "api",
    env: [],
    options: {},
    models: {
      "gpt-5": {
        id: "gpt-5",
        providerID: "openai",
        api: {
          id: "gpt-5",
          url: "https://openai.test",
          npm: "@ai-sdk/openai",
        },
        name: "GPT-5",
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
          context: 128000,
          output: 8192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2026-01-01",
      },
    },
  },
]

function userMessage(id: string, input: { providerID: string; modelID: string; variant?: string }): SessionMessages[number] {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "user",
      time: {
        created: 1,
      },
      agent: "build",
      model: input,
    },
    parts: [],
  }
}

const it = testEffect(Layer.mergeAll(AppFileSystem.defaultLayer, NodeFileSystem.layer))

function remap(root: string, file: string) {
  if (file === Global.Path.state) {
    return root
  }

  if (file.startsWith(Global.Path.state + path.sep)) {
    return path.join(root, path.relative(Global.Path.state, file))
  }

  return file
}

function remappedFs(root: string) {
  return Layer.effect(
    AppFileSystem.Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      return AppFileSystem.Service.of({
        ...fs,
        readJson: (file) => fs.readJson(remap(root, file)),
        writeJson: (file, data, mode) => fs.writeJson(remap(root, file), data, mode),
      })
    }),
  ).pipe(Layer.provide(AppFileSystem.defaultLayer))
}

describe("run variant shared", () => {
  test("prefers cli then session then saved variants", () => {
    expect(resolveVariant("max", "high", "low", ["low", "high"])).toBe("max")
    expect(resolveVariant(undefined, "high", "low", ["low", "high"])).toBe("high")
    expect(resolveVariant(undefined, "missing", "low", ["low", "high"])).toBe("low")
  })

  test("cycles through variants and back to default", () => {
    expect(cycleVariant(undefined, ["low", "high"])).toBe("low")
    expect(cycleVariant("low", ["low", "high"])).toBe("high")
    expect(cycleVariant("high", ["low", "high"])).toBeUndefined()
    expect(cycleVariant(undefined, [])).toBeUndefined()
  })

  test("formats model labels", () => {
    expect(formatModelLabel(model, undefined)).toBe("gpt-5 · openai")
    expect(formatModelLabel(model, "high")).toBe("gpt-5 · openai · high")
    expect(formatModelLabel(model, undefined, providers)).toBe("GPT-5 · OpenAI")
    expect(formatModelLabel(model, "high", providers)).toBe("GPT-5 · OpenAI · high")
  })

  test("picks the latest matching variant from raw session messages", () => {
    const msgs: SessionMessages = [
      userMessage("msg-1", { providerID: "openai", modelID: "gpt-5", variant: "high" }),
      userMessage("msg-2", { providerID: "anthropic", modelID: "sonnet", variant: "max" }),
      userMessage("msg-3", { providerID: "openai", modelID: "gpt-5", variant: "minimal" }),
    ]

    expect(pickVariant(model, msgs)).toBe("minimal")
  })

  it.live("reads and writes saved variants through a runtime-backed app fs layer", () =>
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const fs = yield* AppFileSystem.Service
      const root = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(root, "model.json")

      yield* fs.writeJson(file, {
        recent: [{ providerID: "anthropic", modelID: "sonnet" }],
        variant: {
          "openai/gpt-4.1": "low",
        },
      })

      const svc = createVariantRuntime(remappedFs(root))

      yield* Effect.promise(() => svc.saveVariant(model, "high"))
      expect(yield* Effect.promise(() => svc.resolveSavedVariant(model))).toBe("high")
      expect(yield* fs.readJson(file)).toEqual({
        recent: [{ providerID: "anthropic", modelID: "sonnet" }],
        variant: {
          "openai/gpt-4.1": "low",
          "openai/gpt-5": "high",
        },
      })

      yield* Effect.promise(() => svc.saveVariant(model, undefined))
      expect(yield* Effect.promise(() => svc.resolveSavedVariant(model))).toBeUndefined()
      expect(yield* fs.readJson(file)).toEqual({
        recent: [{ providerID: "anthropic", modelID: "sonnet" }],
        variant: {
          "openai/gpt-4.1": "low",
        },
      })
    }),
  )

  it.live("repairs malformed saved variant state on the next write", () =>
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const fs = yield* AppFileSystem.Service
      const root = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(root, "model.json")

      yield* filesys.writeFileString(file, "{")

      const svc = createVariantRuntime(remappedFs(root))

      yield* Effect.promise(() => svc.saveVariant(model, "high"))
      expect(yield* Effect.promise(() => svc.resolveSavedVariant(model))).toBe("high")
      expect(yield* fs.readJson(file)).toEqual({
        variant: {
          "openai/gpt-5": "high",
        },
      })
    }),
  )
})
