import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, PlatformError } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { Environment } from "@opencode/core/environment/index"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FileSystem } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Workspace } from "@opencode/core/workspace"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const provide = (directory: string, workspaceID?: Workspace.ID) =>
  Effect.provide(
    LayerNode.compile(FileSystem.node, {
      replacements: [
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make(directory), workspaceID })),
          ),
        ),
      ],
    }),
  )

const provideWorkspace = (directory: string, driver: Environment.MemoryDriver, files = Environment.makeFiles(driver)) =>
  Effect.provide(
    LayerNode.compile(FileSystem.node, {
      replacements: [
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            location({
              directory: AbsolutePath.make(directory),
              workspaceID: Workspace.ID.make("wrk_review_filesystem"),
            }),
          ),
        ),
        Environment.node.replace(Layer.succeed(Environment.Service, { files, spawner: driver.spawner })),
      ],
    }),
  )

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

describe("FileSystem", () => {
  it.live("reads text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "text.txt"), "hello"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2])))
        const service = yield* FileSystem.Service
        const text = yield* service.read({ path: RelativePath.make("text.txt") })
        const binary = yield* service.read({ path: RelativePath.make("data.bin") })
        expect(new TextDecoder().decode(text.content)).toBe("hello")
        expect(text.mime).toBe("text/plain")
        expect(binary.content).toEqual(new Uint8Array([0, 1, 2]))
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists direct children", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))
        const filesystem = yield* FileSystem.Service
        const entries = yield* filesystem.list()
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("src" + path.sep), type: "directory" },
          { path: RelativePath.make("README.md"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("skips host canonicalization for workspace locations at boot", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        // The directory exists only inside the workspace, so boot must not
        // require it to exist on the host.
        const missing = path.join(directory, "workspace-only")
        const workspace = yield* FileSystem.Service.pipe(
          provide(missing, Workspace.ID.make("wrk_filesystem")),
          Effect.exit,
        )
        expect(Exit.isSuccess(workspace)).toBe(true)

        // A local ref with the same missing directory keeps failing boot:
        // host realpath canonicalization stays load-bearing for local placements.
        const local = yield* FileSystem.Service.pipe(provide(missing), Effect.exit)
        expect(Exit.isFailure(local)).toBe(true)
        if (Exit.isFailure(local)) {
          const error = Cause.findErrorOption(local.cause)
          expect(error).toMatchObject({
            _tag: "Some",
            value: {
              _tag: "FileSystem.DirectoryNotFoundError",
              directory: missing,
              message: `Directory not found: ${missing}`,
            },
          })
        }
      }),
    ),
  )

  for (const input of [
    { reason: "PermissionDenied", code: "EACCES", denied: true },
    { reason: "Unknown", code: "EPERM", denied: true },
    { reason: "Unknown", code: "EIO", denied: false },
  ] as const) {
    it.live(`classifies directory initialization failure ${input.code}`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const filesystem = yield* FSUtil.Service
          const cause = PlatformError.systemError({
            _tag: input.reason,
            module: "FileSystem",
            method: "realPath",
            pathOrDescriptor: directory,
            cause: Object.assign(new Error(input.code), { code: input.code }),
          })
          const result = yield* FileSystem.Service.pipe(
            Effect.provide(
              LayerNode.compile(FileSystem.node, {
                replacements: [
                  Location.node.replace(
                    Layer.succeed(Location.Service, location({ directory: AbsolutePath.make(directory) })),
                  ),
                  FSUtil.node.replace(
                    Layer.succeed(FSUtil.Service, {
                      ...filesystem,
                      realPath: (target) => (target === directory ? Effect.fail(cause) : filesystem.realPath(target)),
                    }),
                  ),
                ],
              }),
            ),
            Effect.exit,
          )
          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            if (input.denied) {
              expect(Cause.findErrorOption(result.cause)).toMatchObject({
                _tag: "Some",
                value: {
                  _tag: "FileSystem.DirectoryAccessDeniedError",
                  directory,
                  cause,
                  message: `Access denied to directory: ${directory}`,
                },
              })
              return
            }
            expect(result.cause.reasons.filter(Cause.isDieReason)).toMatchObject([{ defect: cause }])
          }
        }).pipe(Effect.provide(LayerNode.compile(FSUtil.node))),
      ),
    )
  }

  it.live("lists parents and siblings with paths relative to the current location", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const current = path.join(directory, "current")
        yield* Effect.promise(() => fs.mkdir(current))
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "sibling")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "sibling", "file.txt"), "outside"))
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const parent = yield* filesystem.list({ path: RelativePath.make("..") })
          expect(parent).toHaveLength(2)
          expect(parent.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual(
            expect.arrayContaining([
              { path: "." + path.sep, type: "directory" },
              { path: path.join("..", "sibling") + path.sep, type: "directory" },
            ]),
          )
          const sibling = yield* filesystem.list({ path: RelativePath.make("../sibling") })
          expect(sibling.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("..", "sibling", "file.txt")), type: "file" },
          ])
          const absolute = yield* filesystem.list({ path: path.join(directory, "sibling") })
          expect(absolute).toEqual(sibling)
        }).pipe(provide(current))
      }),
    ),
  )

  it.live("canonicalizes local symlinked directories", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const real = path.join(directory, "real")
        yield* Effect.promise(() => fs.mkdir(real))
        yield* Effect.promise(() => fs.writeFile(path.join(real, "file.txt"), "linked"))
        const link = path.join(directory, "link")
        yield* Effect.promise(() => fs.symlink(real, link))
        // Reads resolve through the symlink only because boot canonicalized
        // the location root to the real directory.
        const read = yield* FileSystem.Service.pipe(
          Effect.flatMap((service) => service.read({ path: RelativePath.make("file.txt") })),
          provide(link),
        )
        expect(new TextDecoder().decode(read.content)).toBe("linked")
      }),
    ),
  )

  it.live("rejects lexical escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const current = path.join(directory, "current")
        yield* Effect.promise(() => fs.mkdir(current))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "outside.txt"), "outside"))
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const result = yield* filesystem.read({ path: RelativePath.make("../outside.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(result)).toBe(true)
        }).pipe(provide(current))
      }),
    ),
  )

  it.live("allows listing through an external symlink without allowing file reads", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const current = path.join(directory, "current")
        const outside = path.join(directory, "outside")
        yield* Effect.promise(() => fs.mkdir(current))
        yield* Effect.promise(() => fs.mkdir(outside))
        yield* Effect.promise(() => fs.writeFile(path.join(outside, "file.txt"), "outside"))
        yield* Effect.promise(() => fs.symlink(outside, path.join(current, "link"), "junction"))
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const entries = yield* filesystem.list({ path: RelativePath.make("link") })
          expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("link", "file.txt")), type: "file" },
          ])
          const result = yield* filesystem.read({ path: RelativePath.make("link/file.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(result)).toBe(true)
        }).pipe(provide(current))
      }),
    ),
  )

  for (const collision of [false, true]) {
    it.live(`workspace read and list use remote environment data (host collision: ${collision})`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const workspaceDir = collision ? directory : path.join(directory, "remote-only")
          if (collision) {
            yield* Effect.promise(() => fs.writeFile(path.join(workspaceDir, "host.txt"), "host data"))
            yield* Effect.promise(() => fs.writeFile(path.join(workspaceDir, "host-only.txt"), "host only data"))
          }
          const driver = Environment.makeMemoryDriver()
          const files = Environment.makeFiles(driver)
          yield* files.mkdir(workspaceDir)
          yield* files.write(path.join(workspaceDir, "remote.txt"), new TextEncoder().encode("workspace data"))
          if (collision) {
            yield* files.write(path.join(workspaceDir, "host.txt"), new TextEncoder().encode("workspace collision"))
          }
          yield* Effect.gen(function* () {
            const filesystem = yield* FileSystem.Service
            const entries = yield* filesystem.list()
            expect(entries.map((entry) => entry.path).sort()).toEqual(
              (collision
                ? [RelativePath.make("host.txt"), RelativePath.make("remote.txt")]
                : [RelativePath.make("remote.txt")]
              ).sort(),
            )
            const result = yield* filesystem.read({ path: RelativePath.make("remote.txt") })
            expect(new TextDecoder().decode(result.content)).toBe("workspace data")
            if (collision) {
              const read = yield* filesystem.read({ path: RelativePath.make("host.txt") })
              expect(new TextDecoder().decode(read.content)).toBe("workspace collision")
              const missing = yield* filesystem.read({ path: RelativePath.make("host-only.txt") }).pipe(Effect.exit)
              expect(Exit.isFailure(missing)).toBe(true)
              if (Exit.isFailure(missing)) {
                expect(Cause.findErrorOption(missing.cause)).toMatchObject({
                  _tag: "Some",
                  value: { _tag: "FileSystem.NotFoundError", path: "host-only.txt" },
                })
              }
            }
          }).pipe(
            Effect.provide(
              LayerNode.compile(FileSystem.node, {
                replacements: [
                  Location.node.replace(
                    Layer.succeed(
                      Location.Service,
                      Location.Service.of(
                        location({
                          directory: AbsolutePath.make(workspaceDir),
                          workspaceID: Workspace.ID.make("wrk_filesystem_test"),
                        }),
                      ),
                    ),
                  ),
                  Environment.node.replace(
                    Layer.succeed(Environment.Service, {
                      files,
                      spawner: driver.spawner,
                    }),
                  ),
                ],
              }),
            ),
          )
        }),
      ),
    )
  }

  it.live("canonicalizes workspace symlinked files and rejects external workspace symlinks", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const workspaceDir = path.join(directory, "workspace")
        const driver = Environment.makeMemoryDriver()
        const files = Environment.makeFiles(driver)
        yield* files.mkdir(workspaceDir)
        yield* files.write(path.join(workspaceDir, "real.txt"), new TextEncoder().encode("real data"))
        yield* driver.symlink("real.txt", path.join(workspaceDir, "link.txt"))

        const outsideDir = path.join(directory, "outside")
        yield* files.mkdir(outsideDir)
        yield* files.write(path.join(outsideDir, "secret.txt"), new TextEncoder().encode("secret"))
        yield* driver.symlink(path.join(outsideDir, "secret.txt"), path.join(workspaceDir, "external.txt"))

        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          // Reading internal symlink succeeds
          const read = yield* filesystem.read({ path: RelativePath.make("link.txt") })
          expect(new TextDecoder().decode(read.content)).toBe("real data")

          // Reading external symlink fails (escapes location)
          const external = yield* filesystem.read({ path: RelativePath.make("external.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(external)).toBe(true)
          if (Exit.isFailure(external)) {
            expect(external.cause.reasons.filter(Cause.isDieReason)).toMatchObject([
              { defect: new Error("Path escapes the location") },
            ])
          }
          const lexical = yield* filesystem.read({ path: RelativePath.make("../outside/secret.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(lexical)).toBe(true)
          if (Exit.isFailure(lexical)) {
            expect(lexical.cause.reasons.filter(Cause.isDieReason)).toMatchObject([
              { defect: new Error("Path escapes the location") },
            ])
          }
          // Directory navigation can leave the location, but stays on the workspace filesystem.
          expect(yield* filesystem.list({ path: "../outside" })).toEqual([
            FileSystem.Entry.make({ path: RelativePath.make(path.join("..", "outside", "secret.txt")), type: "file" }),
          ])
        }).pipe(
          Effect.provide(
            LayerNode.compile(FileSystem.node, {
              replacements: [
                Location.node.replace(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(
                      location({
                        directory: AbsolutePath.make(workspaceDir),
                        workspaceID: Workspace.ID.make("wrk_filesystem_symlink_test"),
                      }),
                    ),
                  ),
                ),
                Environment.node.replace(
                  Layer.succeed(Environment.Service, {
                    files,
                    spawner: driver.spawner,
                  }),
                ),
              ],
            }),
          ),
        )
      }),
    ),
  )

  it.live("preserves workspace binary bytes and directory navigation semantics", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const current = path.join(directory, "current")
        const driver = Environment.makeMemoryDriver()
        const files = Environment.makeFiles(driver)
        yield* files.mkdir(path.join(current, "z-dir"))
        yield* files.mkdir(path.join(current, "a-dir"))
        yield* files.write(path.join(current, "z.bin"), new Uint8Array([0, 255, 10, 13, 128]))
        yield* files.write(path.join(current, "a.txt\n"), new TextEncoder().encode("newline name"))
        yield* files.write(path.join(directory, "outside", "remote.txt"), new Uint8Array([255]))
        yield* driver.symlink("z.bin", path.join(current, "binary-link"))
        yield* driver.symlink("../outside", path.join(current, "directory-link"))
        yield* driver.symlink("missing", path.join(current, "dangling-link"))
        yield* Effect.gen(function* () {
          const service = yield* FileSystem.Service
          expect((yield* service.list()).map((entry) => [entry.path, entry.type])).toEqual([
            [RelativePath.make("a-dir/"), "directory"],
            [RelativePath.make("z-dir/"), "directory"],
            [RelativePath.make("a.txt\n"), "file"],
            [RelativePath.make("z.bin"), "file"],
          ])
          expect((yield* service.read({ path: RelativePath.make("binary-link") })).content).toEqual(
            new Uint8Array([0, 255, 10, 13, 128]),
          )
          expect(yield* service.list({ path: "directory-link" })).toEqual([
            FileSystem.Entry.make({ path: RelativePath.make("directory-link/remote.txt"), type: "file" }),
          ])
          const missing = yield* service.read({ path: RelativePath.make("dangling-link") }).pipe(Effect.flip)
          expect(missing).toMatchObject({ _tag: "FileSystem.NotFoundError", path: "dangling-link" })
          const readDirectory = yield* service.read({ path: RelativePath.make("a-dir") }).pipe(Effect.exit)
          expect(Exit.isFailure(readDirectory)).toBe(true)
          if (Exit.isFailure(readDirectory)) {
            expect(readDirectory.cause.reasons.filter(Cause.isDieReason)).toMatchObject([
              { defect: new Error("Path is not a file") },
            ])
          }
          const listFile = yield* service.list({ path: "z.bin" }).pipe(Effect.exit)
          expect(Exit.isFailure(listFile)).toBe(true)
          if (Exit.isFailure(listFile)) {
            expect(listFile.cause.reasons.filter(Cause.isDieReason)).toMatchObject([
              { defect: new Error("Path is not a directory") },
            ])
          }
        }).pipe(provideWorkspace(current, driver, files))
      }),
    ),
  )

  for (const operation of ["realPath", "read", "list"] as const) {
    it.live(`preserves workspace ${operation} backend failures`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const driver = Environment.makeMemoryDriver()
          const base = Environment.makeFiles(driver)
          yield* base.mkdir(directory)
          yield* base.write(path.join(directory, "file.txt"), new TextEncoder().encode("workspace"))
          const error = new Environment.Failed({ path: directory, cause: new Error("Backend unavailable") })
          const files: Environment.Files = {
            ...base,
            ...(operation === "realPath"
              ? { realPath: (target: string) => (target === directory ? base.realPath(target) : Effect.fail(error)) }
              : {}),
            ...(operation === "read" ? { read: () => Effect.fail(error) } : {}),
            ...(operation === "list" ? { list: () => Effect.fail(error) } : {}),
          }
          const result = yield* Effect.gen(function* () {
            const service = yield* FileSystem.Service
            if (operation === "list") return yield* service.list()
            return yield* service.read({ path: RelativePath.make("file.txt") })
          }).pipe(provideWorkspace(directory, driver, files), Effect.exit)
          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            expect(result.cause.reasons.filter(Cause.isDieReason)).toMatchObject([{ defect: error }])
          }
        }),
      ),
    )
  }

  it.live("returns typed NotFoundError for missing files in local locations", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const filesystem = yield* FileSystem.Service
        const missing = yield* filesystem.read({ path: RelativePath.make("missing.txt") }).pipe(Effect.exit)
        expect(Exit.isFailure(missing)).toBe(true)
        if (Exit.isFailure(missing)) {
          expect(Cause.findErrorOption(missing.cause)).toMatchObject({
            _tag: "Some",
            value: { _tag: "FileSystem.NotFoundError", path: "missing.txt" },
          })
        }
      }).pipe(provide(directory)),
    ),
  )

  it.live("returns typed NotFoundError for missing files in workspace locations", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const workspaceDir = path.join(directory, "workspace")
        const driver = Environment.makeMemoryDriver()
        const files = Environment.makeFiles(driver)
        yield* files.mkdir(workspaceDir)
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const missing = yield* filesystem.read({ path: RelativePath.make("missing.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(missing)).toBe(true)
          if (Exit.isFailure(missing)) {
            expect(Cause.findErrorOption(missing.cause)).toMatchObject({
              _tag: "Some",
              value: { _tag: "FileSystem.NotFoundError", path: "missing.txt" },
            })
          }
        }).pipe(
          Effect.provide(
            LayerNode.compile(FileSystem.node, {
              replacements: [
                Location.node.replace(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(
                      location({
                        directory: AbsolutePath.make(workspaceDir),
                        workspaceID: Workspace.ID.make("wrk_filesystem_missing_test"),
                      }),
                    ),
                  ),
                ),
                Environment.node.replace(
                  Layer.succeed(Environment.Service, {
                    files,
                    spawner: driver.spawner,
                  }),
                ),
              ],
            }),
          ),
        )
      }),
    ),
  )

  for (const failure of ["missing", "failed"] as const) {
    it.live(`does not read workspace files when root canonicalization ${failure}`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const driver = Environment.makeMemoryDriver()
          const baseFiles = Environment.makeFiles(driver)
          yield* baseFiles.mkdir(directory)
          yield* baseFiles.write(path.join(directory, "file.txt"), new TextEncoder().encode("workspace data"))
          const error =
            failure === "missing"
              ? new Environment.NotFound({ path: directory })
              : new Environment.Failed({ path: directory, cause: new Error("Canonicalization failed") })
          const files: Environment.Files = {
            ...baseFiles,
            realPath: (target) => (target === directory ? Effect.fail(error) : baseFiles.realPath(target)),
          }
          const result = yield* FileSystem.Service.pipe(
            Effect.flatMap((filesystem) => filesystem.read({ path: RelativePath.make("file.txt") })),
            Effect.provide(
              LayerNode.compile(FileSystem.node, {
                replacements: [
                  Location.node.replace(
                    Layer.succeed(
                      Location.Service,
                      location({
                        directory: AbsolutePath.make(directory),
                        workspaceID: Workspace.ID.make("wrk_root_failure_test"),
                      }),
                    ),
                  ),
                  Environment.node.replace(Layer.succeed(Environment.Service, { files, spawner: driver.spawner })),
                ],
              }),
            ),
            Effect.exit,
          )
          expect(Exit.isFailure(result)).toBe(true)
          if (!Exit.isFailure(result)) return
          if (failure === "missing") {
            expect(Cause.findErrorOption(result.cause)).toMatchObject({
              _tag: "Some",
              value: { _tag: "FileSystem.NotFoundError", path: "file.txt" },
            })
            return
          }
          expect(result.cause.reasons.filter(Cause.isDieReason)).toMatchObject([{ defect: error }])
        }),
      ),
    )
  }

  it.live("returns typed NotFoundError when remote file is removed after canonicalization", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const workspaceDir = path.join(directory, "workspace")
        const driver = Environment.makeMemoryDriver()
        const baseFiles = Environment.makeFiles(driver)
        yield* baseFiles.mkdir(workspaceDir)
        const files: Environment.Files = {
          ...baseFiles,
          realPath: (target) =>
            target === path.join(workspaceDir, "gone.txt") ? Effect.succeed(target) : baseFiles.realPath(target),
          read: (target) =>
            target === path.join(workspaceDir, "gone.txt")
              ? Effect.fail(new Environment.NotFound({ path: target }))
              : baseFiles.read(target),
        }
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const result = yield* filesystem.read({ path: RelativePath.make("gone.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            expect(Cause.findErrorOption(result.cause)).toMatchObject({
              _tag: "Some",
              value: { _tag: "FileSystem.NotFoundError", path: "gone.txt" },
            })
          }
        }).pipe(
          Effect.provide(
            LayerNode.compile(FileSystem.node, {
              replacements: [
                Location.node.replace(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(
                      location({
                        directory: AbsolutePath.make(workspaceDir),
                        workspaceID: Workspace.ID.make("wrk_filesystem_gone_test"),
                      }),
                    ),
                  ),
                ),
                Environment.node.replace(
                  Layer.succeed(Environment.Service, {
                    files,
                    spawner: driver.spawner,
                  }),
                ),
              ],
            }),
          ),
        )
      }),
    ),
  )

  it.live("resolves files within a symlinked workspace root and rejects external symlinks", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const realDir = path.join(directory, "real-workspace")
        const linkDir = path.join(directory, "symlink-workspace")
        const outsideDir = path.join(directory, "outside")

        const driver = Environment.makeMemoryDriver()
        const files = Environment.makeFiles(driver)
        yield* files.mkdir(realDir)
        yield* files.mkdir(outsideDir)
        yield* files.write(path.join(realDir, "file.txt"), new TextEncoder().encode("content in real"))
        yield* files.write(path.join(outsideDir, "secret.txt"), new TextEncoder().encode("secret"))

        yield* driver.symlink(realDir, linkDir)
        yield* driver.symlink(path.join(outsideDir, "secret.txt"), path.join(realDir, "external.txt"))

        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const read = yield* filesystem.read({ path: RelativePath.make("file.txt") })
          expect(new TextDecoder().decode(read.content)).toBe("content in real")

          const entries = yield* filesystem.list()
          expect(entries.map((entry) => entry.path)).toEqual([RelativePath.make("file.txt")])

          const external = yield* filesystem.read({ path: RelativePath.make("external.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(external)).toBe(true)
        }).pipe(
          Effect.provide(
            LayerNode.compile(FileSystem.node, {
              replacements: [
                Location.node.replace(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(
                      location({
                        directory: AbsolutePath.make(linkDir),
                        workspaceID: Workspace.ID.make("wrk_symlinked_root_test"),
                      }),
                    ),
                  ),
                ),
                Environment.node.replace(
                  Layer.succeed(Environment.Service, {
                    files,
                    spawner: driver.spawner,
                  }),
                ),
              ],
            }),
          ),
        )
      }),
    ),
  )

  for (const rootNewline of [false, true]) {
    it.live(`exec canonicalization preserves exact path bytes with trailing newlines (root newline: ${rootNewline})`, () =>
      withTmp((temporary) =>
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
          const shim = path.join(temporary, "bin")
          yield* Effect.promise(() => fs.mkdir(shim))
          // GNU realpath supports -z -e; on macOS/BSD, adapt arguments to preserve canonical paths with delimiter
          const shimScript = `#!/bin/sh
zero=0
target=""
while [ $# -gt 0 ]; do
  case "$1" in
    -z) zero=1 ;;
    -e|--) ;;
    *) target="$1" ;;
  esac
  shift
done
res=$(/bin/realpath "$target" 2>&1 && printf x) || {
  code=$?
  printf "%s" "\${res%x}" >&2
  exit $code
}
res="\${res%x}"
res="\${res%
}"
if [ "$zero" = 1 ]; then
  printf "%s\\0" "$res"
else
  printf "%s\\n" "$res"
fi
`
          yield* Effect.promise(() => fs.writeFile(path.join(shim, "realpath"), shimScript, { mode: 0o755 }))
          const routed = ChildProcessSpawner.make((command) => {
            if (command._tag !== "StandardCommand") return spawner.spawn(command)
            return spawner.spawn({
              ...command,
              options: { ...command.options, env: { ...command.options.env, PATH: `${shim}:/usr/bin:/bin` } },
            })
          })
          const base = Environment.makeFiles(Environment.makeLocalDriver(spawner))
          const files = { ...base, realPath: Environment.execDefaults(routed).realPath }
          const directory = path.join(temporary, rootNewline ? "root\n" : "root")
          yield* base.mkdir(directory)
          yield* base.write(path.join(directory, "value.txt"), new TextEncoder().encode("plain file"))
          yield* base.write(path.join(directory, "value.txt\n"), new TextEncoder().encode("newline file"))
          yield* Effect.gen(function* () {
            const service = yield* FileSystem.Service
            const result = yield* service.read({ path: RelativePath.make(rootNewline ? "value.txt" : "value.txt\n") })
            expect(new TextDecoder().decode(result.content)).toBe(rootNewline ? "plain file" : "newline file")
          }).pipe(
            Effect.provide(
              LayerNode.compile(FileSystem.node, {
                replacements: [
                  Location.node.replace(
                    Layer.succeed(
                      Location.Service,
                      Location.Service.of(
                        location({
                          directory: AbsolutePath.make(directory),
                          workspaceID: Workspace.ID.make("wrk_exec_newline_test"),
                        }),
                      ),
                    ),
                  ),
                  Environment.node.replace(
                    Layer.succeed(Environment.Service, {
                      files,
                      spawner: routed,
                    }),
                  ),
                ],
              }),
            ),
          )
        }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))),
      ),
    )
  }
})
