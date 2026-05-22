/**
 * GitHub OAuth helpers for Collab Session authentication.
 *
 * Flow:
 *   1. GET /collab/auth/github          → redirect to GitHub OAuth
 *   2. GET /collab/auth/github/callback → exchange code, verify org membership, set cookie
 *   3. GET /collab/invite/:token        → validate invite, add participant, redirect to session
 */

const GITHUB_OAUTH_URL = "https://github.com/login/oauth/authorize"
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
const GITHUB_API = "https://api.github.com"

export interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatar_url: string
  email: string | null
}

export function buildOAuthUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  scopes?: string[]
}): string {
  const url = new URL(GITHUB_OAUTH_URL)
  url.searchParams.set("client_id", params.clientId)
  url.searchParams.set("redirect_uri", params.redirectUri)
  url.searchParams.set("state", params.state)
  // `repo` scope is required so the user's OAuth token can be used for the
  // server-side git clone + push paths (Option B in ADR-0005).  Each user
  // sees a "this app will have access to your private repositories" consent
  // screen on first sign-in; that's the cost of dropping the long-lived
  // server PAT.
  url.searchParams.set("scope", (params.scopes ?? ["read:org", "read:user", "user:email", "repo"]).join(" "))
  return url.toString()
}

export async function exchangeCodeForToken(params: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<string> {
  if (!params.clientId || !params.clientSecret) {
    throw new Error(
      `Missing OAuth credentials in server env (clientId=${
        params.clientId ? "set" : "empty"
      }, clientSecret=${params.clientSecret ? "set" : "empty"})`,
    )
  }
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  })
  const text = await res.text()
  let data: { access_token?: string; error?: string; error_description?: string; error_uri?: string }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      `GitHub OAuth token exchange returned non-JSON response (status ${res.status}): ${text.slice(0, 200)}`,
    )
  }
  if (!data.access_token) {
    throw new Error(
      `GitHub OAuth token exchange refused: ${data.error ?? "unknown"} — ${
        data.error_description ?? "(no description)"
      }${data.error_uri ? ` (see ${data.error_uri})` : ""}`,
    )
  }
  return data.access_token
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "opencode-collab" },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`GitHub /user failed (status ${res.status}): ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<GitHubUser>
}

/**
 * Membership check using the user's own OAuth access token.
 *
 * GitHub's `/user/memberships/orgs/<org>` endpoint returns the requesting
 * user's own membership status regardless of org privacy or SSO posture —
 * this is the authoritative answer.  `read:org` is in every OAuth grant the
 * collab app requests, so every signed-in caller has a usable token.
 *
 * Returns false on network errors or non-2xx responses (denied / not a
 * member / token revoked); never throws.
 *
 * Historical note: an older fallback path probed `/orgs/<org>/members/<login>`
 * with a server PAT, kept for SSO-protected orgs where the user's own token
 * might be unauthorised.  Removed when ADR-0005 Option B dropped the PAT.
 * If we ever hit users whose own token can't see their org, we restore the
 * fallback or move to GitHub App installation tokens (the eventual ADR-0005
 * landing).
 */
export async function isOrgMember(params: {
  orgName: string
  githubLogin: string
  /** The user's own OAuth access token. */
  userToken: string
  log?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void }
}): Promise<boolean> {
  const logger = params.log ?? { error: console.error, info: console.log }

  try {
    const res = await fetch(`${GITHUB_API}/user/memberships/orgs/${params.orgName}`, {
      headers: {
        Authorization: `Bearer ${params.userToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "opencode-collab",
      },
    })
    if (res.ok) {
      const data = (await res.json()) as { state?: string }
      const ok = data.state === "active"
      logger.info?.("[collab.auth] membership probe", {
        org: params.orgName, login: params.githubLogin, state: data.state, ok,
      })
      return ok
    }
    logger.error("[collab.auth] membership probe failed", {
      org: params.orgName,
      login: params.githubLogin,
      status: res.status,
      // SSO-protected orgs return 403 with x-github-sso here
      ssoHeader: res.headers.get("x-github-sso"),
    })
    return false
  } catch (err) {
    logger.error("[collab.auth] membership probe error", err)
    return false
  }
}

/**
 * List org repos the *user* has access to.  Pass the user's OAuth token
 * (has `repo` scope since ADR-0005 Option B); the result is naturally
 * scoped to repos the caller can read — better than the previous server-PAT
 * approach which returned every repo the PAT owner could see.
 */
export async function listOrgRepos(params: {
  orgName: string
  userToken: string
  perPage?: number
}): Promise<Array<{ full_name: string; name: string; private: boolean }>> {
  const res = await fetch(
    `${GITHUB_API}/orgs/${params.orgName}/repos?per_page=${params.perPage ?? 100}&sort=updated`,
    {
      headers: {
        Authorization: `Bearer ${params.userToken}`,
        "User-Agent": "opencode-collab",
      },
    },
  )
  if (!res.ok) throw new Error(`GitHub repos fetch failed: ${res.status}`)
  return res.json() as Promise<Array<{ full_name: string; name: string; private: boolean }>>
}
