import { mkdtemp, writeFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import path from "path"

/**
 * Create a bare git repository on disk with a single commit containing the given package,
 * optionally at a subdirectory. Returns the bare repo path for use with `file:///` git URLs.
 */
export async function makeBareRepo(opts: {
  pkg: {
    name: string
    version: string
    mainContents?: string
    scripts?: Record<string, string>
  }
  subdir?: string
}) {
  const bareDir = await mkdtemp(path.join(tmpdir(), "bare-repo-"))
  const workDir = await mkdtemp(path.join(tmpdir(), "work-repo-"))

  // Force HEAD to point at refs/heads/main regardless of the runner's `init.defaultBranch`.
  // CI environments often default to `master`, which leaves the bare repo's HEAD dangling
  // after we push HEAD:main — pacote's `@npmcli/git` then crashes dereferencing HEAD.sha.
  await run(["git", "init", "--bare", bareDir])
  await run(["git", "-C", bareDir, "symbolic-ref", "HEAD", "refs/heads/main"])
  await run(["git", "clone", bareDir, workDir])
  await run(["git", "-C", workDir, "config", "user.email", "test@example.com"])
  await run(["git", "-C", workDir, "config", "user.name", "test"])

  const subdir = opts.subdir ?? "."
  const targetDir = path.join(workDir, subdir)
  if (subdir !== ".") await mkdir(targetDir, { recursive: true })
  await writeFile(
    path.join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: opts.pkg.name,
        version: opts.pkg.version,
        main: "index.js",
        ...(opts.pkg.scripts ? { scripts: opts.pkg.scripts } : {}),
      },
      null,
      2,
    ),
  )
  await writeFile(
    path.join(targetDir, "index.js"),
    opts.pkg.mainContents ?? 'module.exports = { marker: "from-bare-repo" }\n',
  )

  await run(["git", "-C", workDir, "add", "."])
  await run(["git", "-C", workDir, "commit", "-m", "initial"])
  await run(["git", "-C", workDir, "push", "origin", "HEAD:main"])

  return bareDir
}

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(" ")} failed: ${err}`)
  }
}
