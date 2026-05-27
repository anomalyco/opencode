/**
 * Branch collision probe + resolve.
 *
 * Background: the auto-generated collab-session branch name is
 * `collab/<slug>-<id>` (see `defaultBranchName` in session.ts).  Git stores
 * branches as files under `refs/heads/`, so `refs/heads/collab/foo` requires
 * `refs/heads/collab` to be a *directory*.  If the linked repo already has a
 * leaf branch named exactly `collab` (`refs/heads/collab` as a file), git
 * refuses to create any `refs/heads/collab/...` with:
 *
 *   fatal: cannot lock ref 'refs/heads/collab/...': 'refs/heads/collab'
 *   exists; cannot create '...'
 *
 * This affects every collab session linked to `unleashlive/opencode` — our
 * own fork's default branch is named `collab` (PR #5).  Aurora and other
 * repos that don't have a `collab` branch are unaffected.
 *
 * The check runs ONCE at session creation, via the GitHub REST API + the
 * Driver's OAuth token (we don't have the repo cloned yet at this point;
 * `initSessionWorkspace` clones AFTER the DB row lands).  Single
 * `HEAD /repos/<r>/branches/<firstSegment>` per linked repo, in parallel.
 *
 * Returns one of:
 *   - { ok: true, resolved }                  — branch name to use
 *   - { ok: false, code: "conflict", suggestedBranch } — user-typed name
 *                                                 conflicts; surface a 409
 *                                                 with the rewritten suggestion
 *   - { ok: false, code: "probe-failed", message } — GitHub API error;
 *                                                 surface a 502 so the SPA
 *                                                 can retry without burying
 *                                                 the user in a half-created
 *                                                 session.
 */

export type ResolveResult =
  | { ok: true; resolved: string }
  | { ok: false; code: "conflict"; suggestedBranch: string }
  | { ok: false; code: "probe-failed"; message: string }

export interface ResolveInput {
  /** Branch name we'd like to use (either auto-generated or user-typed). */
  proposed: string
  /** True iff the proposed name came from explicit user input.  Drives the
   *  difference between silent auto-rewrite (false) and 409-with-suggestion
   *  (true). */
  isUserTyped: boolean
  /** `org/repo` slugs of every linked repo. */
  repos: string[]
  /** GitHub OAuth access token of the Driver creating the session. */
  userToken: string
}

/**
 * Probe whether `branchName` exists as a leaf branch on `repoFullName`.
 * Returns true / false / throws on transport errors.
 *
 * Uses `HEAD` (no body) which 200s when present and 404s when absent.
 * Any other status is treated as a probe failure (caller surfaces 502).
 */
export async function branchExists(
  repoFullName: string,
  branchName: string,
  userToken: string,
): Promise<boolean> {
  const url = `https://api.github.com/repos/${repoFullName}/branches/${encodeURIComponent(branchName)}`
  const res = await fetch(url, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "opencode-collab",
    },
  })
  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new Error(
    `GitHub branch probe returned ${res.status} for ${repoFullName} branch=${branchName}`,
  )
}

/**
 * Main entry — checks each linked repo for a collision and decides what
 * branch name to use.  Probe is skipped when the proposed name has no `/`
 * (slash-less names can't collide with git's refs layout).
 */
export async function resolveBranchName(input: ResolveInput): Promise<ResolveResult> {
  const { proposed, isUserTyped, repos, userToken } = input

  // Names without `/` can't trigger the refs/heads collision; skip the probe.
  if (!proposed.includes("/")) return { ok: true, resolved: proposed }

  const firstSegment = proposed.split("/", 1)[0]
  if (!firstSegment) return { ok: true, resolved: proposed }

  // No repos → nothing to probe.  Caller has likely failed earlier validations
  // but be defensive.
  if (repos.length === 0) return { ok: true, resolved: proposed }

  // Probe every linked repo in parallel.  If ANY returns "exists", we have
  // a collision; if any probe errors, we treat the whole resolve as failed
  // (better safe than sorry — half a session is worse than no session).
  const probes = await Promise.allSettled(
    repos.map(async (repo) => ({ repo, exists: await branchExists(repo, firstSegment, userToken) })),
  )

  const errors: string[] = []
  let collision = false
  for (const result of probes) {
    if (result.status === "rejected") {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
      continue
    }
    if (result.value.exists) {
      collision = true
      break
    }
  }

  if (errors.length > 0 && !collision) {
    // Q2: GitHub API errors fail the session creation up front.  Don't
    // silently proceed with an unverified name that might still collide.
    return { ok: false, code: "probe-failed", message: errors.join("; ") }
  }

  if (!collision) return { ok: true, resolved: proposed }

  // Slash → hyphen.  `collab/foo-bar` → `collab-foo-bar`.
  const flattened = proposed.replace(/\//g, "-")

  if (isUserTyped) {
    // Q3: user typed a name explicitly.  Surface a 409 with the suggested
    // rewrite so the SPA can prompt them — silent rewrite would feel like
    // the server ignored their input.
    return { ok: false, code: "conflict", suggestedBranch: flattened }
  }

  // Auto-generated default name — silent rewrite.
  return { ok: true, resolved: flattened }
}
