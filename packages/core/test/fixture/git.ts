import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { promisify } from "util"
import { pathToFileURL } from "url"
import { Repository } from "@opencode-ai/core/repository"

const exec = promisify(execFile)

export async function gitRemote(root: string) {
  const origin = path.join(root, "origin.git")
  const source = path.join(root, "source")
  await git(root, "init", "--bare", origin)
  await git(root, "init", source)
  await git(source, "config", "user.email", "test@example.com")
  await git(source, "config", "user.name", "Test")
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
  // Harden for CI (especially Windows runners): never prompt (a prompt hangs the
  // exec until it times out and looks like "Command failed"), treat any repo as
  // safe (temp-dir repos otherwise trip git's dubious-ownership guard), and pin a
  // committer identity via env so a fresh repo with no user.* config can commit.
  await exec("git", ["-c", "safe.directory=*", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "echo",
      GCM_INTERACTIVE: "never",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  })
}
