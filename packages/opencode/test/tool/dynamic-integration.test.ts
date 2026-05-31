import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { ToolRuntime } from "@opencode-ai/database/tool/runtime"
import { ToolRegistry } from "@/tool/registry"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Provider } from "@/provider/provider"
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { Reference } from "@/reference/reference"
import { RepositoryCache } from "@/reference/repository-cache"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const layer = ToolRegistry.layer
  .pipe(
    Layer.provide(configLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Question.defaultLayer),
    Layer.provide(Todo.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Layer.mergeAll(SessionStatus.defaultLayer, BackgroundJob.defaultLayer)),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Layer.mergeAll(Git.defaultLayer, RepositoryCache.defaultLayer)),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(node),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Layer.mergeAll(Truncate.defaultLayer, ToolRuntime.layer)),
  )
  .pipe(Layer.provide(RuntimeFlags.layer({})))

const it = testEffect(Layer.mergeAll(layer, node, Agent.defaultLayer))

describe("dynamic tools integration", () => {
  it.instance("registers calculator.ts in catalog but not active by default", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      // Calculator is registered in catalog but not activated, so not in ids()
      expect(ids).not.toContain("calculator")
      // Builtin tools including our new meta-tools
      expect(ids).toContain("search_data")
      expect(ids).toContain("import_tool")
      expect(ids).toContain("skill")
    }),
  )
})
