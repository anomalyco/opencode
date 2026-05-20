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
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs"
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
 * Directory we hand to the native opencode session — this becomes the cwd
 * for the terminal panel inside the iframe, the root of opencode's file
 * tree, and the working directory for git/diff/review tooling.
 *
 * We always scope to a specific repo subdirectory when ANY repo is linked
 * to the session.  This isolates the opencode terminal and file tree to
 * the project's "GitHub folder" rather than the broader workspace root
 * (which would also expose any sibling repos cloned for multi-repo
 * sessions — confusing and wider than the user typically wants).
 *
 * - Single-repo session  → /var/opencode/workspaces/<id>/<repoName>
 * - Multi-repo session   → first repo (LLM can `cd ../<other>` if needed)
 * - Repo-less session    → /var/opencode/workspaces/<id> (workspace root)
 *
 * The first-repo choice for multi-repo sessions keeps the iframe focused
 * on one project at a time; the cloned siblings are still on disk one
 * directory up and reachable by an explicit cd.
 */
export function nativeSessionDirectory(collabSessionId: string, repos: string[]): string {
  if (repos.length > 0) return repoWorkspacePath(collabSessionId, repos[0]!)
  return sessionWorkspacePath(collabSessionId)
}

/**
 * Clone all repos for a Collab Session at session creation, and install a
 * prepare-commit-msg hook in each so every commit produced inside the
 * workspace is signed with collab-session metadata.
 *
 * Uses GITHUB_TOKEN for authentication (supports private repos).
 */
export async function initSessionWorkspace(
  collabSessionId: string,
  repos: string[],
  sessionName: string = "",
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
    } else {
      const cloneUrl = token
        ? `https://x-access-token:${token}@github.com/${repo}.git`
        : `https://github.com/${repo}.git`

      await runAsync("git", ["clone", "--depth", "100", cloneUrl, dest], { env })
    }

    // (Re)install the collab commit hook every time — covers fresh clones
    // and existing checkouts that pre-date the feature.
    installCollabCommitHook(dest, collabSessionId, sessionName, repo)
  }
}

/**
 * Install a `prepare-commit-msg` git hook into the cloned repo that
 * automatically appends collab-session trailers to every commit message:
 *
 *   Collaborative-Commit: true
 *   Collab-Session: <session name>
 *   Collab-Session-Id: <session id>
 *   Collab-Repo: <org/repo>
 *
 * Trailers are skipped on merge/squash/amend commits (Git sets $2 to
 * "merge"/"squash"/"commit" in those cases, while a plain new commit has
 * either "" or "message"/"template"), and we no-op if the trailer is
 * already present — so re-running git commit --amend won't duplicate.
 *
 * The hook is written fresh on every workspace init so it picks up any
 * rename of the session.
 */
function installCollabCommitHook(
  repoPath: string,
  sessionId: string,
  sessionName: string,
  repoFullName: string,
): void {
  const hooksDir = join(repoPath, ".git", "hooks")
  try {
    mkdirSync(hooksDir, { recursive: true })
  } catch {
    // If .git/hooks isn't writable, just skip — we'd rather not crash session init.
    return
  }

  // Single-quote-safe escape for the heredoc body.
  const safeName = sessionName.replace(/'/g, "'\\''")
  const safeRepo = repoFullName.replace(/'/g, "'\\''")
  const safeId = sessionId.replace(/'/g, "'\\''")

  const script = `#!/bin/sh
# Auto-installed by unleashlive/opencode collab — DO NOT EDIT.
# Appends collab-session trailers to every fresh commit message so commits
# produced inside a collab workspace are clearly marked.

COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="$2"

case "$COMMIT_SOURCE" in
  ""|"message"|"template")
    # Only stamp plain commits — leave merges, squashes, and existing
    # commit messages (via --amend without -m) alone.
    if ! grep -q '^Collaborative-Commit:' "$COMMIT_MSG_FILE"; then
      printf '\\n' >> "$COMMIT_MSG_FILE"
      printf 'Collaborative-Commit: true\\n' >> "$COMMIT_MSG_FILE"
      printf 'Collab-Session: %s\\n' '${safeName}' >> "$COMMIT_MSG_FILE"
      printf 'Collab-Session-Id: %s\\n' '${safeId}' >> "$COMMIT_MSG_FILE"
      printf 'Collab-Repo: %s\\n' '${safeRepo}' >> "$COMMIT_MSG_FILE"
    fi
    ;;
esac
`

  const hookPath = join(hooksDir, "prepare-commit-msg")
  try {
    writeFileSync(hookPath, script, { mode: 0o755 })
  } catch (err) {
    console.error("[collab] failed to install commit hook for", repoPath, err)
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
