import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { PermissionV2 } from "../src/permission"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionV2 } from "../src/session"
import { SessionTable } from "../src/session/sql"
import { ToolRegistry } from "../src/tool/registry"
import { AutofixTool } from "../src/tool/autofix"
import { SessionStore } from "../src/session/store"
import { testEffect, it } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"
import { LLMClient, Model } from "@opencode-ai/llm"
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
import { SessionRunnerModel } from "../src/session/runner/model"
import { Location } from "../src/location"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"
import path from "path"

const sessionID = SessionV2.ID.make("ses_autofix_tool_test")
const assertions: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(Effect.asVoid),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

describe("AutofixTool", () => {
  it.live("executes command, fails, calls LLM for fix, writes file, and succeeds on next run", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const projectDir = tmp.path
          const scriptPath = path.join(projectDir, "script.js")

          // Write failing script initially
          yield* Effect.promise(() => fs.writeFile(scriptPath, "process.exit(1)", "utf-8"))

          const database = Database.layerFromPath(path.join(projectDir, "test.db"))
          const events = EventV2.layer.pipe(Layer.provide(database))
          const location = Layer.succeed(
            Location.Service,
            Location.Service.of({
              directory: AbsolutePath.make(projectDir),
              project: {
                id: Project.ID.global,
                directory: AbsolutePath.make(projectDir),
              },
              vcs: undefined,
            }),
          )

          const mockLlm = Layer.succeed(
            LLMClient.Service,
            LLMClient.Service.of({
              prepare: () => Effect.die("unused"),
              stream: () => Effect.die("unused"),
              generate: () =>
                Effect.succeed({
                  events: [
                    {
                      type: "text-delta" as const,
                      text: `<file path="${scriptPath}">process.exit(0)</file>`,
                    },
                  ],
                } as any),
            } as any),
          )

          const mockModel = Model.make({
            id: "mock-model",
            provider: "mock",
            route: OpenAICompatibleChat.route,
          })

          const mockModelResolver = Layer.succeed(
            SessionRunnerModel.Service,
            SessionRunnerModel.Service.of({
              resolve: () => Effect.succeed(mockModel),
            }),
          )

          const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
          const sessionStore = SessionStore.layer.pipe(Layer.provide(database))
          const tool = AutofixTool.layer.pipe(
            Layer.provide(registry),
            Layer.provide(permission),
            Layer.provide(mockLlm),
            Layer.provide(mockModelResolver),
            Layer.provide(location),
            Layer.provide(sessionStore),
          )

          const mainLayer = Layer.mergeAll(database, events, permission, registry, tool, location, sessionStore)

          yield* Effect.gen(function* () {
            const { db } = yield* Database.Service
            yield* db
              .insert(ProjectTable)
              .values({ id: Project.ID.global, worktree: AbsolutePath.make(projectDir), sandboxes: [] })
              .run()
              .pipe(Effect.orDie)
            yield* db
              .insert(SessionTable)
              .values({
                id: sessionID,
                project_id: Project.ID.global,
                slug: "autofix",
                directory: projectDir,
                title: "autofix",
                version: "test",
              })
              .run()
              .pipe(Effect.orDie)

            const reg = yield* ToolRegistry.Service

            const result = yield* settleTool(reg, {
              sessionID,
              ...toolIdentity,
              call: {
                type: "tool-call" as const,
                id: "call-autofix",
                name: AutofixTool.name,
                input: {
                  command: "node script.js",
                  files: [scriptPath],
                },
              },
            })

            expect(result.output!.structured).toMatchObject({
              success: true,
              attempts: 2,
            })

            const updatedContent = yield* Effect.promise(() => fs.readFile(scriptPath, "utf-8"))
            expect(updatedContent).toBe("process.exit(0)")
          }).pipe(Effect.provide(mainLayer))
        }),
      ),
    ),
  )
})
