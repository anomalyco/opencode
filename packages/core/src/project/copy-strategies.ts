import path from "path"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { type Copy, type Strategy, type StrategyID } from "./copy"
import type { DirectoryUnavailableError } from "./copy"

export function makeStrategies(input: {
  git: Git.Interface
  fs: FSUtil.Interface
  canonical: (directory: AbsolutePath) => Effect.Effect<AbsolutePath, DirectoryUnavailableError>
}) {
  const repo = (sourceDirectory: AbsolutePath) => ({ directory: sourceDirectory, store: sourceDirectory }) satisfies Git.Repo

  const gitWorktree: Strategy = {
    id: "git_worktree",
    create: Effect.fn("ProjectCopy.GitWorktree.create")(function* (options) {
      yield* input.git.worktreeCreate({ repo: repo(options.sourceDirectory), directory: options.directory })
      return { directory: yield* input.canonical(options.directory) }
    }),
    remove: Effect.fn("ProjectCopy.GitWorktree.remove")(function* (directory) {
      yield* input.git.worktreeRemove({ repo: repo(directory), directory })
    }),
    list: Effect.fn("ProjectCopy.GitWorktree.list")(function* (directory) {
      const entries = yield* input.git.worktreeList(repo(directory))
      return yield* Effect.forEach(entries, (entry) =>
        entry === directory ? Effect.succeed(undefined) : input.canonical(entry).pipe(Effect.map((directory) => ({ directory }))),
      ).pipe(Effect.map((items) => items.filter((item): item is Copy => item !== undefined)))
    }),
    detect: Effect.fn("ProjectCopy.GitWorktree.detect")(function* (inputDirectory) {
      return yield* input.fs.isFile(path.join(inputDirectory, ".git"))
    }),
  }

  return new Map<StrategyID, Strategy>([[gitWorktree.id, gitWorktree]])
}
