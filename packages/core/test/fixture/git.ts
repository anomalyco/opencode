import { $ } from "bun"
import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { promisify } from "util"
import { pathToFileURL } from "url"
import { Repository } from "@opencode/core/repository"
import { Effect } from "effect"
import { tmpdir } from "./tmpdir"

const exec = promisify(execFile)

// Appended to the new repository's own config instead of running one `git config` process per key, which costs
// tens of milliseconds each on Windows. Repositories created by production code still have no identity.
const repositoryConfig = `[core]
	fsmonitor = false
[commit]
	gpgsign = false
[user]
	email = test@opencode.test
	name = Test
`

export async function initGit(directory: string, ...args: string[]) {
  await $`git init ${args} ${directory}`.quiet()
  await fs.appendFile(path.join(directory, ".git", "config"), repositoryConfig)
}

export async function gitRemote(root: string) {
  const origin = path.join(root, "origin.git")
  const source = path.join(root, "source")
  await git(root, "init", "--bare", origin)
  await initGit(source)
  await fs.writeFile(path.join(source, "README.md"), "one\n")
  await git(source, "add", "README.md")
  await git(source, "commit", "-m", "initial")
  await git(source, "branch", "-M", "main")
  await git(source, "remote", "add", "origin", pathToFileURL(origin).href)
  await git(source, "push", "-u", "origin", "main")
  await git(root, "--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main")
  return {
    root,
    source,
    remote: pathToFileURL(origin).href,
    reference: { ...Repository.parseRemote("owner/repo"), remote: pathToFileURL(origin).href },
  }
}

export function withRemote<A, E, R>(body: (fixture: Awaited<ReturnType<typeof gitRemote>>) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(async () => {
      const root = await tmpdir()
      return { root, fixture: await gitRemote(root.path) }
    }),
    (input) => body(input.fixture),
    (input) => Effect.promise(() => input.root[Symbol.asyncDispose]()),
  )
}

export function read(file: string) {
  return Effect.promise(() => fs.readFile(file, "utf8")).pipe(Effect.map((content) => content.replace(/\r\n/g, "\n")))
}

export async function initRepo(directory: string) {
  await initGit(directory)
  await $`git commit --allow-empty -m root`.cwd(directory).quiet()
}

export async function commit(source: string, content: string, message: string) {
  await fs.writeFile(path.join(source, "README.md"), content)
  await git(source, "add", "README.md")
  await git(source, "commit", "-m", message)
  await git(source, "push")
}

export async function branch(source: string, name: string, content: string) {
  await git(source, "checkout", "-b", name)
  await fs.writeFile(path.join(source, "README.md"), content)
  await git(source, "add", "README.md")
  await git(source, "commit", "-m", name)
  await git(source, "push", "-u", "origin", name)
}

export async function git(cwd: string, ...args: string[]) {
  await exec("git", args, { cwd })
}
