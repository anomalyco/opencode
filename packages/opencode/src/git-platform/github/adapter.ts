import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"
import { BasePlatformAdapter } from "../interface"
import type {
  Platform,
  PlatformConfig,
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
import { $ } from "bun"

type GitHubAuthor = {
  login: string
  name?: string
}

type GitHubComment = {
  id: string
  databaseId: string
  body: string
  author: GitHubAuthor
  createdAt: string
}

type GitHubReviewComment = GitHubComment & {
  path: string
  line: number | null
  originalLine?: number | null
  diffHunk?: string
  commitId?: string
}

type GitHubCommit = {
  oid: string
  message: string
  author: {
    name: string
    email: string
  }
}

type GitHubFile = {
  path: string
  additions: number
  deletions: number
  changeType: string
  previousPath?: string
}

type GitHubReview = {
  id: string
  databaseId: string
  author: GitHubAuthor
  body: string
  state: string
  submittedAt: string
  comments: {
    nodes: GitHubReviewComment[]
  }
}

type GitHubPullRequest = {
  title: string
  body: string
  author: GitHubAuthor
  baseRefName: string
  headRefName: string
  baseRefOid: string
  headRefOid: string
  createdAt: string
  additions: number
  deletions: number
  state: string
  merged: boolean
  baseRepository: {
    nameWithOwner: string
  }
  headRepository: {
    nameWithOwner: string
  }
  commits: {
    totalCount: number
    nodes: Array<{
      commit: GitHubCommit
    }>
  }
  files: {
    nodes: GitHubFile[]
  }
  comments: {
    nodes: GitHubComment[]
  }
  reviews: {
    nodes: GitHubReview[]
  }
}

type GitHubIssue = {
  title: string
  body: string
  author: GitHubAuthor
  createdAt: string
  state: string
  comments: {
    nodes: GitHubComment[]
  }
}

const PR_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        title
        body
        author { login }
        baseRefName
        headRefName
        baseRefOid
        headRefOid
        createdAt
        additions
        deletions
        state
        merged
        baseRepository { nameWithOwner }
        headRepository { nameWithOwner }
        commits(first: 100) {
          totalCount
          nodes {
            commit {
              oid
              message
              author { name email }
            }
          }
        }
        files(first: 100) {
          nodes {
            path
            additions
            deletions
            changeType
          }
        }
        comments(first: 100) {
          nodes {
            id
            databaseId
            body
            author { login }
            createdAt
          }
        }
        reviews(first: 100) {
          nodes {
            id
            databaseId
            author { login }
            body
            state
            submittedAt
            comments(first: 100) {
              nodes {
                id
                databaseId
                body
                author { login }
                createdAt
                path
                line
                originalLine
                diffHunk
                commitId
              }
            }
          }
        }
      }
    }
  }
`

const ISSUE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        title
        body
        author { login }
        createdAt
        state
        comments(first: 100) {
          nodes {
            id
            databaseId
            body
            author { login }
            createdAt
          }
        }
      }
    }
  }
`

export class GitHubAdapter extends BasePlatformAdapter {
  readonly platform: Platform = "github"
  private octoRest: Octokit
  private octoGraph: typeof graphql

  constructor(config: PlatformConfig) {
    super(config)
    this.octoRest = new Octokit({ auth: this.token })
    this.octoGraph = graphql.defaults({
      headers: { authorization: `token ${this.token}` },
    })
  }

  async getRepository(owner: string, repo: string): Promise<Repository> {
    const { data } = await this.withRetry(() => this.octoRest.repos.get({ owner, repo }))
    return {
      owner: data.owner.login,
      repo: data.name,
      private: data.private,
      defaultBranch: data.default_branch,
      description: data.description || undefined,
      url: data.html_url,
    }
  }

  async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
    const response = await this.withRetry(() =>
      this.octoGraph<{ repository: { issue: GitHubIssue } }>(ISSUE_QUERY, { owner, repo, number }),
    )
    const issue = response.repository.issue
    return this.mapIssue(issue, number)
  }

  async createIssueComment(owner: string, repo: string, number: number, body: string): Promise<Comment> {
    const { data } = await this.withRetry(() =>
      this.octoRest.issues.createComment({ owner, repo, issue_number: number, body }),
    )
    return {
      id: data.id,
      body: data.body || "",
      author: { login: data.user?.login || "unknown" },
      createdAt: data.created_at,
    }
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    const response = await this.withRetry(() =>
      this.octoGraph<{ repository: { pullRequest: GitHubPullRequest } }>(PR_QUERY, { owner, repo, number }),
    )
    const pr = response.repository.pullRequest
    return this.mapPullRequest(pr, number)
  }

  async createPullRequest(params: CreatePRParams): Promise<PullRequest> {
    const { data } = await this.withRetry(() =>
      this.octoRest.pulls.create({
        owner: params.owner,
        repo: params.repo,
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
      }),
    )
    return this.getPullRequest(params.owner, params.repo, data.number)
  }

  async listPullRequests(owner: string, repo: string, options: ListPROptions = {}): Promise<PullRequest[]> {
    const { data } = await this.withRetry(() =>
      this.octoRest.pulls.list({
        owner,
        repo,
        state: options.state || "open",
        head: options.head,
        base: options.base,
        page: options.page,
        per_page: options.limit,
      }),
    )
    return Promise.all(data.map((pr) => this.getPullRequest(owner, repo, pr.number)))
  }

  async getCollaboratorPermission(owner: string, repo: string, username: string): Promise<Permission> {
    try {
      const { data } = await this.withRetry(() =>
        this.octoRest.repos.getCollaboratorPermissionLevel({ owner, repo, username }),
      )
      return this.mapPermission(data.permission)
    } catch {
      return "none"
    }
  }

  async addReaction(owner: string, repo: string, commentId: number, reaction: ReactionType): Promise<Reaction | null> {
    try {
      const { data } = await this.withRetry(() =>
        this.octoRest.reactions.createForIssueComment({
          owner,
          repo,
          comment_id: commentId,
          content: reaction,
        }),
      )
      return {
        id: data.id,
        content: data.content,
        user: { login: data.user?.login || "unknown" },
      }
    } catch {
      return null
    }
  }

  async removeReaction(owner: string, repo: string, commentId: number, reactionId: number): Promise<void> {
    await this.withRetry(() =>
      this.octoRest.reactions.deleteForIssueComment({
        owner,
        repo,
        comment_id: commentId,
        reaction_id: reactionId,
      }),
    )
  }

  async listReactions(owner: string, repo: string, commentId: number): Promise<Reaction[]> {
    const { data } = await this.withRetry(() =>
      this.octoRest.reactions.listForIssueComment({ owner, repo, comment_id: commentId }),
    )
    return data.map((r) => ({
      id: r.id,
      content: r.content,
      user: { login: r.user?.login || "unknown" },
    }))
  }

  async configureGitAuth(token: string): Promise<void> {
    const config = "http.https://github.com/.extraheader"
    const ret = await $`git config --local --get ${config}`.nothrow()
    if (ret.exitCode === 0) {
      this.savedGitConfig = ret.stdout.toString().trim()
      await $`git config --local --unset-all ${config}`
    }

    const credentials = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")
    await $`git config --local ${config} "AUTHORIZATION: basic ${credentials}"`
    await $`git config --global user.name "${this.botUsername}"`
    await $`git config --global user.email "${this.botUsername}@users.noreply.github.com"`
  }

  async restoreGitConfig(): Promise<void> {
    if (this.savedGitConfig === undefined) return
    const config = "http.https://github.com/.extraheader"
    await $`git config --local ${config} "${this.savedGitConfig}"`
  }

  getRemoteUrl(owner: string, repo: string): string {
    return `https://github.com/${owner}/${repo}.git`
  }

  private mapAuthor(author: GitHubAuthor): Author {
    return {
      login: author.login,
      name: author.name,
    }
  }

  private mapComment(comment: GitHubComment): Comment {
    return {
      id: parseInt(comment.databaseId, 10),
      body: comment.body,
      author: this.mapAuthor(comment.author),
      createdAt: comment.createdAt,
    }
  }

  private mapReviewComment(comment: GitHubReviewComment): ReviewComment {
    return {
      id: parseInt(comment.databaseId, 10),
      body: comment.body,
      author: this.mapAuthor(comment.author),
      createdAt: comment.createdAt,
      path: comment.path,
      line: comment.line,
      originalLine: comment.originalLine,
      diffHunk: comment.diffHunk,
      commitId: comment.commitId,
    }
  }

  private mapCommit(commit: GitHubCommit): Commit {
    return {
      sha: commit.oid,
      message: commit.message,
      author: commit.author,
    }
  }

  private mapFileChange(file: GitHubFile): FileChange {
    const statusMap: Record<string, FileChange["status"]> = {
      ADDED: "added",
      MODIFIED: "modified",
      DELETED: "deleted",
      RENAMED: "renamed",
      COPIED: "copied",
    }
    return {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      status: statusMap[file.changeType] || "modified",
      previousPath: file.previousPath,
    }
  }

  private mapReview(review: GitHubReview): Review {
    const stateMap: Record<string, Review["state"]> = {
      APPROVED: "APPROVED",
      CHANGES_REQUESTED: "CHANGES_REQUESTED",
      COMMENTED: "COMMENTED",
      PENDING: "PENDING",
      DISMISSED: "DISMISSED",
    }
    return {
      id: parseInt(review.databaseId, 10),
      author: this.mapAuthor(review.author),
      body: review.body,
      state: stateMap[review.state] || "COMMENTED",
      submittedAt: review.submittedAt,
      comments: review.comments.nodes.map((c) => this.mapReviewComment(c)),
    }
  }

  private mapIssue(issue: GitHubIssue, number: number): Issue {
    return {
      number,
      title: issue.title,
      body: issue.body,
      author: this.mapAuthor(issue.author),
      state: issue.state.toLowerCase() === "open" ? "open" : "closed",
      createdAt: issue.createdAt,
      comments: issue.comments.nodes.map((c) => this.mapComment(c)),
      isPullRequest: false,
    }
  }

  private mapPullRequest(pr: GitHubPullRequest, number: number): PullRequest {
    const [baseOwner, baseRepo] = pr.baseRepository.nameWithOwner.split("/")
    const [headOwner, headRepo] = pr.headRepository.nameWithOwner.split("/")

    const state: PullRequest["state"] = pr.merged ? "merged" : pr.state.toLowerCase() === "open" ? "open" : "closed"

    return {
      number,
      title: pr.title,
      body: pr.body,
      author: this.mapAuthor(pr.author),
      state,
      baseRef: pr.baseRefName,
      headRef: pr.headRefName,
      baseSha: pr.baseRefOid,
      headSha: pr.headRefOid,
      baseRepo: { owner: baseOwner, repo: baseRepo },
      headRepo: { owner: headOwner, repo: headRepo },
      createdAt: pr.createdAt,
      additions: pr.additions,
      deletions: pr.deletions,
      commitCount: pr.commits.totalCount,
      commits: pr.commits.nodes.map((n) => this.mapCommit(n.commit)),
      files: pr.files.nodes.map((f) => this.mapFileChange(f)),
      comments: pr.comments.nodes.map((c) => this.mapComment(c)),
      reviews: pr.reviews.nodes.map((r) => this.mapReview(r)),
    }
  }

  private mapPermission(permission: string): Permission {
    const map: Record<string, Permission> = {
      admin: "admin",
      write: "write",
      read: "read",
    }
    return map[permission.toLowerCase()] || "none"
  }
}
