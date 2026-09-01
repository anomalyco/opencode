import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { Formatter } from "@opencode-ai/core/formatter"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Environment } from "@opencode-ai/core/environment/index"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool"
import { WriteTool } from "@opencode-ai/core/tool/plugin/write"
import { transformEnvironmentFiles } from "./fixture/environment"
import { location } from "./fixture/location"
import { tmpdir, withTempDir } from "./fixture/tmpdir"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"

const writeToolNode = makeLocationNode({
  name: "test/write-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(WriteTool.Plugin)),
  deps: [Tool.node, LocationMutation.node, FileMutation.node, Environment.node, Formatter.node, Permission.node],
})

const sessionID = Session.ID.make("ses_write_tool_test")
const makeWriteFixture = () => {
  const fixture: {
    assertions: Permission.AssertInput[]
    writes: string[]
    denyAction?: string
    formatFile: (target: string) => Effect.Effect<boolean>
  } = {
    assertions: [],
    writes: [],
    formatFile: () => Effect.succeed(false),
  }

  const permission = permissionLayer({
    assert: (input) =>
      Effect.sync(() => fixture.assertions.push(input)).pipe(
        Effect.andThen(
          input.action === fixture.denyAction
            ? Effect.fail(
                new Permission.BlockedError({
                  rules: [],
                  permission: input.action,
                  resources: input.resources,
                }),
              )
            : Effect.void,
        ),
      ),
  })

  const formatter = Layer.mock(Formatter.Service, {
    file: (target) => fixture.formatFile(target),
  })

  return Object.assign(fixture, { permission, formatter })
}

const withTool = <A, E, R>(
  directory: string,
  fixture: ReturnType<typeof makeWriteFixture>,
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, LocationMutation.node, FileMutation.node, writeToolNode]), [
        Environment.node.replace(
          transformEnvironmentFiles((files) => ({
            write: (target, content) =>
              Effect.sync(() => fixture.writes.push(target)).pipe(Effect.andThen(files.write(target, content))),
          })),
        ),
        Location.node.replace(activeLocation),
        Formatter.node.replace(fixture.formatter),
        Permission.node.replace(fixture.permission),
      ]),
    ),
  )
}

const call = (input: typeof WriteTool.Input.Type, id = "call-write") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "write", input },
})

const it = testEffect(Layer.empty)

describe("WriteTool", () => {
  it.live("registers and creates a relative file through FileMutation once", () =>
    withTempDir((tmp) => {
      const fixture = makeWriteFixture()
      return withTool(tmp.path, fixture, (registry) =>
        Effect.gen(function* () {
          expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["write", "execute"])
          const settled = yield* executeTool(registry, call({ path: "src/new.txt", content: "created" }))
          expect(settled).toEqual({
            status: "completed",
            output: {
              operation: "write",
              target: path.join(yield* Effect.promise(() => fs.realpath(tmp.path)), "src", "new.txt"),
              resource: "src/new.txt",
              existed: false,
            },
            content: [{ type: "text", text: "Created file successfully: src/new.txt" }],
          })
          expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "src", "new.txt"), "utf8"))).toBe(
            "created",
          )
          expect(fixture.assertions).toMatchObject([
            { sessionID, action: "edit", resources: ["src/new.txt"], save: ["*"] },
          ])
          expect(fixture.assertions[0]?.metadata).toMatchObject({
            files: [
              {
                file: "src/new.txt",
                status: "added",
                additions: 1,
                deletions: 0,
                patch: expect.stringContaining("+created"),
              },
            ],
          })
          expect(fixture.writes).toEqual([
            path.join(yield* Effect.promise(() => fs.realpath(tmp.path)), "src", "new.txt"),
          ])
        }),
      )
    }),
  )

  it.live("formats the committed file", () =>
    withTempDir((tmp) => {
      const fixture = makeWriteFixture()
      const target = path.join(tmp.path, "formatted.txt")
      fixture.formatFile = (file) =>
        Effect.promise(async () => {
          await fs.writeFile(file, (await fs.readFile(file, "utf8")).toUpperCase())
          return true
        })
      return withTool(tmp.path, fixture, (registry) =>
        Effect.gen(function* () {
          expect(yield* executeTool(registry, call({ path: "formatted.txt", content: "format me" }))).toMatchObject({
            status: "completed",
          })
          expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("FORMAT ME")
        }),
      )
    }),
  )

  it.live("overwrites a relative existing file and reports that it wrote the file", () =>
    withTempDir((tmp) => {
      const fixture = makeWriteFixture()
      return Effect.promise(() => fs.writeFile(path.join(tmp.path, "existing.txt"), "before")).pipe(
        Effect.andThen(
          withTool(tmp.path, fixture, (registry) =>
            executeTool(registry, call({ path: "existing.txt", content: "after" })),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("completed")
            if (settled.status !== "completed") return
            expect(settled.content).toEqual([{ type: "text", text: "Wrote file successfully: existing.txt" }])
            expect(settled.output).toMatchObject({ resource: "existing.txt", existed: true })
            expect(fixture.assertions[0]?.metadata).toMatchObject({
              files: [
                {
                  file: "existing.txt",
                  status: "modified",
                  additions: 1,
                  deletions: 1,
                  patch: expect.stringMatching(/-before[\s\S]*\+after/),
                },
              ],
            })
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "existing.txt"), "utf8"))).toBe("after")
            expect(fixture.writes).toHaveLength(1)
          }),
        ),
      )
    }),
  )

  it.live("preserves exactly one BOM when overwriting existing files", () =>
    withTempDir((tmp) => {
      const fixture = makeWriteFixture()
      const preserved = path.join(tmp.path, "preserved.txt")
      const deduplicated = path.join(tmp.path, "deduplicated.txt")
      fixture.formatFile = (target) =>
        Effect.promise(async () => {
          await fs.writeFile(target, `\uFEFF\uFEFF\uFEFF${(await fs.readFile(target, "utf8")).replace(/^\uFEFF+/, "")}`)
          return true
        })
      return Effect.promise(() =>
        Promise.all([fs.writeFile(preserved, "\uFEFFbefore"), fs.writeFile(deduplicated, "\uFEFFbefore")]),
      ).pipe(
        Effect.andThen(
          withTool(tmp.path, fixture, (registry) =>
            Effect.gen(function* () {
              yield* executeTool(registry, call({ path: "preserved.txt", content: "after" }, "call-preserved"))
              yield* executeTool(
                registry,
                call({ path: "deduplicated.txt", content: "\uFEFFafter" }, "call-deduplicated"),
              )

              expect(yield* Effect.promise(() => fs.readFile(preserved, "utf8"))).toBe("\uFEFFafter")
              expect(yield* Effect.promise(() => fs.readFile(deduplicated, "utf8"))).toBe("\uFEFFafter")
            }),
          ),
        ),
      )
    }),
  )

  it.live("accepts an absolute file path inside the active Location", () =>
    withTempDir((tmp) => {
      const fixture = makeWriteFixture()
      const target = path.join(tmp.path, "absolute.txt")
      return withTool(tmp.path, fixture, (registry) =>
        executeTool(registry, call({ path: target, content: "inside" })),
      ).pipe(
        Effect.andThen((result) =>
          Effect.gen(function* () {
            expect(result).toMatchObject({
              status: "completed",
              content: [{ type: "text", text: "Created file successfully: absolute.txt" }],
            })
            expect(fixture.assertions.map((input) => input.action)).toEqual(["edit"])
            expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("inside")
          }),
        ),
      )
    }),
  )

  it.live("writes an external symlink target with only its in-location permission", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        const fixture = makeWriteFixture()
        if (process.platform === "win32") return Effect.void
        const target = path.join(outside.path, "external.txt")
        const link = path.join(active.path, "link.txt")
        return Effect.promise(async () => {
          await fs.writeFile(target, "before")
          await fs.symlink(target, link)
        }).pipe(
          Effect.andThen(
            withTool(active.path, fixture, (registry) =>
              executeTool(registry, call({ path: "link.txt", content: "after" })),
            ),
          ),
          Effect.andThen((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              expect(fixture.assertions.map((input) => input.action)).toEqual(["edit"])
              expect(fixture.assertions[0]?.resources).toEqual(["link.txt"])
            }),
          ),
          Effect.andThen(Effect.promise(() => fs.readFile(target, "utf8"))),
          Effect.tap((content) => Effect.sync(() => expect(content).toBe("after"))),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("approves an explicit external absolute path before edit", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        const fixture = makeWriteFixture()
        const target = path.join(outside.path, "external.txt")
        return withTool(active.path, fixture, (registry) =>
          executeTool(registry, call({ path: target, content: "external" })),
        ).pipe(
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              const absoluteTarget = target
              expect(fixture.assertions.map((input) => input.action)).toEqual(["external_directory", "edit"])
              expect(fixture.assertions[0]).toMatchObject({
                resources: [path.join(outside.path, "*").replaceAll("\\", "/")],
              })
              expect(fixture.assertions[1]).toMatchObject({
                resources: [absoluteTarget.replaceAll("\\", "/")],
                save: ["*"],
              })
              expect(settled).toMatchObject({
                status: "completed",
                output: {
                  target: absoluteTarget,
                  resource: absoluteTarget.replaceAll("\\", "/"),
                  existed: false,
                },
              })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("external")
              expect(fixture.writes).toEqual([absoluteTarget])
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("saves external directory approval at the nearest project directory", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        const fixture = makeWriteFixture()
        const repo = path.join(outside.path, "repo")
        const nested = path.join(repo, "packages", "app")
        const target = path.join(nested, "external.txt")
        return Effect.promise(() =>
          Promise.all([fs.mkdir(path.join(repo, ".git"), { recursive: true }), fs.mkdir(nested, { recursive: true })]),
        ).pipe(
          Effect.andThen(
            withTool(active.path, fixture, (registry) =>
              executeTool(registry, call({ path: target, content: "external" })),
            ),
          ),
          Effect.andThen(
            Effect.gen(function* () {
              expect(fixture.assertions[0]).toMatchObject({
                action: "external_directory",
                resources: [path.join(nested, "*").replaceAll("\\", "/")],
                save: [path.join(repo, "*").replaceAll("\\", "/")],
              })
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("does not write when external_directory or edit approval is denied", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) =>
        Effect.gen(function* () {
          const external = path.join(outside.path, "denied.txt")
          const fixture = makeWriteFixture()
          fixture.denyAction = "external_directory"
          expect(
            yield* withTool(active.path, fixture, (registry) =>
              executeTool(registry, call({ path: external, content: "blocked" })),
            ),
          ).toEqual({
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: external_directory" },
          })
          expect(fixture.assertions.map((input) => input.action)).toEqual(["external_directory"])
          expect(fixture.writes).toEqual([])

          const deniedEdit = makeWriteFixture()
          deniedEdit.denyAction = "edit"
          expect(
            yield* withTool(active.path, deniedEdit, (registry) =>
              executeTool(registry, call({ path: "denied.txt", content: "blocked" })),
            ),
          ).toEqual({
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: edit" },
          })
          expect(deniedEdit.assertions.map((input) => input.action)).toEqual(["edit"])
          expect(deniedEdit.writes).toEqual([])
        }),
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )
})
