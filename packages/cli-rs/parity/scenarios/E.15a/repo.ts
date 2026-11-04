// Repository fixtures for the diff viewer (E.15a): a temporary git repository with a base commit and working-tree
// changes, read back as the server's `FileDiffInfo` list. The patches are real `git diff` output, one chunk per file,
// as `/api/vcs/diff` returns them.
import { mkdtemp, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export type RepoFiles = Record<string, string | null>

// `base` is committed; `changes` writes, or with `null` deletes, files on top of it.
export async function repoDiff(base: RepoFiles, changes: RepoFiles, context = 12) {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-parity-repo-"))
  try {
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(
        ["git", "-c", "user.name=parity", "-c", "user.email=parity@example.com", "-c", "core.autocrlf=false", ...args],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
      )
      if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`)
      return result.stdout.toString()
    }
    const write = async (files: RepoFiles) => {
      for (const [file, content] of Object.entries(files)) {
        const target = path.join(root, file)
        if (content === null) {
          await rm(target)
          continue
        }
        await mkdir(path.dirname(target), { recursive: true })
        await Bun.write(target, content)
      }
    }
    git("init", "-q", "-b", "main")
    await write(base)
    git("add", "-A")
    git("commit", "-q", "-m", "base")
    await write(changes)
    git("add", "-A")
    const output = git(
      "diff",
      "--cached",
      "--no-color",
      "--no-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      `-U${context}`,
      "main",
    )
    return output
      .split(/^(?=diff --git )/m)
      .filter(Boolean)
      .map((patch) => {
        const file = /^\+\+\+ b\/(.+)$/m.exec(patch)?.[1] ?? /^--- a\/(.+)$/m.exec(patch)![1]!
        const lines = patch.split("\n")
        return {
          file,
          patch,
          additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
          deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
          status: /^new file mode/m.test(patch) ? "added" : /^deleted file mode/m.test(patch) ? "deleted" : "modified",
        }
      })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
