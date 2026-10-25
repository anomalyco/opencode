import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

/** Interpret `git cherry <target> <sha> <sha>~1` output for a single commit. */
export function ported(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return "present"
  if (lines.every((line) => line.startsWith("-"))) return "present"
  if (lines.every((line) => line.startsWith("+") || line.startsWith("-"))) return "absent"
  return undefined
}

/** Slugify a ref for use inside a branch name. */
export function slug(ref: string) {
  return ref
    .toLowerCase()
    .replace(/^origin\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

/** Branch name for a ported commit. */
export function name(sha: string, target: string) {
  return `port-${sha.slice(0, 7)}-${slug(target)}`
}

/** Parse unmerged paths out of `git status --porcelain=v1` output. */
export function conflicts(text: string) {
  const codes = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]
  return text
    .split("\n")
    .filter((line) => codes.includes(line.slice(0, 2)))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
}

export const PortCommand = effectCmd({
  command: "port <commit>",
  describe: "port a fix onto other branches with cherry-pick",
  builder: (yargs) =>
    yargs
      .positional("commit", {
        type: "string",
        demandOption: true,
        describe: "the commit to port, e.g. the sha of a fix on dev",
      })
      .option("to", {
        type: "string",
        array: true,
        default: [] as string[],
        demandOption: true,
        describe: "target branch to port onto (repeatable)",
      })
      .option("apply", {
        type: "boolean",
        default: false,
        describe: "create a port branch per target and cherry-pick onto it",
      })
      .option("push", {
        type: "boolean",
        default: false,
        describe: "push the created port branches to origin (plain push, never force)",
      }),
  handler: Effect.fn("Cli.port")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const git = yield* Git.Service
    const cwd = ctx.worktree
    const targets: string[] = args.to.filter((entry: unknown): entry is string => typeof entry === "string")
    if (!targets.length) return yield* fail("Pass at least one target branch with --to <branch>.")

    const resolved = yield* git.run(["rev-parse", "--verify", `${args.commit}^{commit}`], { cwd })
    if (resolved.exitCode !== 0) return yield* fail(`Could not resolve ${args.commit} to a commit.`)
    const sha = resolved.text().trim()

    const subject = yield* git.run(["log", "-1", "--format=%s", sha], { cwd })
    UI.println(`Porting ${sha.slice(0, 7)} ${subject.text().trim()}`)

    const states = yield* Effect.forEach(targets, (target) =>
      Effect.gen(function* () {
        const exists = yield* git.run(["rev-parse", "--verify", `${target}^{commit}`], { cwd })
        if (exists.exitCode !== 0) return { target, state: "unknown" as const }
        const cherry = yield* git.run(["cherry", target, sha, `${sha}~1`], { cwd })
        if (cherry.exitCode !== 0) return { target, state: "unknown" as const }
        const state = ported(cherry.text())
        return { target, state: state ?? ("unknown" as const) }
      }),
    )

    const bad = states.filter((entry) => entry.state === "unknown")
    if (bad.length) return yield* fail(`Could not inspect: ${bad.map((entry) => entry.target).join(", ")}`)

    UI.empty()
    for (const entry of states) {
      if (entry.state === "present") UI.println(`  ${entry.target}: already has an equivalent change, skipping`)
      if (entry.state === "absent") UI.println(`  ${entry.target}: needs the fix -> ${name(sha, entry.target)}`)
    }
    UI.empty()

    const pending = states.filter((entry) => entry.state === "absent")
    if (!pending.length) {
      UI.println("Every target already has the fix. Nothing to do.")
      return
    }
    if (!args.apply) {
      UI.println("Dry run. Rerun with --apply to create the port branches. Nothing is ever force-pushed.")
      return
    }

    const { join } = yield* Effect.promise(() => import("node:path"))
    const { tmpdir } = yield* Effect.promise(() => import("node:os"))
    const failures: string[] = []
    yield* Effect.forEach(pending, (entry) =>
      Effect.gen(function* () {
        const branch = name(sha, entry.target)
        const taken = yield* git.run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd })
        if (taken.exitCode === 0) {
          failures.push(`${entry.target}: branch ${branch} already exists`)
          return
        }
        const dir = join(tmpdir(), `bolt-port-${branch}-${Date.now()}`)
        const added = yield* git.run(["worktree", "add", "--detach", dir, entry.target], { cwd })
        if (added.exitCode !== 0) {
          failures.push(`${entry.target}: ${added.stderr.toString().trim() || "failed to create a temp worktree"}`)
          return
        }
        const picked = yield* git.run(["cherry-pick", "-x", sha], { cwd: dir })
        if (picked.exitCode !== 0) {
          const status = yield* git.run(["status", "--porcelain=v1"], { cwd: dir })
          const stuck = conflicts(status.text())
          yield* git.run(["cherry-pick", "--abort"], { cwd: dir })
          yield* git.run(["worktree", "remove", "--force", dir], { cwd })
          failures.push(
            `${entry.target}: cherry-pick conflicts in ${stuck.join(", ") || "unknown files"}. Check out ${entry.target}, cherry-pick ${sha.slice(0, 7)} yourself, and use bolt resolve.`,
          )
          return
        }
        const created = yield* git.run(["branch", branch, "HEAD"], { cwd: dir })
        if (created.exitCode !== 0) {
          yield* git.run(["worktree", "remove", "--force", dir], { cwd })
          failures.push(`${entry.target}: failed to create ${branch}: ${created.stderr.toString().trim()}`)
          return
        }
        yield* git.run(["worktree", "remove", "--force", dir], { cwd })
        UI.println(`Ported onto ${branch}`)
        if (!args.push) return
        const pushed = yield* git.run(["push", "-u", "origin", branch], { cwd })
        if (pushed.exitCode !== 0) {
          failures.push(`${entry.target}: failed to push ${branch}: ${pushed.stderr.toString().trim()}`)
          return
        }
        UI.println(`Pushed ${branch}`)
      }),
    )

    if (!failures.length) {
      UI.println("All ports complete. Open pull requests from the port branches into their targets.")
      return
    }
    UI.empty()
    return yield* fail(failures.join("\n"))
  }),
})
