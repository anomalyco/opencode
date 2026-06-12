import path from "path"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { Git } from "../git"
import { DirectoryUnavailableError, StrategyID, type ListEntry, type Strategy } from "./copy"

export function makeGitWorktreeStrategy(input: {
  git: Git.Interface
  canonical: (directory: AbsolutePath) => Effect.Effect<AbsolutePath, DirectoryUnavailableError>
}) {
  const repo = (sourceDirectory: AbsolutePath) =>
    ({ directory: sourceDirectory, store: sourceDirectory }) satisfies Git.Repo

  return {
    id: StrategyID.make("git_worktree"),
    create: Effect.fn("ProjectCopy.GitWorktree.create")(function* (options) {
      yield* input.git.worktreeCreate({ repo: repo(options.sourceDirectory), directory: options.directory })
      return { directory: yield* input.canonical(options.directory) }
    }),
    remove: Effect.fn("ProjectCopy.GitWorktree.remove")(function* (options) {
      const found = yield* input.git.find(options.directory)
      if (!found) return yield* new DirectoryUnavailableError({ directory: options.directory })
      yield* input.git.worktreeRemove({ repo: found, directory: options.directory, force: options.force })
    }),
    list: Effect.fn("ProjectCopy.GitWorktree.list")(function* (directory) {
      const found = yield* input.git.find(directory)
      if (!found) return yield* new DirectoryUnavailableError({ directory })
      const core = path.basename(found.store) === ".git" ? path.dirname(found.store) : found.store
      const entries = yield* input.git.worktreeList(found)
      return yield* Effect.forEach(entries, (entry) =>
        input.canonical(entry).pipe(
          Effect.map((directory) => ({ directory, type: entry === core ? "root" : "copy" }) as const),
          Effect.catchTag("ProjectCopy.DirectoryUnavailableError", () => Effect.succeed(undefined)),
        ),
      ).pipe(Effect.map((items) => items.filter((item): item is ListEntry => item !== undefined)))
    }),
  } satisfies Strategy
}
