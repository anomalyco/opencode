export type Platform = "github" | "gitea" | "forgejo"

export interface Author {
  login: string
  name?: string
  email?: string
}

export interface Comment {
  id: number
  body: string
  author: Author
  createdAt: string
}

export interface ReviewComment extends Comment {
  path: string
  line: number | null
  originalLine?: number | null
  diffHunk?: string
  commitId?: string
}

export interface Issue {
  number: number
  title: string
  body: string
  author: Author
  state: "open" | "closed"
  createdAt: string
  comments: Comment[]
  isPullRequest: boolean
}

export interface Commit {
  sha: string
  message: string
  author: {
    name: string
    email: string
  }
}

export interface FileChange {
  path: string
  additions: number
  deletions: number
  status: "added" | "modified" | "deleted" | "renamed" | "copied"
  previousPath?: string
}

export interface Review {
  id: number
  author: Author
  body: string
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING" | "DISMISSED"
  submittedAt: string
  comments: ReviewComment[]
}

export interface PullRequest {
  number: number
  title: string
  body: string
  author: Author
  state: "open" | "closed" | "merged"
  baseRef: string
  headRef: string
  baseSha: string
  headSha: string
  baseRepo: RepoRef
  headRepo: RepoRef
  createdAt: string
  additions: number
  deletions: number
  commitCount: number
  commits: Commit[]
  files: FileChange[]
  comments: Comment[]
  reviews: Review[]
}

export interface RepoRef {
  owner: string
  repo: string
}

export interface Repository {
  owner: string
  repo: string
  private: boolean
  defaultBranch: string
  description?: string
  url: string
}

export type Permission = "admin" | "write" | "read" | "none"

export interface RemoteInfo {
  platform: Platform
  baseUrl: string
  owner: string
  repo: string
}

export interface CreatePRParams {
  owner: string
  repo: string
  title: string
  body: string
  head: string
  base: string
}

export interface ListPROptions {
  state?: "open" | "closed" | "all"
  head?: string
  base?: string
  page?: number
  limit?: number
}

export interface Reaction {
  id: number
  content: string
  user: Author
}

export type ReactionType = "eyes" | "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket"

export interface EventContext {
  eventName: string
  actor?: string
  repo: RepoRef
  issueNumber?: number
  commentId?: number
  isPullRequest: boolean
  payload: unknown
}

export interface PlatformConfig {
  baseUrl: string
  token: string
  botUsername?: string
}

export interface RateLimitConfig {
  requestsPerMinute: number
  retryDelay: number
  maxRetries: number
}
