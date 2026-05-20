/**
 * Server-side workspace management for Collab Sessions.
 *
 * Each Collab Session gets a persistent workspace directory on the server where
 * the selected GitHub org repos are cloned. The LLM operates inside these
 * directories. Participants never need local clones.
 *
 * Workspace path: /var/opencode/workspaces/{collabSessionId}/{repoName}/
 * (configurable via COLLAB_WORKSPACE_ROOT env var)
 */

import { spawn } from "child_process"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { Participant } from "@opencode-ai/collab"

/** Run a command asynchronously and resolve/reject when it exits. */
function runAsync(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: opts.env ?? process.env,
      cwd: opts.cwd,
    })
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`))
    })
    child.on("error", reject)
  })
}

function workspaceRoot(): string {
  return process.env["COLLAB_WORKSPACE_ROOT"] ?? "/var/opencode/workspaces"
}

export function sessionWorkspacePath(collabSessionId: string): string {
  return join(workspaceRoot(), collabSessionId)
}

export function repoWorkspacePath(collabSessionId: string, repoFullName: string): string {
  const repoName = repoFullName.split("/").pop() ?? repoFullName
  return join(sessionWorkspacePath(collabSessionId), repoName)
}

/**
 * Directory we hand to the native opencode session.
 *
 * Single-repo collab session: use the repo subdirectory directly so that
 * opencode's git/diff tooling, file tree, and the "review" pane see a proper
 * git repository (the LLM gets correct context for code edits + commits).
 *
 * Multi-repo / repo-less collab session: fall back to the session workspace
 * root.  The LLM can navigate between repo subdirs manually; opencode's
 * repo-aware features won't be active.
 */
export function nativeSessionDirectory(collabSessionId: string, repos: string[]): string {
  if (repos.length === 1) return repoWorkspacePath(collabSessionId, repos[0]!)
  return sessionWorkspacePath(collabSessionId)
}

/**
 * Clone all repos for a Collab Session at session creation.
 * Uses GITHUB_TOKEN for authentication (supports private repos).
 */
export async function initSessionWorkspace(
  collabSessionId: string,
  repos: string[],
): Promise<void> {
  const root = sessionWorkspacePath(collabSessionId)
  mkdirSync(root, { recursive: true })

  const token = process.env["GITHUB_TOKEN"] ?? ""
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" }

  for (const repo of repos) {
    const repoName = repo.split("/").pop() ?? repo
    const dest = join(root, repoName)

    if (existsSync(dest)) {
      // Already cloned — pull latest (non-blocking)
      await runAsync("git", ["-C", dest, "pull", "--ff-only"], { env })
      continue
    }

    const cloneUrl = token
      ? `https://x-access-token:${token}@github.com/${repo}.git`
      : `https://github.com/${repo}.git`

    await runAsync("git", ["clone", "--depth", "100", cloneUrl, dest], { env })
  }
}

/**
 * Remove workspace directory when a session is deleted.
 */
export function cleanupSessionWorkspace(collabSessionId: string): void {
  const root = sessionWorkspacePath(collabSessionId)
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * Build git commit trailers for co-authorship attribution.
 *
 * Author = Driver who approved/sent the prompt
 * Co-authors = all other currently-online participants
 */
export function buildCoAuthorTrailers(
  participants: Participant[],
  authorLogin: string,
): string[] {
  return participants
    .filter((p) => p.githubLogin !== authorLogin && p.isOnline)
    .map((p) => {
      // GitHub's noreply email format: {id}+{login}@users.noreply.github.com
      const email = `${p.githubId}+${p.githubLogin}@users.noreply.github.com`
      return `Co-authored-by: ${p.githubLogin} <${email}>`
    })
}

/**
 * Set git identity for a workspace directory using the Driver's GitHub identity.
 */
export async function configureWorkspaceGitIdentity(
  repoPath: string,
  githubLogin: string,
  githubId: number,
): Promise<void> {
  const email = `${githubId}+${githubLogin}@users.noreply.github.com`
  await runAsync("git", ["-C", repoPath, "config", "user.name", githubLogin])
  await runAsync("git", ["-C", repoPath, "config", "user.email", email])
}

/**
 * Push committed changes for a workspace repo back to the GitHub remote.
 */
export async function pushWorkspace(repoPath: string): Promise<{ success: boolean; error?: string }> {
  const token = process.env["GITHUB_TOKEN"] ?? ""
  const env = token
    ? {
        ...process.env,
        GIT_ASKPASS: "echo",
        GIT_TERMINAL_PROMPT: "0",
        GITHUB_TOKEN: token,
      }
    : process.env

  try {
    await runAsync("git", ["-C", repoPath, "push", "origin", "HEAD"], { env })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
