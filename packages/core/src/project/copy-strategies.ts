import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { Git } from "../git"
import { DirectoryUnavailableError, StrategyID, type ListEntry, type Strategy } from "./copy"

export function makeGitWorktreeStrategy(input: {
  git: Git.Interface
  canonical: (directory: AbsolutePath) => Effect.Effect<AbsolutePath, DirectoryUnavailableError>
}) {
  return {
    id: StrategyID.make("git_worktree"),
    create: Effect.fn("ProjectCopy.GitWorktree.create")(function* (options) {
      const repository = yield* input.git.repo.discover(options.sourceDirectory)
      if (!repository) return yield* new DirectoryUnavailableError({ directory: options.sourceDirectory })
      yield* input.git.worktree.create({ repository, directory: options.directory })
      return { directory: yield* input.canonical(options.directory) }
    }),
    remove: Effect.fn("ProjectCopy.GitWorktree.remove")(function* (options) {
      const found = yield* input.git.repo.discover(options.directory)
      if (!found) return yield* new DirectoryUnavailableError({ directory: options.directory })
      yield* input.git.worktree.remove({ repository: found, directory: options.directory, force: options.force })
    }),
    list: Effect.fn("ProjectCopy.GitWorktree.list")(function* (directory) {
      const found = yield* input.git.repo.discover(directory)
      if (!found) return yield* new DirectoryUnavailableError({ directory })
      const entries = yield* input.git.worktree.list(found)
      return yield* Effect.forEach(entries, (entry) =>
        input.canonical(entry.directory).pipe(
          Effect.map((directory) => ({ directory, type: entry.kind === "main" ? "root" : "copy" }) as const),
          Effect.catchTag("ProjectCopy.DirectoryUnavailableError", () => Effect.succeed(undefined)),
        ),
      ).pipe(Effect.map((items) => items.filter((item): item is ListEntry => item !== undefined)))
    }),
  } satisfies Strategy
}
