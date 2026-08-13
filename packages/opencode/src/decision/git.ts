import path from "path"

export const ATS_REF = "refs/moks/ats"

async function run(cwd: string, args: string[], env?: Record<string, string>) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
  })
  const io = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout: io[0], stderr: io[1], code: io[2] }
}

function lines(text: string) {
  return text.split("\n").flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed) return []
    return [trimmed]
  })
}

export async function toplevel(cwd: string) {
  const result = await run(cwd, ["rev-parse", "--show-toplevel"])
  if (result.code !== 0) return
  return result.stdout.trim()
}

export async function isRepo(cwd: string) {
  const root = await toplevel(cwd)
  if (!root) return false
  return path.resolve(root) === path.resolve(cwd)
}

export async function init(cwd: string) {
  const result = await run(cwd, ["init"])
  return result.code === 0
}

export async function ensureRepo(cwd: string) {
  if (await isRepo(cwd)) return true
  return init(cwd)
}

export async function add(cwd: string, paths: string[]) {
  if (paths.length === 0) return 0
  const result = await run(cwd, ["add", "--", ...paths])
  return result.code
}

export async function commit(cwd: string, subject: string, body?: string, paths: string[] = ["HIRING.md", "candidates"]) {
  const args = [
    "-c",
    "user.name=moks",
    "-c",
    "user.email=moks@local",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--only",
    "-m",
    subject,
  ]
  if (body) args.push("-m", body)
  args.push("--", ...paths)
  const result = await run(cwd, args)
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "git commit failed")
  const sha = await revParse(cwd, "HEAD")
  if (!sha) throw new Error("git commit produced no SHA")
  return sha
}

export async function status(cwd: string, args: string[] = []) {
  const result = await run(cwd, ["status", ...args])
  return result.stdout
}

export async function show(cwd: string, args: string[]) {
  const result = await run(cwd, ["show", ...args])
  if (result.code !== 0) return
  return result.stdout
}

export async function diffNames(cwd: string, args: string[]) {
  const result = await run(cwd, ["diff", "--name-only", ...args])
  return lines(result.stdout)
}

export async function diffPatch(cwd: string, args: string[]) {
  const result = await run(cwd, ["diff", ...args])
  return result.stdout
}

export async function revParse(cwd: string, rev: string) {
  if (!rev || rev.startsWith("-")) return
  const result = await run(cwd, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`])
  if (result.code !== 0) return
  return result.stdout.trim()
}

export async function updateRef(cwd: string, ref: string, sha: string) {
  const result = await run(cwd, ["update-ref", ref, sha])
  return result.code === 0
}

export async function log(cwd: string, args: string[] = []) {
  const result = await run(cwd, ["log", ...args])
  if (result.code !== 0) return ""
  return result.stdout
}

export async function isAncestor(cwd: string, ancestor: string, rev: string) {
  const result = await run(cwd, ["merge-base", "--is-ancestor", ancestor, rev])
  return result.code === 0
}

export async function changedFiles(cwd: string, sha: string, paths: string[] = []) {
  const parent = await revParse(cwd, `${sha}^`)
  if (!parent) {
    const result = await run(cwd, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--root",
      sha,
      ...(paths.length ? ["--", ...paths] : []),
    ])
    return lines(result.stdout)
  }
  return diffNames(cwd, [parent, sha, ...(paths.length ? ["--", ...paths] : [])])
}

export async function fileAt(cwd: string, rev: string, file: string) {
  return show(cwd, [`${rev}:${file}`])
}

export * as DecisionGit from "./git"
