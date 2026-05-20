/**
 * One-click "Open PR" for a collab session.
 *
 * Driver hits the button → server:
 *   1. `git push -u origin HEAD` from the cloned repo workspace
 *   2. `POST /repos/<org>/<repo>/pulls` against GitHub's REST API using
 *      the server-side GITHUB_TOKEN
 *   3. Returns the PR URL so the client can navigate to it
 *
 * Body of the PR is auto-composed from the collab session state:
 *   - Title = collab session name
 *   - Link back to /collab/<id>
 *   - List of commits with their Collaborative-Commit trailers
 *   - Table of participants + roles
 */

import { spawn } from "node:child_process"
import type { CollabSession } from "@opencode-ai/collab"
import { repoWorkspacePath } from "./workspace"

/**
 * Push the current branch + open a PR.  Single-repo sessions only for v1
 * (multi-repo would need a per-repo loop with one PR per repo — defer
 * until users actually ask for it).
 *
 * Returns either the URL of the opened PR or a structured error.
 */
export async function openCollabPullRequest(
  collabSession: CollabSession,
  baseUrl: string,
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  if (collabSession.repos.length === 0) {
    return { ok: false, status: 400, error: "Session has no linked repository." }
  }
  const repoFull = collabSession.repos[0]! // "<org>/<repo>"
  const repoPath = repoWorkspacePath(collabSession.id, repoFull)
  const token = process.env["GITHUB_TOKEN"] ?? ""
  if (!token) {
    return { ok: false, status: 500, error: "Server GITHUB_TOKEN is not configured." }
  }

  // Step 1: push the current branch.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GITHUB_TOKEN: token }
  try {
    await runAsyncCapture("git", ["-C", repoPath, "push", "-u", "origin", "HEAD"], env)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 502, error: `git push failed: ${message}` }
  }

  // Step 2: figure out branch + default base.
  let branch = collabSession.branch ?? ""
  if (!branch) {
    try {
      branch = (await runAsyncCapture("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], env)).trim()
    } catch {
      return { ok: false, status: 500, error: "Couldn't determine current git branch." }
    }
  }
  let defaultBranch = "main"
  try {
    const head = (
      await runAsyncCapture("git", ["-C", repoPath, "symbolic-ref", "refs/remotes/origin/HEAD"], env)
    ).trim()
    // head looks like "refs/remotes/origin/main"
    const parts = head.split("/")
    defaultBranch = parts[parts.length - 1] || "main"
  } catch {
    // fall back to "main"
  }

  // Step 3: compose PR body.
  let log = ""
  try {
    log = await runAsyncCapture(
      "git",
      [
        "-C", repoPath,
        "log",
        `${defaultBranch}..HEAD`,
        "--format=- %h %s",
        "--no-decorate",
      ],
      env,
    )
  } catch {
    // empty log is fine — branch may have just been created
  }
  const participants = collabSession.participants
    .map((p) => `| @${p.githubLogin} | ${p.role} |`)
    .join("\n")
  const body = [
    `Created from a [collab session](${baseUrl}/collab/${collabSession.id}).`,
    "",
    `**Commits**`,
    "",
    log.trim() || "_(no commits yet)_",
    "",
    `**Participants**`,
    "",
    "| GitHub | Role |",
    "|---|---|",
    participants || "| — | — |",
    "",
    `<sub>Every commit on this branch is auto-tagged with \`Collaborative-Commit: true\` and \`Collab-Session-Id: ${collabSession.id}\`.</sub>`,
  ].join("\n")

  // Step 4: call GitHub.
  const res = await fetch(`https://api.github.com/repos/${repoFull}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "opencode-collab",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: collabSession.name,
      head: branch,
      base: defaultBranch,
      body,
      draft: false,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    // 422 with "A pull request already exists for …" is common — surface it
    // with the existing PR URL if we can find one.
    if (res.status === 422 && /pull request already exists/i.test(detail)) {
      try {
        const list = await fetch(
          `https://api.github.com/repos/${repoFull}/pulls?head=${repoFull.split("/")[0]}:${encodeURIComponent(branch)}&state=open`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "opencode-collab" } },
        )
        if (list.ok) {
          const arr = (await list.json()) as Array<{ html_url: string }>
          if (arr[0]?.html_url) return { ok: true, url: arr[0].html_url }
        }
      } catch { /* fall through */ }
    }
    return { ok: false, status: res.status, error: detail || `GitHub returned ${res.status}` }
  }
  const data = (await res.json()) as { html_url?: string; number?: number }
  if (!data.html_url) {
    return { ok: false, status: 502, error: "GitHub didn't return an html_url for the new PR." }
  }
  return { ok: true, url: data.html_url }
}

function runAsyncCapture(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env })
    let out = ""
    let err = ""
    child.stdout?.on("data", (b: Buffer) => (out += b.toString()))
    child.stderr?.on("data", (b: Buffer) => (err += b.toString()))
    child.on("close", (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `${cmd} ${args.join(" ")} exited ${code}`))
    })
    child.on("error", reject)
  })
}
