export * as CommitGen from "."

import { Context, Effect, Layer } from "effect"

export interface GitDiff {
  staged: string
  status: string
  recentCommits: string
  hasStaged: boolean
}

export interface Interface {
  readonly collectDiff: (cwd: string) => Effect.Effect<GitDiff>
  readonly buildPrompt: (diff: GitDiff, sessionContext: string) => string
  readonly executeCommit: (cwd: string, message: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CommitGen") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const collectDiff = Effect.fn("CommitGen.collectDiff")(function* (cwd: string) {
      const shell = (cmd: string[]) =>
        Effect.promise<string>(async () => {
          const proc = Bun.spawn(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] })
          const stdout = await new Response(proc.stdout).text()
          await new Response(proc.stderr).text()
          return stdout
        })

      const [staged, status, recentCommits] = yield* Effect.all(
        [
          shell(["git", "diff", "--staged"]),
          shell(["git", "status", "--porcelain"]),
          shell(["git", "log", "--oneline", "-5"]),
        ],
        { concurrency: 3 },
      )

      return { staged, status, recentCommits, hasStaged: staged.length > 0 }
    })

    const buildPrompt = (diff: GitDiff, sessionContext: string) =>
      [
        `Generate a conventional commit message based on the following changes.`,
        ``,
        `Context from the session:`,
        sessionContext || "(no additional context)",
        ``,
        `Changes to commit:`,
        diff.hasStaged ? diff.staged : diff.status,
        ``,
        `Recent commit history (for style reference):`,
        diff.recentCommits || "(no recent commits)",
        ``,
        `Requirements:`,
        `- Use Conventional Commits format: \`type(scope): description\``,
        `- Valid types: feat, fix, docs, style, refactor, test, chore, ci, perf`,
        `- Keep the description under 72 characters`,
        `- Only output the commit message, nothing else`,
      ].join("\n")

    const executeCommit = Effect.fn("CommitGen.executeCommit")(function* (cwd: string, message: string) {
      const proc = Bun.spawn(["git", "commit", "-m", message], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      })
      const output = yield* Effect.promise(async () => {
        const out = await new Response(proc.stdout).text()
        const err = await new Response(proc.stderr).text()
        return out + err
      })
      return output
    })

    return Service.of({ collectDiff, buildPrompt, executeCommit })
  }),
)

export { layer }
