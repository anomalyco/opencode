import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigReference } from "@opencode-ai/core/config/reference"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { ProjectReference } from "@opencode-ai/core/project-reference"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

describe("ProjectReference", () => {
  it.live("uses the broad experimental flag unless references are explicitly configured", () =>
    withEnv(
      { OPENCODE_EXPERIMENTAL: "true", OPENCODE_EXPERIMENTAL_REFERENCES: undefined },
      Effect.sync(() => {
        expect(Flag.OPENCODE_EXPERIMENTAL_REFERENCES).toBe(true)
      }),
    ).pipe(
      Effect.flatMap(() =>
        withEnv(
          { OPENCODE_EXPERIMENTAL: "true", OPENCODE_EXPERIMENTAL_REFERENCES: "false" },
          Effect.sync(() => {
            expect(Flag.OPENCODE_EXPERIMENTAL_REFERENCES).toBe(false)
          }),
        ),
      ),
    ),
  )

  it.live("normalizes aliases and resolves relative local paths from the project root", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const project = path.join(tmp.path, "project")
        const nested = path.join(project, "packages", "app")
        yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))

        const references = ProjectReference.resolveAll({
          references: ConfigReference.normalize({
            docs: { path: "./docs" },
            home: "~/notes",
            sdk: { repository: "owner/repo", branch: "main" },
            shorthand: "owner/other",
            invalid: "not-a-repo",
            "bad/name": "owner/repo",
          }),
          directory: project,
          home: path.join(tmp.path, "home"),
          repos: path.join(tmp.path, "repos"),
        })

        expect(references).toMatchObject([
          { name: "docs", kind: "local", path: path.join(project, "docs") },
          { name: "home", kind: "local", path: path.join(tmp.path, "home", "notes") },
          { name: "sdk", kind: "git", branch: "main" },
          { name: "shorthand", kind: "git" },
          { name: "invalid", kind: "invalid", repository: "not-a-repo" },
          { name: "bad/name", kind: "invalid" },
        ])
      }),
    ),
  )

  it.live("marks same-cache references with different branches invalid", () =>
    Effect.sync(() => {
      const references = ProjectReference.resolveAll({
        references: ConfigReference.normalize({
          main: { repository: "owner/repo", branch: "main" },
          dev: { repository: "github.com/owner/repo", branch: "dev" },
          alsoMain: { repository: "https://github.com/owner/repo", branch: "main" },
        }),
        directory: "/project",
        home: "/home",
        repos: "/repos",
      })

      expect(references.map((reference) => reference.kind)).toEqual(["git", "invalid", "git"])
      expect(references[1]?.kind === "invalid" ? references[1].message : "").toContain("conflicts with @main")
    }),
  )

  it.live("merges config aliases and exposes mention and managed-path operations", () =>
    withoutReferences(
      withTmp((tmp) => {
        const calls: RepositoryCache.EnsureInput[] = []
        const project = path.join(tmp.path, "project")
        const nested = path.join(project, "packages", "app")
        const docs = path.join(project, "docs")
        const repos = path.join(tmp.path, "repos")
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(nested, { recursive: true })
            await fs.mkdir(docs)
            await fs.writeFile(path.join(docs, "README.md"), "docs")
          })

          yield* withReferences(
            Effect.gen(function* () {
              const references = yield* ProjectReference.Service
              const git = path.join(repos, "github.com", "owner", "repo")

              expect(yield* references.list()).toMatchObject([
                { name: "docs", kind: "local", path: docs },
                { name: "sdk", kind: "git", path: git },
              ])
              expect(yield* references.resolveMention("docs/README.md")).toMatchObject({
                name: "docs",
                kind: "reference",
                target: "README.md",
                path: path.join(docs, "README.md"),
              })
              expect(yield* references.resolveMention("docs/missing.md")).toMatchObject({
                name: "docs",
                kind: "missing",
              })
              expect(yield* references.resolveMention("docs/../outside.md")).toMatchObject({
                name: "docs",
                kind: "invalid",
              })
              expect(yield* references.resolveMention("unknown")).toBeUndefined()
              expect(yield* references.resolveMention("sdk")).toMatchObject({
                name: "sdk",
                kind: "reference",
                path: git,
              })
              expect(yield* references.containsManagedPath(path.join(git, "README.md"))).toBe(true)
              expect(yield* references.containsManagedPath(path.join(docs, "README.md"))).toBe(false)
              yield* references.ensurePath()
              expect(calls).toHaveLength(1)
            }).pipe(
              Effect.provide(
                testLayer({
                  directory: nested,
                  project,
                  repos,
                  documents: [
                    document({ docs: { path: "./old-docs" }, sdk: "owner/old" }),
                    document({ docs: { path: "./docs" }, sdk: { repository: "owner/repo", branch: "main" } }),
                  ],
                  ensure: (input) => Effect.sync(() => result(repos, calls, input)),
                }),
              ),
            ),
          )
        })
      }),
    ),
  )

  it.live("is inert while the runtime flag is disabled", () =>
    withoutReferences(
      withTmp((tmp) => {
        const calls: RepositoryCache.EnsureInput[] = []
        return Effect.gen(function* () {
          const references = yield* ProjectReference.Service
          expect(yield* references.list()).toEqual([])
          expect(yield* references.get("sdk")).toBeUndefined()
          expect(yield* references.resolveMention("sdk")).toBeUndefined()
          expect(
            yield* references.containsManagedPath(path.join(tmp.path, "repos", "github.com", "owner", "repo")),
          ).toBe(false)
          yield* references.ensurePath()
          expect(calls).toEqual([])
        }).pipe(
          Effect.provide(
            testLayer({
              directory: tmp.path,
              project: tmp.path,
              repos: path.join(tmp.path, "repos"),
              documents: [document({ sdk: "owner/repo" })],
              ensure: (input) => Effect.sync(() => result(path.join(tmp.path, "repos"), calls, input)),
            }),
          ),
        )
      }),
    ),
  )

  it.live("starts Git materialization in the background without blocking the location layer", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        yield* withReferences(
          Effect.gen(function* () {
            expect(yield* (yield* ProjectReference.Service).list()).toHaveLength(1)
            yield* Deferred.await(started).pipe(
              Effect.timeoutOrElse({
                duration: "1 second",
                orElse: () => Effect.die(new Error("refresh did not start")),
              }),
            )
          }).pipe(
            Effect.provide(
              testLayer({
                directory: tmp.path,
                project: tmp.path,
                repos: path.join(tmp.path, "repos"),
                documents: [document({ sdk: "owner/repo" })],
                ensure: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
              }),
            ),
          ),
        )
      }),
    ),
  )
})

function document(references: ConfigReference.Info) {
  return new Config.Document({ type: "document", info: Schema.decodeUnknownSync(Config.Info)({ references }) })
}

function result(
  repos: string,
  calls: RepositoryCache.EnsureInput[],
  input: RepositoryCache.EnsureInput,
): RepositoryCache.Result {
  calls.push(input)
  return {
    repository: input.reference.label,
    host: input.reference.host,
    remote: input.reference.remote,
    localPath: Repository.cachePath(repos, input.reference),
    status: "cached",
    branch: input.branch,
  }
}

function testLayer(input: {
  directory: string
  project: string
  repos: string
  documents: Config.Document[]
  ensure: RepositoryCache.Interface["ensure"]
}) {
  return ProjectReference.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FSUtil.defaultLayer,
        Global.layerWith({ home: path.join(input.directory, "home"), repos: input.repos }),
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location(
              { directory: AbsolutePath.make(input.directory) },
              { projectDirectory: AbsolutePath.make(input.project) },
            ),
          ),
        ),
        Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed(input.documents) })),
        Layer.succeed(RepositoryCache.Service, RepositoryCache.Service.of({ ensure: input.ensure })),
      ),
    ),
  )
}

function withTmp<A, E, R>(body: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    body,
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )
}

function withReferences<A, E, R>(body: Effect.Effect<A, E, R>) {
  return withEnv({ OPENCODE_EXPERIMENTAL_REFERENCES: "true" }, body)
}

function withoutReferences<A, E, R>(body: Effect.Effect<A, E, R>) {
  return withEnv({ OPENCODE_EXPERIMENTAL: undefined, OPENCODE_EXPERIMENTAL_REFERENCES: undefined }, body)
}

function withEnv<A, E, R>(env: Record<string, string | undefined>, body: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return previous
    }),
    () => body,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}
