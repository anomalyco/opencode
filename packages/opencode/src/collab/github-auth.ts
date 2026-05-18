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

export async function isOrgMember(params: {
  orgName: string
  githubLogin: string
  /** Server-side PAT or GitHub App installation token with read:org scope */
  serverToken: string
}): Promise<boolean> {
  const res = await fetch(`${GITHUB_API}/orgs/${params.orgName}/members/${params.githubLogin}`, {
    headers: {
      Authorization: `Bearer ${params.serverToken}`,
      "User-Agent": "opencode-collab",
    },
  })
  // 204 = is member, 404 = not member or private and token lacks access
  return res.status === 204
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
