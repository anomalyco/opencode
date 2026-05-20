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
  url.searchParams.set("scope", (params.scopes ?? ["read:org", "read:user", "user:email"]).join(" "))
  return url.toString()
}

export async function exchangeCodeForToken(params: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<string> {
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
  const data = (await res.json()) as { access_token?: string; error?: string }
  if (!data.access_token) throw new Error(data.error ?? "GitHub OAuth: no access_token returned")
  return data.access_token
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "opencode-collab" },
  })
  if (!res.ok) throw new Error(`GitHub user fetch failed: ${res.status}`)
  return res.json() as Promise<GitHubUser>
}

/**
 * Membership check.  GitHub's `/orgs/<org>/members/<login>` endpoint returns
 * 404 for PRIVATE members unless the requesting token has visibility into
 * them — so a server-PAT-only check rejects private org members even though
 * they are in fact in the org.  We probe in two passes:
 *
 *   1. With the USER's own OAuth token (has read:org scope, hit
 *      /user/memberships/orgs/<org>) — returns membership regardless of
 *      privacy.  This is the authoritative answer for the OAuth callback.
 *   2. Fall back to the server PAT against /orgs/<org>/members/<login> —
 *      keeps the check working for paths that don't have a user token
 *      handy (legacy callers).
 *
 * Returns true on the first definitive YES; on definitive NO from method 1
 * we still try method 2 in case the user's SSO authorisation is missing
 * but the server token can see them publicly.
 *
 * Pass `console` (or any { error: fn }) as `log` to get diagnostics about
 * which probe ran and what status came back.
 */
export async function isOrgMember(params: {
  orgName: string
  githubLogin: string
  /** Server-side PAT or GitHub App installation token with read:org scope. */
  serverToken: string
  /** The user's own OAuth access token from the just-completed flow. */
  userToken?: string
  log?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void }
}): Promise<boolean> {
  const ua = "opencode-collab"
  const logger = params.log ?? { error: console.error, info: console.log }

  // ── Method 1: user token ──
  if (params.userToken) {
    try {
      const res = await fetch(`${GITHUB_API}/user/memberships/orgs/${params.orgName}`, {
        headers: {
          Authorization: `Bearer ${params.userToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": ua,
        },
      })
      if (res.ok) {
        const data = (await res.json()) as { state?: string }
        const ok = data.state === "active"
        logger.info?.("[collab.auth] user-token membership probe", {
          org: params.orgName, login: params.githubLogin, state: data.state, ok,
        })
        if (ok) return true
        // state === "pending" or other: continue to fallback
      } else {
        logger.error("[collab.auth] user-token membership probe failed", {
          org: params.orgName, login: params.githubLogin, status: res.status,
          // SSO-protected orgs return 403 with x-github-sso header here
          ssoHeader: res.headers.get("x-github-sso"),
        })
      }
    } catch (err) {
      logger.error("[collab.auth] user-token membership probe error", err)
    }
  }

  // ── Method 2: server token ──
  try {
    const res = await fetch(`${GITHUB_API}/orgs/${params.orgName}/members/${params.githubLogin}`, {
      headers: {
        Authorization: `Bearer ${params.serverToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": ua,
      },
    })
    const ok = res.status === 204
    logger.info?.("[collab.auth] server-token membership probe", {
      org: params.orgName, login: params.githubLogin, status: res.status, ok,
    })
    return ok
  } catch (err) {
    logger.error("[collab.auth] server-token membership probe error", err)
    return false
  }
}

export async function listOrgRepos(params: {
  orgName: string
  serverToken: string
  perPage?: number
}): Promise<Array<{ full_name: string; name: string; private: boolean }>> {
  const res = await fetch(
    `${GITHUB_API}/orgs/${params.orgName}/repos?per_page=${params.perPage ?? 100}&sort=updated`,
    {
      headers: {
        Authorization: `Bearer ${params.serverToken}`,
        "User-Agent": "opencode-collab",
      },
    },
  )
  if (!res.ok) throw new Error(`GitHub repos fetch failed: ${res.status}`)
  return res.json() as Promise<Array<{ full_name: string; name: string; private: boolean }>>
}
