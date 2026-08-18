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
import { LocationPath } from "@opencode-ai/core/location-path"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool"
import { WriteTool } from "@opencode-ai/core/tool/plugin/write"
import { transformEnvironmentFiles } from "./fixture/environment"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"

const writeToolNode = makeLocationNode({
  name: "test/write-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(WriteTool.Plugin)),
  deps: [Tool.node, LocationPath.node, FileMutation.node, Environment.node, Formatter.node, Permission.node],
})

const sessionID = Session.ID.make("ses_write_tool_test")
const assertions: Permission.AssertInput[] = []
const writes: string[] = []
let formatFile = (_target: string): Effect.Effect<boolean> => Effect.succeed(false)
let denyAction: string | undefined

const permission = permissionLayer({
  assert: (input) =>
    Effect.sync(() => assertions.push(input)).pipe(
      Effect.andThen(
        input.action === denyAction
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
  file: (target) => formatFile(target),
})

const reset = () => {
  assertions.length = 0
  writes.length = 0
  formatFile = () => Effect.succeed(false)
  denyAction = undefined
}

const withTool = <A, E, R>(directory: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* Tool.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([Tool.node, Tool.node, LocationPath.node, FileMutation.node, writeToolNode]),
        [
          [
            Environment.node,
            transformEnvironmentFiles(activeLocation, (files) => ({
              write: (target, content) =>
                Effect.sync(() => writes.push(target)).pipe(Effect.andThen(files.write(target, content))),
            })),
          ],
          [Location.node, activeLocation],
          [Formatter.node, formatter],
          [Permission.node, permission],
        ],
      ),
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
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
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
            expect(assertions).toMatchObject([{ sessionID, action: "edit", resources: ["src/new.txt"], save: ["*"] }])
            expect(assertions[0]?.metadata).toMatchObject({
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
            expect(writes).toEqual([path.join(yield* Effect.promise(() => fs.realpath(tmp.path)), "src", "new.txt")])
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("formats the committed file", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "formatted.txt")
        formatFile = (file) =>
          Effect.promise(async () => {
            await fs.writeFile(file, (await fs.readFile(file, "utf8")).toUpperCase())
            return true
          })
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect(yield* executeTool(registry, call({ path: "formatted.txt", content: "format me" }))).toMatchObject({
              status: "completed",
            })
            expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("FORMAT ME")
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("overwrites a relative existing file and reports that it wrote the file", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return Effect.promise(() => fs.writeFile(path.join(tmp.path, "existing.txt"), "before")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) => executeTool(registry, call({ path: "existing.txt", content: "after" }))),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.status).toBe("completed")
              if (settled.status !== "completed") return
              expect(settled.content).toEqual([{ type: "text", text: "Wrote file successfully: existing.txt" }])
              expect(settled.output).toMatchObject({ resource: "existing.txt", existed: true })
              expect(assertions[0]?.metadata).toMatchObject({
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
              expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "existing.txt"), "utf8"))).toBe(
                "after",
              )
              expect(writes).toHaveLength(1)
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("preserves exactly one BOM when overwriting existing files", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const preserved = path.join(tmp.path, "preserved.txt")
        const deduplicated = path.join(tmp.path, "deduplicated.txt")
        formatFile = (target) =>
          Effect.promise(async () => {
            await fs.writeFile(
              target,
              `\uFEFF\uFEFF\uFEFF${(await fs.readFile(target, "utf8")).replace(/^\uFEFF+/, "")}`,
            )
            return true
          })
        return Effect.promise(() =>
          Promise.all([fs.writeFile(preserved, "\uFEFFbefore"), fs.writeFile(deduplicated, "\uFEFFbefore")]),
        ).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
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
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("accepts an absolute file path inside the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "absolute.txt")
        return withTool(tmp.path, (registry) => executeTool(registry, call({ path: target, content: "inside" }))).pipe(
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result).toMatchObject({
                status: "completed",
                content: [{ type: "text", text: "Created file successfully: absolute.txt" }],
              })
              expect(assertions.map((input) => input.action)).toEqual(["edit"])
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("inside")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("writes an external symlink target with only its in-location permission", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        if (process.platform === "win32") return Effect.void
        const target = path.join(outside.path, "external.txt")
        const link = path.join(active.path, "link.txt")
        return Effect.promise(async () => {
          await fs.writeFile(target, "before")
          await fs.symlink(target, link)
        }).pipe(
          Effect.andThen(
            withTool(active.path, (registry) => executeTool(registry, call({ path: "link.txt", content: "after" }))),
          ),
          Effect.andThen((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              expect(assertions.map((input) => input.action)).toEqual(["edit"])
              expect(assertions[0]?.resources).toEqual(["link.txt"])
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
        reset()
        const target = path.join(outside.path, "external.txt")
        return withTool(active.path, (registry) =>
          executeTool(registry, call({ path: target, content: "external" })),
        ).pipe(
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              const absoluteTarget = target
              expect(assertions.map((input) => input.action)).toEqual(["external_directory", "edit"])
              expect(assertions[0]).toMatchObject({
                resources: [path.join(outside.path, "*").replaceAll("\\", "/")],
              })
              expect(assertions[1]).toMatchObject({ resources: [absoluteTarget.replaceAll("\\", "/")], save: ["*"] })
              expect(settled).toMatchObject({
                status: "completed",
                output: {
                  target: absoluteTarget,
                  resource: absoluteTarget.replaceAll("\\", "/"),
                  existed: false,
                },
              })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("external")
              expect(writes).toEqual([absoluteTarget])
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
        reset()
        const repo = path.join(outside.path, "repo")
        const nested = path.join(repo, "packages", "app")
        const target = path.join(nested, "external.txt")
        return Effect.promise(() =>
          Promise.all([fs.mkdir(path.join(repo, ".git"), { recursive: true }), fs.mkdir(nested, { recursive: true })]),
        ).pipe(
          Effect.andThen(
            withTool(active.path, (registry) => executeTool(registry, call({ path: target, content: "external" }))),
          ),
          Effect.andThen(
            Effect.gen(function* () {
              expect(assertions[0]).toMatchObject({
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
          reset()
          denyAction = "external_directory"
          expect(
            yield* withTool(active.path, (registry) =>
              executeTool(registry, call({ path: external, content: "blocked" })),
            ),
          ).toEqual({
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: external_directory" },
          })
          expect(assertions.map((input) => input.action)).toEqual(["external_directory"])
          expect(writes).toEqual([])

          reset()
          denyAction = "edit"
          expect(
            yield* withTool(active.path, (registry) =>
              executeTool(registry, call({ path: "denied.txt", content: "blocked" })),
            ),
          ).toEqual({
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: edit" },
          })
          expect(assertions.map((input) => input.action)).toEqual(["edit"])
          expect(writes).toEqual([])
        }),
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )
})
