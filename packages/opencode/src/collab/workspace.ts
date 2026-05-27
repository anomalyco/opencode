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
import { mkdirSync, rmSync, existsSync, writeFileSync, renameSync } from "fs"
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
 * Clone all repos for a Collab Session at session creation, check out the
 * collab branch in each, and install a prepare-commit-msg hook so every
 * commit produced inside the workspace is signed with collab-session
 * metadata.
 *
 * Authentication: uses the Driver's OAuth access token (passed in by the
 * router from the just-completed session) — see ADR-0005 Option B for why
 * the server PAT is gone.  An empty token falls through to anonymous clone
 * which works only for public repos.
 */
export async function initSessionWorkspace(
  collabSessionId: string,
  repos: string[],
  userAccessToken: string,
  sessionName: string = "",
  branch: string | null = null,
  /**
   * Current participants of this collab session.  Used to:
   *  1. Set the per-repo `user.name` / `user.email` (the session OWNER is
   *     the author; nominated via `participants[0]` when role==="driver"
   *     and it's the session creator).
   *  2. Write `.git/collab-participants.json` so the prepare-commit-msg
   *     hook can emit one `Co-authored-by:` line per participant.
   * Optional for backwards compatibility — falls back to a name-only author
   * if omitted.  Refresh after participant changes via
   * `refreshParticipantsFile(sessionId, participants)`.
   */
  participants: Participant[] = [],
): Promise<void> {
  const root = sessionWorkspacePath(collabSessionId)
  mkdirSync(root, { recursive: true })

  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  const author = pickCommitAuthor(participants)

  for (const repo of repos) {
    const repoName = repo.split("/").pop() ?? repo
    const dest = join(root, repoName)

    if (isHealthyClone(dest)) {
      // Already cloned — fetch latest from origin (shallow so the clone
      // stays bounded).  Non-blocking: a fetch failure shouldn't take down
      // session init; the local checkout still works.
      await runAsync("git", ["-C", dest, "fetch", "--depth", "1", "origin"], { env }).catch(
        (err) => console.error("[collab] git fetch failed:", err),
      )
    } else {
      // Half-clone recovery.  Previous attempt may have left an empty / partial
      // dir (e.g. network blip mid-clone).  Wipe and start fresh — `git clone`
      // refuses to clone into a non-empty directory.
      if (existsSync(dest)) {
        console.warn("[collab] half-clone detected at", dest, "— wiping and re-cloning")
        rmSync(dest, { recursive: true, force: true })
      }
      const cloneUrl = userAccessToken
        ? `https://x-access-token:${userAccessToken}@github.com/${repo}.git`
        : `https://github.com/${repo}.git`

      // Shallow clone: depth=1 of the default branch only.  Trades full git
      // history for:
      //   - faster init (seconds vs minutes for large repos)
      //   - lower disk footprint per session
      //   - fewer flaky-network failure surfaces
      // History is fine to lose because the collab branch is anchored to a
      // single tip commit; nothing in the workflow depends on `git log`
      // beyond what GitHub PRs already render.
      await runAsync("git", ["clone", "--depth", "1", cloneUrl, dest], { env })
    }

    // Check out the collab branch.  Try to switch to an existing local or
    // remote branch first; otherwise create a fresh one off the current HEAD
    // (which is the repo's default-branch tip from the shallow clone).
    if (branch) {
      await checkoutCollabBranch(dest, branch, env)
    }

    // Set the commit author identity for this clone.  The session owner is
    // the primary author; everyone else attaches via Co-authored-by trailers
    // emitted by the prepare-commit-msg hook.  No external GitHub API call —
    // the no-reply email is derived from the participant's github id+login.
    if (author) {
      await runAsync("git", ["-C", dest, "config", "user.name", author.name], { env }).catch((err) =>
        console.error("[collab] git config user.name failed:", err),
      )
      await runAsync("git", ["-C", dest, "config", "user.email", author.email], { env }).catch(
        (err) => console.error("[collab] git config user.email failed:", err),
      )
    }

    // Drop the participants list next to the hook so the hook can read it
    // at commit time.  Refreshed by refreshParticipantsFile whenever the
    // participant list changes (invite redemption, role change, leave).
    writeParticipantsFile(dest, participants)

    // (Re)install the collab commit hook every time — covers fresh clones
    // and existing checkouts that pre-date the feature.
    installCollabCommitHook(dest, collabSessionId, sessionName, repo, branch)
  }
}

/**
 * Pick the GIT commit author for this session.  Heuristic:
 *   - The first participant with role==="driver" (the session OWNER is
 *     always a driver and is inserted first by createCollabSession).
 *   - Falls back to the first participant if no driver found (defensive —
 *     shouldn't happen because session creation inserts the owner as driver).
 *   - Returns null if there are no participants at all (legacy callers).
 */
function pickCommitAuthor(participants: Participant[]): { name: string; email: string } | null {
  const driver = participants.find((p) => p.role === "driver") ?? participants[0]
  if (!driver) return null
  return {
    name: driver.githubLogin,
    email: `${driver.githubId}+${driver.githubLogin}@users.noreply.github.com`,
  }
}

/**
 * Write the participants list to `<repoPath>/.git/collab-participants.json` so
 * the prepare-commit-msg hook can read it at commit time.  Atomic via
 * tmpfile + rename so a racing commit doesn't see a half-written file.
 *
 * Format: `[{ "id": 123, "login": "alice" }, …]` — minimal because the hook
 * only needs id + login to construct the no-reply email.
 */
function writeParticipantsFile(repoPath: string, participants: Participant[]): void {
  const gitDir = join(repoPath, ".git")
  if (!existsSync(gitDir)) return // shouldn't happen for a healthy clone
  const target = join(gitDir, "collab-participants.json")
  const tmp = target + ".tmp"
  const payload = JSON.stringify(
    participants.map((p) => ({ id: p.githubId, login: p.githubLogin })),
  )
  try {
    writeFileSync(tmp, payload, { mode: 0o644 })
    renameSync(tmp, target)
  } catch (err) {
    console.error("[collab] failed to write participants file at", target, err)
  }
}

/**
 * Refresh `.git/collab-participants.json` in every repo of a collab session.
 * Called from the routes that mutate participants (invite redemption, role
 * change, leave) so future commits credit the up-to-date roster.
 *
 * Cheap — one tiny file write per repo.  No git operation; no network call.
 */
export function refreshParticipantsFile(
  collabSessionId: string,
  repos: string[],
  participants: Participant[],
): void {
  for (const repo of repos) {
    const dest = repoWorkspacePath(collabSessionId, repo)
    if (!existsSync(join(dest, ".git"))) continue // not cloned yet — init will write it
    writeParticipantsFile(dest, participants)
  }
}

/**
 * A clone is "healthy" when both the destination dir exists AND has a `.git`
 * subdirectory.  Without this check, a previous half-completed clone (network
 * blip, OOM-killed git, etc.) leaves an empty dir; the next session-init pass
 * sees `existsSync(dest)` and short-circuits to `git pull` against a repo with
 * no remotes — the pull silently fails and the workspace is permanently broken.
 */
function isHealthyClone(dest: string): boolean {
  return existsSync(dest) && existsSync(join(dest, ".git"))
}

/**
 * Check out the given branch in `repoPath`.  Tries, in order:
 *   1. Already on this branch → no-op.
 *   2. Existing local branch with that name → `git checkout <branch>`.
 *   3. Shallow-fetch the branch from `origin` → create a tracking branch.
 *   4. Create a fresh branch off the current HEAD (the default-branch tip
 *      from the shallow clone).
 *
 * Errors at every stage are logged but non-fatal — we don't want a stale
 * checkout to take down the entire collab session creation.
 *
 * Step 3 uses an explicit refspec so the fetched tip ends up at
 * `refs/remotes/origin/<branch>` (a bare `git fetch origin <branch>` would
 * leave it at `FETCH_HEAD`, which can't be used with `checkout -b … origin/<branch>`).
 */
async function checkoutCollabBranch(
  repoPath: string,
  branch: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  // Already on this branch? no-op.
  try {
    const head = await captureGitOutput(["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], env)
    const headTrim = head.trim()
    if (headTrim === branch) {
      console.log("[collab.checkout] already on", branch, "in", repoPath)
      return
    }
    console.log("[collab.checkout] HEAD=", headTrim, "want=", branch, "in", repoPath)
  } catch (err) {
    console.warn("[collab.checkout] rev-parse failed", repoPath, err)
  }

  // Try local
  try {
    await runAsync("git", ["-C", repoPath, "checkout", branch], { env })
    console.log("[collab.checkout] switched to existing local branch", branch, "in", repoPath)
    return
  } catch { /* fall through */ }

  // Try tracking remote (shallow fetch of just this branch's tip)
  try {
    await runAsync(
      "git",
      [
        "-C",
        repoPath,
        "fetch",
        "--depth",
        "1",
        "origin",
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ],
      { env },
    )
    await runAsync("git", ["-C", repoPath, "checkout", "-b", branch, `origin/${branch}`], { env })
    console.log("[collab.checkout] created tracking branch", branch, "from origin in", repoPath)
    return
  } catch { /* fall through */ }

  // Create new branch off current HEAD (shallow-clone tip of default branch)
  try {
    await runAsync("git", ["-C", repoPath, "checkout", "-b", branch], { env })
    console.log("[collab.checkout] created new branch", branch, "off HEAD in", repoPath)
  } catch (err) {
    console.error("[collab.checkout] FAILED to create branch", branch, "in", repoPath, err)
  }
}

/**
 * Read the current branch checked out in `repoPath` (`git symbolic-ref` style,
 * `rev-parse --abbrev-ref HEAD`).  Returns null if:
 *   - the repo doesn't exist (still cloning)
 *   - we're on a detached HEAD ("HEAD")
 *   - the git command fails
 *
 * Used to surface the actual current branch even for legacy collab sessions
 * created before `collab_session.branch` was added.
 */
export async function readRepoBranch(
  collabSessionId: string,
  repoFullName: string,
): Promise<string | null> {
  const repoPath = repoWorkspacePath(collabSessionId, repoFullName)
  if (!existsSync(repoPath)) return null
  try {
    const out = await captureGitOutput(
      ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
      process.env,
    )
    const branch = out.trim()
    if (!branch || branch === "HEAD") return null
    return branch
  } catch {
    return null
  }
}

/** Bulk variant — reads the current branch for every repo concurrently.
 *
 *  Logs a warning when a repo is on a branch that doesn't match the collab
 *  session's configured branch — surfaces accidental `git checkout main`
 *  (whether from the LLM or a participant via the iframe terminal) so
 *  operators can see in CloudWatch what's flipping the branch indicator
 *  back to the default.  The polling endpoint reports whatever it sees;
 *  this log is the breadcrumb to track DOWN the cause without surprising
 *  the user with auto-reverts.
 */
export async function readRepoBranches(
  collabSessionId: string,
  repos: string[],
  expectedBranch?: string | null,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    repos.map(async (repo) => [repo, await readRepoBranch(collabSessionId, repo)] as const),
  )
  const out: Record<string, string> = {}
  for (const [repo, branch] of entries) {
    if (branch) out[repo] = branch
    if (expectedBranch && branch && branch !== expectedBranch) {
      console.warn(
        "[collab.branches] drift detected — session expects",
        expectedBranch,
        "but",
        repo,
        "is on",
        branch,
        "(collabSessionId=",
        collabSessionId,
        ")",
      )
    }
  }
  return out
}

/**
 * Run a git command and capture stdout (used for `rev-parse` etc.).
 * `runAsync` inherits stdio so we'd lose the output — this variant pipes.
 */
function captureGitOutput(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"], env })
    let out = ""
    let err = ""
    child.stdout?.on("data", (b: Buffer) => (out += b.toString()))
    child.stderr?.on("data", (b: Buffer) => (err += b.toString()))
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `git exited ${code}`))))
    child.on("error", reject)
  })
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
  branch: string | null,
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
  const safeBranch = (branch ?? "").replace(/'/g, "'\\''")

  const script = `#!/bin/sh
# Auto-installed by unleashlive/opencode collab — DO NOT EDIT.
# Appends collab-session trailers to every fresh commit message AND emits
# one Co-authored-by line per current session participant so commits made
# inside a collab workspace credit all participants on GitHub's contributor
# graph (uses GitHub's no-reply email format: <id>+<login>@users.noreply.github.com).

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
      ${safeBranch ? `printf 'Collab-Branch: %s\\n' '${safeBranch}' >> "$COMMIT_MSG_FILE"` : `# (no collab branch configured)`}

      # Co-authored-by trailers — one per current participant.  Reads the
      # JSON file the server keeps fresh; if it's missing (e.g. first commit
      # before the file landed) we skip co-authorship silently.  The commit's
      # primary author (git config user.email) is excluded so we don't co-
      # author ourselves.
      PARTICIPANTS_FILE="$(git rev-parse --git-dir)/collab-participants.json"
      if [ -f "$PARTICIPANTS_FILE" ] && command -v node >/dev/null 2>&1; then
        AUTHOR_EMAIL="$(git config user.email 2>/dev/null || echo "")"
        node -e '
          const fs = require("fs")
          const participants = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
          const authorEmail = process.argv[2] || ""
          for (const p of participants) {
            const email = p.id + "+" + p.login + "@users.noreply.github.com"
            if (email === authorEmail) continue
            console.log("Co-authored-by: " + p.login + " <" + email + ">")
          }
        ' "$PARTICIPANTS_FILE" "$AUTHOR_EMAIL" >> "$COMMIT_MSG_FILE" || true
      fi
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
 *
 * The token came in via the original clone URL (baked into .git/config by
 * `initSessionWorkspace`), so git already has credentials for `origin`.
 * Empty-string token is supported for the anonymous public-repo path.
 */
export async function pushWorkspace(repoPath: string): Promise<{ success: boolean; error?: string }> {
  const env = { ...process.env, GIT_ASKPASS: "echo", GIT_TERMINAL_PROMPT: "0" }

  try {
    await runAsync("git", ["-C", repoPath, "push", "origin", "HEAD"], { env })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
