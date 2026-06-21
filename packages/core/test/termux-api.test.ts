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
import { TermuxTool } from "../src/tool/termux"
import { testEffect, it } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"
import path from "path"

const sessionID = SessionV2.ID.make("ses_termux_tool_test")
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

describe("TermuxTool", () => {
  it.live("handles command not found by returning a helpful installation message", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const projectDir = tmp.path
          const database = Database.layerFromPath(path.join(projectDir, "test.db"))
          const events = EventV2.layer.pipe(Layer.provide(database))

          const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
          const tool = TermuxTool.layer.pipe(
            Layer.provide(registry),
            Layer.provide(permission),
          )

          const mainLayer = Layer.mergeAll(database, events, permission, registry, tool)

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
                slug: "termux",
                directory: projectDir,
                title: "termux",
                version: "test",
              })
              .run()
              .pipe(Effect.orDie)

            const reg = yield* ToolRegistry.Service

            const originalPath = process.env.PATH
            process.env.PATH = "" // Temporarily isolate PATH to force command not found (ENOENT)

            try {
              const result: any = yield* settleTool(reg, {
                sessionID,
                ...toolIdentity,
                call: {
                  type: "tool-call" as const,
                  id: "call-termux",
                  name: TermuxTool.name,
                  input: {
                    action: "toast",
                    args: ["Hello Zero"],
                  },
                },
              })

              console.log("RESULT (NOT FOUND):", result)
              expect(result.output!.structured.success).toBe(false)
              expect(result.output!.structured.output).toContain("Please install the termux-api package")
            } finally {
              process.env.PATH = originalPath
            }
          }).pipe(Effect.provide(mainLayer))
        }),
      ),
    ),
  )

  it.live("executes command successfully when executable is available in PATH", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const projectDir = tmp.path

          // Create a mock executable script named termux-vibrate
          const mockBinDir = path.join(projectDir, "bin")
          const mockExecPath = path.join(mockBinDir, "termux-vibrate")

          yield* Effect.promise(() => fs.mkdir(mockBinDir, { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(mockExecPath, "#!/bin/sh\necho 'vibrated'", "utf-8"))
          yield* Effect.promise(() => fs.chmod(mockExecPath, 0o755))

          const database = Database.layerFromPath(path.join(projectDir, "test.db"))
          const events = EventV2.layer.pipe(Layer.provide(database))

          const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
          const tool = TermuxTool.layer.pipe(
            Layer.provide(registry),
            Layer.provide(permission),
          )

          const mainLayer = Layer.mergeAll(database, events, permission, registry, tool)

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
                slug: "termux",
                directory: projectDir,
                title: "termux",
                version: "test",
              })
              .run()
              .pipe(Effect.orDie)

            const reg = yield* ToolRegistry.Service

            const originalPath = process.env.PATH
            process.env.PATH = `${mockBinDir}:${originalPath}`

            try {
              const result: any = yield* settleTool(reg, {
                sessionID,
                ...toolIdentity,
                call: {
                  type: "tool-call" as const,
                  id: "call-termux-success",
                  name: TermuxTool.name,
                  input: {
                    action: "vibrate",
                    args: ["500"],
                  },
                },
              })

              console.log("RESULT (SUCCESS):", result)
              expect(result.output!.structured.success).toBe(true)
              expect(result.output!.structured.output.trim()).toBe("vibrated")
            } finally {
              process.env.PATH = originalPath
            }
          }).pipe(Effect.provide(mainLayer))
        }),
      ),
    ),
  )

  it.live("executes tts-speak action successfully", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const projectDir = tmp.path

          // Create a mock executable script named termux-tts-speak
          const mockBinDir = path.join(projectDir, "bin")
          const mockExecPath = path.join(mockBinDir, "termux-tts-speak")

          yield* Effect.promise(() => fs.mkdir(mockBinDir, { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(mockExecPath, "#!/bin/sh\necho 'spoken'", "utf-8"))
          yield* Effect.promise(() => fs.chmod(mockExecPath, 0o755))

          const database = Database.layerFromPath(path.join(projectDir, "test.db"))
          const events = EventV2.layer.pipe(Layer.provide(database))

          const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
          const tool = TermuxTool.layer.pipe(
            Layer.provide(registry),
            Layer.provide(permission),
          )

          const mainLayer = Layer.mergeAll(database, events, permission, registry, tool)

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
                slug: "termux-tts",
                directory: projectDir,
                title: "termux-tts",
                version: "test",
              })
              .run()
              .pipe(Effect.orDie)

            const reg = yield* ToolRegistry.Service

            const originalPath = process.env.PATH
            process.env.PATH = `${mockBinDir}:${originalPath}`

            try {
              const result: any = yield* settleTool(reg, {
                sessionID,
                ...toolIdentity,
                call: {
                  type: "tool-call" as const,
                  id: "call-termux-tts",
                  name: TermuxTool.name,
                  input: {
                    action: "tts-speak",
                    args: ["hello"],
                  },
                },
              })

              expect(result.output!.structured.success).toBe(true)
              expect(result.output!.structured.output.trim()).toBe("spoken")
            } finally {
              process.env.PATH = originalPath
            }
          }).pipe(Effect.provide(mainLayer))
        }),
      ),
    ),
  )

  it.live("executes dynamic apiCommand autonomously", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const projectDir = tmp.path

          // Create a mock executable script named termux-camera-photo
          const mockBinDir = path.join(projectDir, "bin")
          const mockExecPath = path.join(mockBinDir, "termux-camera-photo")

          yield* Effect.promise(() => fs.mkdir(mockBinDir, { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(mockExecPath, "#!/bin/sh\necho 'photo-taken'", "utf-8"))
          yield* Effect.promise(() => fs.chmod(mockExecPath, 0o755))

          const database = Database.layerFromPath(path.join(projectDir, "test.db"))
          const events = EventV2.layer.pipe(Layer.provide(database))

          const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
          const tool = TermuxTool.layer.pipe(
            Layer.provide(registry),
            Layer.provide(permission),
          )

          const mainLayer = Layer.mergeAll(database, events, permission, registry, tool)

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
                slug: "termux-dynamic",
                directory: projectDir,
                title: "termux-dynamic",
                version: "test",
              })
              .run()
              .pipe(Effect.orDie)

            const reg = yield* ToolRegistry.Service

            const originalPath = process.env.PATH
            process.env.PATH = `${mockBinDir}:${originalPath}`

            try {
              const result: any = yield* settleTool(reg, {
                sessionID,
                ...toolIdentity,
                call: {
                  type: "tool-call" as const,
                  id: "call-termux-dynamic",
                  name: TermuxTool.name,
                  input: {
                    apiCommand: "termux-camera-photo",
                    args: ["--camera", "0"],
                  },
                },
              })

              expect(result.output!.structured.success).toBe(true)
              expect(result.output!.structured.output.trim()).toBe("photo-taken")
            } finally {
              process.env.PATH = originalPath
            }
          }).pipe(Effect.provide(mainLayer))
        }),
      ),
    ),
  )
})
