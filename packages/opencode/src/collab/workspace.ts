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

import { execSync, spawnSync } from "child_process"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { Participant } from "@opencode-ai/collab"

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

  for (const repo of repos) {
    const repoName = repo.split("/").pop() ?? repo
    const dest = join(root, repoName)

    if (existsSync(dest)) {
      // Already cloned — pull latest
      spawnSync("git", ["-C", dest, "pull", "--ff-only"], { stdio: "inherit" })
      continue
    }

    const cloneUrl = token
      ? `https://x-access-token:${token}@github.com/${repo}.git`
      : `https://github.com/${repo}.git`

    const result = spawnSync("git", ["clone", "--depth", "100", cloneUrl, dest], {
      stdio: "inherit",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    })

    if (result.status !== 0) {
      throw new Error(`Failed to clone ${repo} into ${dest}`)
    }
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
export function configureWorkspaceGitIdentity(
  repoPath: string,
  githubLogin: string,
  githubId: number,
): void {
  const email = `${githubId}+${githubLogin}@users.noreply.github.com`
  execSync(`git -C "${repoPath}" config user.name "${githubLogin}"`)
  execSync(`git -C "${repoPath}" config user.email "${email}"`)
}

/**
 * Push committed changes for a workspace repo back to the GitHub remote.
 */
export function pushWorkspace(repoPath: string): { success: boolean; error?: string } {
  const token = process.env["GITHUB_TOKEN"] ?? ""
  const env = token
    ? {
        ...process.env,
        GIT_ASKPASS: "echo",
        GIT_TERMINAL_PROMPT: "0",
        GITHUB_TOKEN: token,
      }
    : process.env

  const result = spawnSync("git", ["-C", repoPath, "push", "origin", "HEAD"], {
    env,
    encoding: "utf8",
  })

  if (result.status !== 0) {
    return { success: false, error: result.stderr }
  }
  return { success: true }
}
