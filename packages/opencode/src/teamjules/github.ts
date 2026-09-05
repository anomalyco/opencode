export interface GitHubClient {
  createPR(repo: string, params: CreatePRParams): Promise<PR>
  getIssue(repo: string, number: number): Promise<Issue>
  getPR(repo: string, number: number): Promise<PR>
  createComment(repo: string, issueNumber: number, body: string): Promise<Comment>
  getFileContents(repo: string, path: string, ref?: string): Promise<string>
  getDiff(repo: string, pullNumber: number): Promise<string>
}

export interface CreatePRParams {
  title: string
  body: string
  head: string
  base: string
}

export interface PR {
  number: number
  url: string
  head_sha: string
  state: string
}

export interface Issue {
  number: number
  title: string
  body: string
  state: string
}

export interface Comment {
  id: number
  body: string
}

export function createGitHubClient(token: string): GitHubClient {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  }

  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  return {
    async createPR(repo, params) {
      const [owner, name] = repo.split("/")
      const data = await request<any>(`/repos/${owner}/${name}/pulls`, {
        method: "POST",
        body: JSON.stringify(params),
      })
      return {
        number: data.number,
        url: data.html_url,
        head_sha: data.head.sha,
        state: data.state,
      }
    },

    async getIssue(repo, number) {
      const [owner, name] = repo.split("/")
      return request(`/repos/${owner}/${name}/issues/${number}`)
    },

    async getPR(repo, number) {
      const [owner, name] = repo.split("/")
      const data = await request<any>(`/repos/${owner}/${name}/pulls/${number}`)
      return {
        number: data.number,
        url: data.html_url,
        head_sha: data.head.sha,
        state: data.state,
      }
    },

    async createComment(repo, issueNumber, body) {
      const [owner, name] = repo.split("/")
      return request(`/repos/${owner}/${name}/issues/${issueNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      })
    },

    async getFileContents(repo, path, ref) {
      const [owner, name] = repo.split("/")
      const params = ref ? `?ref=${ref}` : ""
      const data = await request<any>(`/repos/${owner}/${name}/contents/${path}${params}`)
      return Buffer.from(data.content, "base64").toString("utf-8")
    },

    async getDiff(repo, pullNumber) {
      const [owner, name] = repo.split("/")
      const response = await fetch(`https://api.github.com/repos/${owner}/${name}/pulls/${pullNumber}`, {
        headers: { ...headers, Accept: "application/vnd.github.v3.diff" },
      })
      return response.text()
    },
  }
}
