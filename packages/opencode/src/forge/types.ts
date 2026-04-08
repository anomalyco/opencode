export type ForgeAuthor = {
  login: string
  name?: string
}

export type ForgeComment = {
  id: number
  body: string
  author: ForgeAuthor
  createdAt: string
}

export type ForgeReviewComment = ForgeComment & {
  path: string
  line: number | null
}

export type ForgeCommit = {
  oid: string
  message: string
  author: {
    name: string
    email: string
  }
}

export type ForgeFile = {
  path: string
  additions: number
  deletions: number
  changeType: string
}

export type ForgeReview = {
  id: number
  author: ForgeAuthor
  body: string
  state: string
  submittedAt: string
  comments: ForgeReviewComment[]
}

export type ForgePullRequest = {
  title: string
  body: string
  author: ForgeAuthor
  baseRefName: string
  headRefName: string
  headRefOid: string
  createdAt: string
  additions: number
  deletions: number
  state: string
  baseRepository: string
  headRepository: string
  commits: {
    totalCount: number
    nodes: ForgeCommit[]
  }
  files: ForgeFile[]
  comments: ForgeComment[]
  reviews: ForgeReview[]
}

export type ForgeIssue = {
  title: string
  body: string
  author: ForgeAuthor
  createdAt: string
  state: string
  comments: ForgeComment[]
}

export type ForgeRepo = {
  private: boolean
  defaultBranch: string
}

export type ForgeReaction = {
  id: number
  user: ForgeAuthor
}

export type ForgePlatform = "github" | "gitea"

export type ForgeProvider = {
  readonly platform: ForgePlatform

  authenticate(token: string): void

  fetchRepo(): Promise<ForgeRepo>

  fetchIssue(number: number): Promise<ForgeIssue>

  fetchPR(number: number): Promise<ForgePullRequest>

  createComment(body: string, issueNumber: number): Promise<void>

  updateComment(body: string, commentId: number): Promise<void>

  addReaction(issueNumber: number, commentId?: number): Promise<void>

  removeReaction(issueNumber: number, commentId?: number): Promise<void>

  assertPermissions(username: string): Promise<void>

  createPR(opts: { base: string; branch: string; title: string; body: string }): Promise<number | null>

  listOpenPRs(opts: { head: string; base: string }): Promise<{ number: number }[]>

  configureGit(token: string, host: string): Promise<string | undefined>

  restoreGitConfig(savedConfig: string | undefined, host: string): Promise<void>

  revokeToken(): Promise<void>

  buildPromptDataForIssue(issue: ForgeIssue, triggerCommentId?: number): string

  buildPromptDataForPR(pr: ForgePullRequest, triggerCommentId?: number): string
}
