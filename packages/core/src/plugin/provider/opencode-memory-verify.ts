export * as OpencodeMemoryVerify from "./opencode-memory-verify.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import type { AppProcess } from "@opencode/util/process"
import { Effect, Semaphore } from "effect"
import { ChildProcess } from "effect/process"
import type { Git } from "../../git.js"
import { AbsolutePath } from "../../schema.js"
import { ShellSelect } from "../../shell/select.js"

/** A test file, by its path: under a test directory, or named as one. */
const TEST_FILE = /(?:^|\/)(?:tests?|spec|__tests__)\/|(?:^|\/)test_[^/]+$|[._-](?:test|spec)\.[^/]+$/
/** How long one verification, all four runs and the worktree included, may take. */
const TIMEOUT = "10 minutes"

/** What a user turn showed: the commits the session made and its test runs, in order. */
export interface Turn {
  readonly commits: ReadonlyArray<string>
  readonly tests: ReadonlyArray<{ readonly command: string; readonly failed: boolean }>
}

/**
 * Strict local evidence that an observed fix holds, for work no CI checks. `verify` answers the commit of `turn` that
 * changed every file in `paths` when a test of the turn that failed, then passed, fails twice at the commit's parent
 * with the commit's test files added and passes twice at the commit, re-run in the session's shell and environment in
 * a temporary worktree of `repository`, removed afterwards. `false` when the re-run fell short or didn't finish in
 * time, undefined while the turn shows no such commit and test yet. One verification runs at a time.
 */
export const make = (deps: {
  readonly git: Git.Interface
  readonly processes: AppProcess.Interface
  readonly shell: Effect.Effect<string>
}) => {
  const one = Semaphore.makeUnsafe(1)
  const git = (cwd: string, args: ReadonlyArray<string>) =>
    deps.processes.run(ChildProcess.make("git", [...args], { cwd, stdin: "ignore" })).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout.toString() : undefined)),
      Effect.orElseSucceed(() => undefined),
    )

  const verify = Effect.fnUntraced(function* (input: {
    readonly repository: Git.Repository
    readonly turn: Turn
    readonly paths: ReadonlyArray<string>
    readonly env: Readonly<Record<string, string | undefined>>
  }) {
    const test = input.turn.tests.findLast(
      (run, index) =>
        !run.failed && input.turn.tests.slice(0, index).some((item) => item.failed && item.command === run.command),
    )
    // Only files: a glob or nothing named can't be shown to be what the commit changed.
    if (test === undefined || input.paths.length === 0 || input.paths.some((item) => /[*?[\]{}]/.test(item)))
      return undefined
    const root = input.repository.worktree
    const commits = yield* Effect.forEach(input.turn.commits.toReversed(), (sha) =>
      changed(root, sha).pipe(Effect.map((files) => ({ sha, files: files ?? [] }))),
    )
    const commit = commits.find((item) =>
      input.paths.every((entry) =>
        entry.endsWith("/") ? item.files.some((file) => file.startsWith(entry)) : item.files.includes(entry),
      ),
    )
    if (commit === undefined) return undefined
    const sha = commit.sha
    const files = commit.files
    const shell = yield* deps.shell
    const run = (cwd: string) =>
      deps.processes
        .run(
          ChildProcess.make(shell, ShellSelect.args(shell, test.command), {
            cwd,
            env: { ...input.env },
            extendEnv: false,
            stdin: "ignore",
          }),
        )
        .pipe(
          Effect.map((result) => result.exitCode),
          Effect.orElseSucceed(() => undefined),
        )
    const twice = (cwd: string, pass: boolean) =>
      Effect.gen(function* () {
        for (const _ of [1, 2]) {
          const code = yield* run(cwd)
          if (code === undefined || code === null || (code === 0) !== pass) return false
        }
        return true
      })
    return yield* Effect.acquireUseRelease(
      Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-memory-verify-"))),
      (directory) =>
        Effect.gen(function* () {
          const worktree = AbsolutePath.make(path.join(directory, "checkout"))
          yield* deps.git.worktree.create({ repository: input.repository, directory: worktree, ref: `${sha}^` })
          const tests = files.filter((file) => TEST_FILE.test(file))
          if (
            tests.length > 0 &&
            (yield* git(worktree, ["checkout", sha, "--", ...tests.map((file) => `:(literal)${file}`)])) === undefined
          )
            return false
          if (!(yield* twice(worktree, false))) return false
          if ((yield* git(worktree, ["checkout", "--force", "--detach", sha])) === undefined) return false
          return (yield* twice(worktree, true)) ? sha : false
        }),
      (directory) =>
        deps.git.worktree
          .remove({
            repository: input.repository,
            directory: AbsolutePath.make(path.join(directory, "checkout")),
            force: true,
          })
          .pipe(
            Effect.ignore,
            Effect.andThen(Effect.promise(() => fs.rm(directory, { recursive: true, force: true }))),
          ),
    ).pipe(
      Effect.timeout(TIMEOUT),
      Effect.orElseSucceed(() => false as const),
      one.withPermit,
    )
  })

  // The files a commit changed against its parent, or undefined for a root commit or an unknown one.
  const changed = (root: string, sha: string) =>
    git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", `${sha}^`, sha]).pipe(
      Effect.map((text) => text?.split("\0").filter(Boolean)),
    )

  return verify
}
