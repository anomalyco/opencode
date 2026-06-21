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
import { SwarmTool } from "../src/tool/swarm"
import { SessionStore } from "../src/session/store"
import { testEffect, it } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"
import { LLMClient, Model } from "@opencode-ai/llm"
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
import { SessionRunnerModel } from "../src/session/runner/model"
import { Location } from "../src/location"
import { tmpdir } from "./fixture/tmpdir"
import path from "path"

const sessionID = SessionV2.ID.make("ses_swarm_tool_test")
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

describe("SwarmTool", () => {
  it.live("runs cooperative swarm of Programmer and Reviewer for specified rounds", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const projectDir = tmp.path

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
              generate: (req: any) => {
                const reqStr = JSON.stringify(req)
                if (reqStr.includes("focado em revisar")) {
                  return Effect.succeed({
                    events: [
                      {
                        type: "text-delta" as const,
                        text: "Feedback do revisor: tudo certo.",
                      },
                    ],
                  } as any)
                } else if (reqStr.includes("focado em produzir código")) {
                  return Effect.succeed({
                    events: [
                      {
                        type: "text-delta" as const,
                        text: "Solução do programador: const a = 1;",
                      },
                    ],
                  } as any)
                }
                return Effect.succeed({ events: [] } as any)
              },
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
          const tool = SwarmTool.layer.pipe(
            Layer.provide(registry),
            Layer.provide(permission),
            Layer.provide(mockLlm),
            Layer.provide(mockModelResolver),
            Layer.provide(location),
            Layer.provide(sessionStore),
            Layer.provide(events),
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
                slug: "swarm",
                directory: projectDir,
                title: "swarm",
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
                id: "call-swarm",
                name: SwarmTool.name,
                input: {
                  task: "Write a function to add two numbers",
                  rounds: 2,
                },
              },
            })

            expect(result.output!.structured).toMatchObject({
              result: "Solução do programador: const a = 1;",
              history: [
                { agent: "Programador", round: 1, content: "Solução do programador: const a = 1;" },
                { agent: "Revisor", round: 1, content: "Feedback do revisor: tudo certo." },
                { agent: "Programador", round: 2, content: "Solução do programador: const a = 1;" },
                { agent: "Revisor", round: 2, content: "Feedback do revisor: tudo certo." },
              ],
            })
          }).pipe(Effect.provide(mainLayer))
        }),
      ),
    ),
  )
})
