export * as GitReview from "./git-review.js"

import path from "path"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/util/process"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { optional } from "@opencode-ai/schema/schema"

const Anchor = Schema.Struct({ ref: Schema.String, commit: Schema.String })
const Metadata = Schema.Struct({ creation: optional(Anchor), selection: optional(Anchor) })
const filename = "opencode-review.json"

export const read = Effect.fn("GitReview.read")(function* (fs: FSUtil.Interface, directory: string) {
  const text = yield* fs
    .readFileString(path.join(directory, filename))
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed("{}")))
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Metadata))(text)
})

export const write = (fs: FSUtil.Interface, directory: string, metadata: typeof Metadata.Type) =>
  fs.writeFileString(path.join(directory, filename), JSON.stringify(metadata) + "\n")

export const namedRef = Effect.fn("GitReview.namedRef")(function* (
  proc: AppProcess.Interface,
  cwd: string,
  input: string,
) {
  // A review base must remain a named branch, never HEAD, an object ID, or a revision expression.
  if (input === "HEAD" || input.endsWith("/HEAD") || /[~^:@{}\s]/.test(input)) return
  const run = (args: string[]) =>
    proc.run(ChildProcess.make("git", args, { cwd, extendEnv: true, stdin: "ignore" }), { maxOutputBytes: 4096 })
  const exact = yield* run(["rev-parse", "--symbolic-full-name", "--verify", "--end-of-options", input])
  const resolved = exact.exitCode === 0 ? exact.stdout.toString("utf8").trim() : ""
  const remotes =
    !resolved && !input.startsWith("refs/")
      ? (yield* run(["remote"])).stdout.toString("utf8").trim().split(/\r?\n/).filter(Boolean)
      : []
  const remote = remotes.includes("origin")
    ? "origin"
    : remotes.includes("upstream")
      ? "upstream"
      : remotes.length === 1
        ? remotes[0]
        : undefined
  const ref = resolved || (remote ? `refs/remotes/${remote}/${input}` : "")
  if (!/^refs\/(heads|remotes)\/.+/.test(ref) || ref.endsWith("/HEAD")) return
  const commit = yield* run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
  if (commit.exitCode !== 0) return
  return {
    name: ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, ""),
    ref,
    commit: commit.stdout.toString("utf8").trim(),
  }
})
