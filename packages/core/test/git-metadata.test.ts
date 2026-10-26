import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Git } from "@opencode/core/git"
import { GitMetadata } from "@opencode/core/git-metadata"
import { AbsolutePath } from "@opencode/core/schema"
import { git, initGit, initRepo } from "./fixture/git"
import { countingSpawner } from "./fixture/spawn"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

async function cli(cwd: string, ...args: string[]) {
  const result = await $`git ${args}`.cwd(cwd).quiet().nothrow()
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined
}

/** Repositories in the layouts the reader handles: packed and loose refs, linked and detached worktrees, a submodule, a symlinked path, an unborn branch and includes. */
async function fixture(root: string) {
  const main = path.join(root, "main")
  const sub = path.join(root, "sub")
  const unborn = path.join(root, "unborn")
  await Promise.all([initRepo(main), initRepo(sub), initGit(unborn)])
  await fs.appendFile(
    path.join(main, ".git", "config"),
    [
      `[remote "origin"]`,
      `\turl = ex:owner/repo.git`,
      `[remote "upstream"]`,
      `\turl = https://example.com/upstream.git`,
      `[url "https://example.com/"]`,
      `\tinsteadOf = ex:`,
      `[include]`,
      `\tpath = extra.gitconfig`,
      `[includeIf "onbranch:main"]`,
      `\tpath = main.gitconfig`,
      "",
    ].join("\n"),
  )
  await fs.writeFile(path.join(main, ".git", "extra.gitconfig"), `[init]\n\tdefaultBranch = "trunk" ; comment\n`)
  await fs.writeFile(path.join(main, ".git", "main.gitconfig"), `[remote "included"]\n\turl = /tmp/included\n`)
  await git(main, "branch", "trunk")
  // A tag with a branch's name makes `%(refname:short)` spell the branch `heads/trunk`.
  await git(main, "tag", "trunk")
  await git(main, "update-ref", "refs/remotes/origin/trunk", "HEAD")
  await git(main, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
  await git(main, "pack-refs", "--all")
  await git(main, "branch", "loose")
  await git(main, "worktree", "add", "-q", "-b", "feature", path.join(root, "linked"))
  await git(main, "worktree", "add", "-q", "--detach", path.join(root, "detached"))
  await git(main, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "mods/sub")
  // Working tree changes never affect metadata.
  await fs.writeFile(path.join(main, "dirty.txt"), "dirty\n")
  await fs.mkdir(path.join(main, "nested", "deep"), { recursive: true })
  await fs.symlink(main, path.join(root, "link"))
  return {
    main,
    directories: [
      main,
      path.join(main, "nested", "deep"),
      path.join(root, "link"),
      path.join(root, "linked"),
      path.join(root, "detached"),
      path.join(main, "mods", "sub"),
      path.join(root, "link", "mods", "sub"),
      unborn,
    ],
  }
}

/** What the spawning `discover` and the other readers report: `rev-parse` runs beside the nearest `.git`. */
async function expected(directory: string): Promise<Record<string, unknown>> {
  const top = await nearestDotGitParent(directory)
  const [layout, head, branch, origin, remoteHead, remotes, defaultBranch] = await Promise.all([
    cli(top, "rev-parse", "--git-dir", "--git-common-dir", "--show-toplevel"),
    cli(directory, "rev-parse", "HEAD"),
    cli(directory, "symbolic-ref", "--quiet", "--short", "HEAD"),
    cli(directory, "remote", "get-url", "origin"),
    cli(directory, "symbolic-ref", "refs/remotes/origin/HEAD"),
    cli(directory, "remote"),
    cli(directory, "config", "init.defaultBranch"),
  ])
  const [gitDirectory, commonDirectory, worktree] = layout!.split("\n").map((line) => path.resolve(top, line))
  return {
    repository: { worktree, gitDirectory, commonDirectory },
    head,
    branch: branch || undefined,
    origin,
    remoteHead: remoteHead?.replace(/^refs\/remotes\/origin\//, ""),
    remotes: remotes ? remotes.split("\n") : [],
    defaultBranch,
  }
}

async function nearestDotGitParent(directory: string): Promise<string> {
  if (await fs.lstat(path.join(directory, ".git")).catch(() => undefined)) return directory
  return nearestDotGitParent(path.dirname(directory))
}

// The reader is POSIX-only; on Windows every call takes the Git path that the other Git tests cover.
describe.skipIf(process.platform === "win32")("GitMetadata", () => {
  it.live("answers like the Git CLI without starting Git", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const root = yield* Effect.promise(() => fs.realpath(tmp.path))
      const setup = yield* Effect.promise(() => fixture(root))
      const wants = yield* Effect.promise(() => Promise.all(setup.directories.map(expected)))
      const branches = yield* Effect.promise(() =>
        cli(setup.main, "for-each-ref", "--format=%(refname:short)", "refs/heads"),
      )
      const counter = countingSpawner()

      yield* Effect.gen(function* () {
        const service = yield* Git.Service
        const read = Effect.forEach(setup.directories, (directory) =>
          Effect.gen(function* () {
            const repository = yield* service.repo.discover(AbsolutePath.make(directory))
            const metadata = yield* service.repo.metadata(AbsolutePath.make(directory))
            if (!repository || !metadata) return { directory, inProcess: false }
            return {
              directory,
              inProcess: true,
              repository: { ...repository },
              head: yield* service.history.head(repository),
              branch: yield* service.history.branch(repository),
              origin: yield* service.remote.get(repository),
              remoteHead: yield* service.history.defaultRemoteBranch(repository),
              remotes: GitMetadata.remotes(metadata),
              defaultBranch: GitMetadata.get(metadata.config, "init", "defaultbranch"),
            }
          }),
        )
        const results = yield* read
        // One `git var -l` per process locates the system and global config files.
        expect(counter.spawns()).toBe(1)
        expect(results).toStrictEqual(
          setup.directories.map((directory, index) => ({ directory, inProcess: true, ...wants[index] })),
        )

        const metadata = (yield* service.repo.metadata(AbsolutePath.make(setup.main)))!
        const names = ["main", "trunk", "heads/trunk", "loose", "feature", "missing"]
        const present = yield* Effect.promise(() =>
          Promise.all(names.map((name) => GitMetadata.hasBranch(metadata, name))),
        )
        expect(names.filter((_, index) => present[index])).toEqual(
          names.filter((name) => branches!.split("\n").includes(name)),
        )

        yield* read
        expect(counter.spawns()).toBe(1)
      }).pipe(Effect.provide(AppNodeBuilder.build(Git.node, [counter.node])))
    }),
  )

  it.live("rereads config locations when the Git config variables change", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const repo = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      yield* Effect.promise(async () => {
        await initRepo(repo)
        await git(repo, "remote", "add", "origin", "https://example.test/repo.git")
        await fs.writeFile(global, '[url "https://mirror.test/"]\n\tinsteadOf = https://example.test/\n')
      })
      const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const [name, value] of [
            ["GIT_CONFIG_GLOBAL", saved.global],
            ["GIT_CONFIG_NOSYSTEM", saved.nosystem],
          ] as const)
            if (value === undefined) delete process.env[name]
            else process.env[name] = value
        }),
      )
      yield* Effect.gen(function* () {
        const service = yield* Git.Service
        const repository = (yield* service.repo.discover(AbsolutePath.make(repo)))!
        const origin = () => service.remote.get(repository)
        expect(yield* origin()).toBe(yield* Effect.promise(() => cli(repo, "remote", "get-url", "origin")))

        process.env.GIT_CONFIG_GLOBAL = global
        expect(yield* origin()).toBe("https://mirror.test/repo.git")
        expect(yield* origin()).toBe(yield* Effect.promise(() => cli(repo, "remote", "get-url", "origin")))

        process.env.GIT_CONFIG_NOSYSTEM = "1"
        expect(GitMetadata.parseConfigFiles("GIT_CONFIG_SYSTEM=/etc/gitconfig\nGIT_CONFIG_GLOBAL=/g\n")).toEqual({
          system: undefined,
          global: ["/g"],
        })
      }).pipe(Effect.provide(AppNodeBuilder.build(Git.node)))
    }),
  )

  it.live("leaves layouts it does not model to Git", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const root = yield* Effect.promise(() => fs.realpath(tmp.path))
      const reftable = path.join(root, "reftable")
      const worktree = path.join(root, "worktree")
      const hasConfig = path.join(root, "hasconfig")
      const includedBare = path.join(root, "included-bare")
      const includedWorktree = path.join(root, "included-worktree")
      yield* Effect.promise(async () => {
        await Promise.all([
          initRepo(reftable),
          initRepo(worktree),
          initRepo(hasConfig),
          initRepo(includedBare),
          initRepo(includedWorktree),
        ])
        await fs.writeFile(path.join(includedBare, ".git", "bare"), "[core]\n\tbare = true\n")
        await fs.appendFile(path.join(includedBare, ".git", "config"), "[include]\n\tpath = bare\n")
        await fs.writeFile(path.join(includedWorktree, ".git", "elsewhere"), `[core]\n\tworktree = ${root}\n`)
        await fs.appendFile(
          path.join(includedWorktree, ".git", "config"),
          `[includeIf "onbranch:${await cli(includedWorktree, "symbolic-ref", "--short", "HEAD")}"]\n\tpath = elsewhere\n`,
        )
        await fs.appendFile(path.join(reftable, ".git", "config"), "[extensions]\n\trefStorage = reftable\n")
        await fs.appendFile(path.join(worktree, ".git", "config"), `[core]\n\tworktree = ${root}\n`)
        await fs.appendFile(
          path.join(hasConfig, ".git", "config"),
          `[includeIf "hasconfig:remote.*.url:x"]\n\tpath = other\n`,
        )
      })
      yield* Effect.gen(function* () {
        const service = yield* Git.Service
        expect(yield* service.repo.metadata(AbsolutePath.make(reftable))).toBeUndefined()
        expect(yield* service.repo.metadata(AbsolutePath.make(worktree))).toBeUndefined()
        expect(yield* service.repo.metadata(AbsolutePath.make(hasConfig))).toBeUndefined()
        expect(yield* Effect.promise(() => GitMetadata.discover(path.join(worktree, ".git")))).toBeUndefined()
        // Layout keys an include sets, or an include that can't be evaluated, leave discovery to Git.
        for (const directory of [includedBare, includedWorktree, hasConfig])
          expect(yield* Effect.promise(() => GitMetadata.discover(path.join(directory, ".git")))).toBeUndefined()
        // Git still answers for them.
        const repository = yield* service.repo.discover(AbsolutePath.make(worktree))
        expect(repository?.worktree).toBe(AbsolutePath.make(root))
      }).pipe(Effect.provide(AppNodeBuilder.build(Git.node)))
    }),
  )
})

describe("GitMetadata.wildmatch", () => {
  it.effect("follows Git's character classes and leaves unmodelled patterns to Git", () =>
    Effect.sync(() => {
      const cases: [pattern: string, value: string, expected: boolean | undefined][] = [
        // No class matches `/` under WM_PATHNAME, negated or not.
        ["a[!b]c", "axc", true],
        ["a[!b]c", "abc", false],
        ["a[!b]c", "a/c", false],
        ["a[^b]c", "a/c", false],
        ["a[/]c", "a/c", false],
        // A `]` first in the class, after any negation, is a member.
        ["a[]]c", "a]c", true],
        ["a[]x]c", "axc", true],
        ["a[!]]c", "a]c", false],
        ["a[!]]c", "axc", true],
        ["a[a-c]d", "abd", true],
        ["a[[]c", "a[c", true],
        // Unterminated classes, POSIX classes, escapes and invalid ranges.
        ["a[!]", "a]", undefined],
        ["a[", "a[", undefined],
        ["[[:alpha:]]", "a", undefined],
        ["a[\\]]c", "a]c", undefined],
        ["a[z-a]c", "abc", undefined],
      ]
      expect(cases.map(([pattern, value]) => GitMetadata.wildmatch(pattern, value, false))).toEqual(
        cases.map((item) => item[2]),
      )
    }),
  )
})

describe("GitMetadata.parseConfig", () => {
  it.effect("follows Git's value syntax", () =>
    Effect.sync(() => {
      const entries = GitMetadata.parseConfig(
        [
          "[Core]",
          "\tBare",
          '\teditor = "vim  -u" ; trailing comment',
          "\tpath = a\\",
          "b",
          '[remote "Origin"]',
          "url = x # comment",
          "[section.Sub]",
          "key = value  ",
        ].join("\n"),
      )
      expect(entries).toEqual([
        { section: "core", subsection: undefined, key: "bare" },
        { section: "core", subsection: undefined, key: "editor", value: "vim  -u" },
        { section: "core", subsection: undefined, key: "path", value: "ab" },
        { section: "remote", subsection: "Origin", key: "url", value: "x" },
        { section: "section", subsection: "sub", key: "key", value: "value" },
      ])
      expect(GitMetadata.parseConfig('[remote "x]\n')).toBeUndefined()
      expect(GitMetadata.parseConfig('[a]\nk = "open\n')).toBeUndefined()
    }),
  )
})
