import { lstat, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as Process from "../instance/process.js"
import { writeScriptFiles } from "./filesystem.js"
import type { Project } from "./types.js"

export async function initializeScriptProject(root: string, project: Project) {
  if (project.git) await assertGitPlaceholder(root)
  await writeScriptFiles(root, project.files ?? {}, { git: true })
}

export async function commitScriptProject(root: string) {
  await assertGitPlaceholder(root)
  const metadata = join(root, ".git")
  await rm(metadata, { recursive: true, force: true })
  await git(root, ["init", "--quiet", "--initial-branch=main"])
  await git(root, ["add", "--force", "--all"])
  await git(root, [
    "-c",
    "user.name=OpenCode Drive",
    "-c",
    "user.email=drive@opencode.ai",
    "commit",
    "--quiet",
    "--message=Initial commit",
  ])
}

async function assertGitPlaceholder(root: string) {
  if (await hasGitMetadata(root)) throw new Error("project.git cannot replace existing Git metadata")
}

export async function hasGitMetadata(root: string) {
  const metadata = join(root, ".git")
  const stats = await lstat(metadata).catch((error: unknown) => {
    if (isMissing(error)) return undefined
    throw error
  })
  if (!stats) return false
  return !stats.isDirectory() || (await readdir(metadata)).length > 0
}

async function git(cwd: string, args: ReadonlyArray<string>) {
  const output = await Effect.runPromise(
    Process.run(["git", ...args], {
      cwd,
      env: {
        ...stripGitEnvironment(Bun.env),
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      },
    }).pipe(Effect.provide(NodeServices.layer)),
  )
  if (output.status === 0) return
  throw new Error(`git ${args[0]} failed: ${output.stderr.trim()}`)
}

export function stripGitEnvironment(env: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("GIT_"),
    ),
  )
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
