import { Auth } from "../auth"
import { Log } from "../util/log"
import { spawn } from "bun"

export namespace MarketplaceGitHub {
  const log = Log.create({ service: "marketplace.github" })

  // GitHub API base URL
  const GITHUB_API = "https://api.github.com"

  // Try to get GitHub token from gh CLI
  async function getGhCliToken(): Promise<string | undefined> {
    try {
      const proc = spawn(["gh", "auth", "token"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await new Response(proc.stdout).text()
      const exitCode = await proc.exited
      if (exitCode === 0 && output.trim()) {
        return output.trim()
      }
    } catch {
      // gh CLI not available or not authenticated
    }
    return undefined
  }

  // Try authentication sources in priority order
  export async function getToken(): Promise<string | undefined> {
    // 1. Check for GITHUB_TOKEN environment variable
    if (process.env.GITHUB_TOKEN) {
      log.debug("using GITHUB_TOKEN from environment")
      return process.env.GITHUB_TOKEN
    }

    // 2. Check for GH_TOKEN environment variable (gh CLI convention)
    if (process.env.GH_TOKEN) {
      log.debug("using GH_TOKEN from environment")
      return process.env.GH_TOKEN
    }

    // 3. Check opencode auth store for github-copilot OAuth
    try {
      const auth = await Auth.get("github-copilot")
      if (auth?.type === "oauth" && auth.access) {
        log.debug("using github-copilot OAuth token from auth store")
        return auth.access
      }
    } catch {
      // Auth not available
    }

    // 4. Check for gh CLI token
    const ghToken = await getGhCliToken()
    if (ghToken) {
      log.debug("using token from gh CLI")
      return ghToken
    }

    // 5. Return undefined for public repo access only
    log.debug("no GitHub token available, using unauthenticated access")
    return undefined
  }

  // Check if we have any authentication available
  export async function isAuthenticated(): Promise<boolean> {
    const token = await getToken()
    return token !== undefined
  }

  // Fetch with authentication
  export async function fetch(url: string, options?: RequestInit): Promise<Response> {
    const token = await getToken()
    const headers = new Headers(options?.headers)

    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
    headers.set("Accept", "application/vnd.github.v3+json")
    headers.set("X-GitHub-Api-Version", "2022-11-28")

    log.debug("fetching", { url, authenticated: !!token })

    return globalThis.fetch(url, { ...options, headers })
  }

  // Parse a repo string into owner and repo
  export function parseRepo(repo: string): { owner: string; repo: string } {
    // Handle full URLs
    if (repo.startsWith("https://github.com/")) {
      repo = repo.replace("https://github.com/", "")
    }
    // Handle git URLs
    if (repo.startsWith("git@github.com:")) {
      repo = repo.replace("git@github.com:", "").replace(".git", "")
    }
    // Handle trailing .git
    repo = repo.replace(/\.git$/, "")
    // Handle trailing slashes
    repo = repo.replace(/\/$/, "")

    const parts = repo.split("/")
    if (parts.length !== 2) {
      throw new Error(`Invalid repository format: ${repo}. Expected 'owner/repo'`)
    }

    return { owner: parts[0], repo: parts[1] }
  }

  // Get the default branch for a repository
  export async function getDefaultBranch(repoString: string): Promise<string> {
    const { owner, repo } = parseRepo(repoString)
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Repository not found: ${repoString}`)
      }
      if (response.status === 403) {
        throw new Error(`Access denied to repository: ${repoString}. You may need to authenticate.`)
      }
      throw new Error(`Failed to get repository info: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as { default_branch: string }
    return data.default_branch
  }

  // Get raw file content from a repository
  export async function getRawContent(
    repoString: string,
    filePath: string,
    ref?: string,
  ): Promise<{ content: string; etag?: string }> {
    const { owner, repo } = parseRepo(repoString)

    // If no ref specified, get the default branch
    const targetRef = ref || (await getDefaultBranch(repoString))

    // Use raw.githubusercontent.com for raw content
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${targetRef}/${filePath}`

    const response = await fetch(rawUrl)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`File not found: ${filePath} in ${repoString}@${targetRef}`)
      }
      if (response.status === 403) {
        throw new Error(`Access denied to ${repoString}. You may need to authenticate.`)
      }
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
    }

    const content = await response.text()
    const etag = response.headers.get("ETag") ?? undefined

    return { content, etag }
  }

  // Get file content with conditional request (using ETag)
  export async function getContentIfModified(
    repoString: string,
    filePath: string,
    ref?: string,
    etag?: string,
  ): Promise<{ content: string; etag?: string; modified: boolean } | { modified: false }> {
    const { owner, repo } = parseRepo(repoString)

    // If no ref specified, get the default branch
    const targetRef = ref || (await getDefaultBranch(repoString))

    // Use raw.githubusercontent.com for raw content
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${targetRef}/${filePath}`

    const headers: Record<string, string> = {}
    if (etag) {
      headers["If-None-Match"] = etag
    }

    const response = await fetch(rawUrl, { headers })

    if (response.status === 304) {
      return { modified: false }
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`File not found: ${filePath} in ${repoString}@${targetRef}`)
      }
      if (response.status === 403) {
        throw new Error(`Access denied to ${repoString}. You may need to authenticate.`)
      }
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
    }

    const content = await response.text()
    const newEtag = response.headers.get("ETag") ?? undefined

    return { content, etag: newEtag, modified: true }
  }

  // List files in a directory (using GitHub API)
  export async function listDirectory(
    repoString: string,
    dirPath: string,
    ref?: string,
  ): Promise<{ name: string; type: "file" | "dir"; path: string }[]> {
    const { owner, repo } = parseRepo(repoString)

    const targetRef = ref || (await getDefaultBranch(repoString))

    const apiUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${dirPath}?ref=${targetRef}`

    const response = await fetch(apiUrl)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Directory not found: ${dirPath} in ${repoString}@${targetRef}`)
      }
      throw new Error(`Failed to list directory: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as Array<{
      name: string
      type: "file" | "dir"
      path: string
    }>

    return data.map((item) => ({
      name: item.name,
      type: item.type,
      path: item.path,
    }))
  }
}
