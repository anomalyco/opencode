import type {
  Repository,
  Issue,
  PullRequest,
  Comment,
  Permission,
  Reaction,
  ReactionType,
  CreatePRParams,
  ListPROptions,
  Author,
  Commit,
  FileChange,
  Review,
  ReviewComment,
} from "../types"

interface GiteaUser {
  id: number
  login: string
  full_name?: string
  email?: string
}

interface GiteaComment {
  id: number
  body: string
  user: GiteaUser
  created_at: string
}

interface GiteaLabel {
  id: number
  name: string
  color: string
}

interface GiteaIssue {
  number: number
  title: string
  body: string
  user: GiteaUser
  state: string
  created_at: string
  pull_request?: { merged: boolean }
  labels: GiteaLabel[]
}

interface GiteaCommit {
  sha: string
  commit: {
    message: string
    author: {
      name: string
      email: string
    }
  }
}

interface GiteaChangedFile {
  filename: string
  additions: number
  deletions: number
  status: string
  previous_filename?: string
}

interface GiteaReview {
  id: number
  user: GiteaUser
  body: string
  state: string
  submitted_at: string
  comments?: GiteaReviewComment[]
}

interface GiteaReviewComment {
  id: number
  body: string
  user: GiteaUser
  created_at: string
  path: string
  line?: number
  original_line?: number
  diff_hunk?: string
  commit_id?: string
}

interface GiteaPullRequest {
  number: number
  title: string
  body: string
  user: GiteaUser
  state: string
  merged: boolean
  base: {
    ref: string
    sha: string
    repo: {
      owner: { login: string }
      name: string
    }
  }
  head: {
    ref: string
    sha: string
    repo: {
      owner: { login: string }
      name: string
    }
  }
  created_at: string
  additions: number
  deletions: number
  commits: number
}

interface GiteaRepository {
  owner: { login: string }
  name: string
  private: boolean
  default_branch: string
  description?: string
  html_url: string
}

interface GiteaReaction {
  id: number
  content: string
  user: GiteaUser
}

interface GiteaPermission {
  permission: string
}

export class GiteaClient {
  protected baseUrl: string
  protected token: string
  protected headers: Record<string, string>

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.token = token
    this.headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `token ${token}`,
      "User-Agent": "opencode",
    }
  }

  protected apiUrl(path: string): string {
    const base = this.baseUrl.includes("/api/v1") ? this.baseUrl : `${this.baseUrl}/api/v1`
    return `${base}${path}`
  }

  protected async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.apiUrl(path)
    const options: RequestInit = {
      method,
      headers: this.headers,
    }
    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Gitea API error ${response.status}: ${text}`)
    }

    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  protected async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path)
  }

  protected async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body)
  }

  protected async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body)
  }

  protected async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", path)
  }

  async getRepo(owner: string, repo: string): Promise<Repository> {
    const data = await this.get<GiteaRepository>(`/repos/${owner}/${repo}`)
    return this.mapRepository(data)
  }

  async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
    const [issue, comments] = await Promise.all([
      this.get<GiteaIssue>(`/repos/${owner}/${repo}/issues/${number}`),
      this.get<GiteaComment[]>(`/repos/${owner}/${repo}/issues/${number}/comments`),
    ])
    return this.mapIssue(issue, comments)
  }

  async createIssueComment(owner: string, repo: string, number: number, body: string): Promise<Comment> {
    const data = await this.post<GiteaComment>(`/repos/${owner}/${repo}/issues/${number}/comments`, { body })
    return this.mapComment(data)
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    const [pr, commits, files, comments, reviews] = await Promise.all([
      this.get<GiteaPullRequest>(`/repos/${owner}/${repo}/pulls/${number}`),
      this.get<GiteaCommit[]>(`/repos/${owner}/${repo}/pulls/${number}/commits`),
      this.get<GiteaChangedFile[]>(`/repos/${owner}/${repo}/pulls/${number}/files`),
      this.get<GiteaComment[]>(`/repos/${owner}/${repo}/issues/${number}/comments`),
      this.get<GiteaReview[]>(`/repos/${owner}/${repo}/pulls/${number}/reviews`),
    ])
    return this.mapPullRequest(pr, commits, files, comments, reviews)
  }

  async createPullRequest(params: CreatePRParams): Promise<PullRequest> {
    const data = await this.post<GiteaPullRequest>(`/repos/${params.owner}/${params.repo}/pulls`, {
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
    })
    return this.getPullRequest(params.owner, params.repo, data.number)
  }

  async listPullRequests(owner: string, repo: string, options: ListPROptions = {}): Promise<PullRequest[]> {
    const params = new URLSearchParams()
    if (options.state) params.set("state", options.state)
    if (options.page) params.set("page", String(options.page))
    if (options.limit) params.set("limit", String(options.limit))

    const query = params.toString()
    const path = `/repos/${owner}/${repo}/pulls${query ? `?${query}` : ""}`
    const list = await this.get<GiteaPullRequest[]>(path)

    return Promise.all(list.map((pr) => this.getPullRequest(owner, repo, pr.number)))
  }

  async getCollaboratorPermission(owner: string, repo: string, username: string): Promise<Permission> {
    try {
      const data = await this.get<GiteaPermission>(`/repos/${owner}/${repo}/collaborators/${username}/permission`)
      return this.mapPermission(data.permission)
    } catch {
      return "none"
    }
  }

  async addReaction(owner: string, repo: string, commentId: number, reaction: ReactionType): Promise<Reaction | null> {
    try {
      const data = await this.post<GiteaReaction>(`/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`, {
        content: reaction,
      })
      return this.mapReaction(data)
    } catch {
      return null
    }
  }

  async removeReaction(owner: string, repo: string, commentId: number, reactionId: number): Promise<void> {
    await this.delete(`/repos/${owner}/${repo}/issues/comments/${commentId}/reactions/${reactionId}`)
  }

  async listReactions(owner: string, repo: string, commentId: number): Promise<Reaction[]> {
    const data = await this.get<GiteaReaction[]>(`/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`)
    return data.map((r) => this.mapReaction(r))
  }

  protected mapUser(user: GiteaUser): Author {
    return {
      login: user.login,
      name: user.full_name,
      email: user.email,
    }
  }

  protected mapComment(comment: GiteaComment): Comment {
    return {
      id: comment.id,
      body: comment.body,
      author: this.mapUser(comment.user),
      createdAt: comment.created_at,
    }
  }

  protected mapRepository(repo: GiteaRepository): Repository {
    return {
      owner: repo.owner.login,
      repo: repo.name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      description: repo.description,
      url: repo.html_url,
    }
  }

  protected mapIssue(issue: GiteaIssue, comments: GiteaComment[]): Issue {
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      author: this.mapUser(issue.user),
      state: issue.state === "open" ? "open" : "closed",
      createdAt: issue.created_at,
      comments: comments.map((c) => this.mapComment(c)),
      isPullRequest: !!issue.pull_request,
    }
  }

  protected mapCommit(commit: GiteaCommit): Commit {
    return {
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
      },
    }
  }

  protected mapFileChange(file: GiteaChangedFile): FileChange {
    const statusMap: Record<string, FileChange["status"]> = {
      added: "added",
      modified: "modified",
      deleted: "deleted",
      renamed: "renamed",
      copied: "copied",
    }
    return {
      path: file.filename,
      additions: file.additions,
      deletions: file.deletions,
      status: statusMap[file.status] || "modified",
      previousPath: file.previous_filename,
    }
  }

  protected mapReviewComment(comment: GiteaReviewComment): ReviewComment {
    return {
      id: comment.id,
      body: comment.body,
      author: this.mapUser(comment.user),
      createdAt: comment.created_at,
      path: comment.path,
      line: comment.line || null,
      originalLine: comment.original_line,
      diffHunk: comment.diff_hunk,
      commitId: comment.commit_id,
    }
  }

  protected mapReview(review: GiteaReview): Review {
    const stateMap: Record<string, Review["state"]> = {
      APPROVED: "APPROVED",
      CHANGES_REQUESTED: "CHANGES_REQUESTED",
      COMMENT: "COMMENTED",
      PENDING: "PENDING",
      REQUEST_CHANGES: "CHANGES_REQUESTED",
    }
    return {
      id: review.id,
      author: this.mapUser(review.user),
      body: review.body,
      state: stateMap[review.state.toUpperCase()] || "COMMENTED",
      submittedAt: review.submitted_at,
      comments: (review.comments || []).map((c) => this.mapReviewComment(c)),
    }
  }

  protected mapPullRequest(
    pr: GiteaPullRequest,
    commits: GiteaCommit[],
    files: GiteaChangedFile[],
    comments: GiteaComment[],
    reviews: GiteaReview[],
  ): PullRequest {
    const state: PullRequest["state"] = pr.merged ? "merged" : pr.state === "open" ? "open" : "closed"

    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      author: this.mapUser(pr.user),
      state,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      baseRepo: {
        owner: pr.base.repo.owner.login,
        repo: pr.base.repo.name,
      },
      headRepo: {
        owner: pr.head.repo.owner.login,
        repo: pr.head.repo.name,
      },
      createdAt: pr.created_at,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      commitCount: pr.commits || commits.length || 1,
      commits: commits.map((c) => this.mapCommit(c)),
      files: files.map((f) => this.mapFileChange(f)),
      comments: comments.map((c) => this.mapComment(c)),
      reviews: reviews.map((r) => this.mapReview(r)),
    }
  }

  protected mapPermission(permission: string): Permission {
    const map: Record<string, Permission> = {
      admin: "admin",
      write: "write",
      read: "read",
      owner: "admin",
    }
    return map[permission.toLowerCase()] || "none"
  }

  protected mapReaction(reaction: GiteaReaction): Reaction {
    return {
      id: reaction.id,
      content: reaction.content,
      user: this.mapUser(reaction.user),
    }
  }
}
