import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"
import * as core from "@actions/core"
import { $ } from "bun"

export namespace GitHub {
  let client: Octokit | undefined
  let graphqlClient: typeof graphql | undefined
  let repoInfo: { owner: string; repo: string } | undefined

  const DEFAULT_OIDC_BASE_URL = "https://api.opencode.ai"

  /**
   * Initialize the GitHub clients with pre-authenticated instances.
   * Used when authentication is handled externally.
   */
  export function init(octo: Octokit, gql: typeof graphql) {
    client = octo
    graphqlClient = gql
  }

  async function getToken(): Promise<string> {
    // Try environment variables first
    const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    if (envToken) return envToken

    // Try OIDC token exchange (GitHub Actions)
    const oidcToken = await getOidcToken()
    if (oidcToken) {
      return exchangeForAppToken(oidcToken)
    }

    throw new Error(
      "GitHub token not found. Set GITHUB_TOKEN or GH_TOKEN environment variable, or ensure id-token: write permission in GitHub Actions.",
    )
  }

  async function getOidcToken(): Promise<string | undefined> {
    try {
      return await core.getIDToken("opencode-github-action")
    } catch {
      return undefined
    }
  }

  async function exchangeForAppToken(token: string): Promise<string> {
    const oidcBaseUrl = process.env.OIDC_BASE_URL?.replace(/\/+$/, "") || DEFAULT_OIDC_BASE_URL
    const { owner, repo } = await getRepoInfo()

    const response = token.startsWith("github_pat_")
      ? await fetch(`${oidcBaseUrl}/exchange_github_app_token_with_pat`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ owner, repo }),
        })
      : await fetch(`${oidcBaseUrl}/exchange_github_app_token`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

    if (!response.ok) {
      const responseJson = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(`App token exchange failed: ${response.status} ${response.statusText} - ${responseJson.error}`)
    }

    const responseJson = (await response.json()) as { token: string }
    return responseJson.token
  }

  export async function getClient() {
    if (client) return client

    const token = await getToken()
    client = new Octokit({ auth: token })
    return client
  }

  export async function getGraphQL() {
    if (graphqlClient) return graphqlClient

    const token = await getToken()
    graphqlClient = graphql.defaults({
      headers: { authorization: `token ${token}` },
    })
    return graphqlClient
  }

  export async function getRepoInfo() {
    if (repoInfo) return repoInfo

    const remoteUrl = (await $`git remote get-url origin`.quiet().nothrow().text()).trim()
    const parsed = parseGitHubRemote(remoteUrl)
    if (!parsed) {
      throw new Error("Could not determine GitHub repository from git remote. Make sure you're in a git repository.")
    }

    repoInfo = parsed
    return repoInfo
  }

  export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
    const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  }

  export function reset() {
    client = undefined
    graphqlClient = undefined
    repoInfo = undefined
  }
}
