/**
 * @deprecated Use VCS Manager with GitLab provider instead
 *
 * GitHub provider implementation of IVCSProvider.
 * Maps GitHub concepts (Pull Requests, Review Comments) to VCS-agnostic types.
 */

import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"

import type {
  IVCSProvider,
  WebhookEvent,
  MergeRequest,
  MRFilters,
  MRChanges,
  Note,
  Discussion,
  Position,
  VCSAuthor,
  VCSFile,
} from "../provider"

// ============================================================================
// Types
// ============================================================================

/**
 * @deprecated Configuration for GitHub provider
 */
export interface GitHubConfig {
  /** GitHub personal access token or app token */
  token: string
  /** Repository owner */
  owner: string
  /** Repository name */
  repo: string
  /** Base URL for API (for GitHub Enterprise) */
  baseUrl?: string
}

type GitHubAuthor = {
  login: string
  name?: string
}

type GitHubPullRequest = {
  title: string
  body: string
  author: GitHubAuthor
  baseRefName: string
  headRefName: string
  headRefOid: string
  createdAt: string
  state: string
  baseRepository: {
    nameWithOwner: string
  }
  headRepository: {
    nameWithOwner: string
  }
}

type GitHubFile = {
  path: string
  additions: number
  deletions: number
  changeType: string
}

type PullRequestQueryResponse = {
  repository: {
    pullRequest: {
      title: string
      body: string
      author: GitHubAuthor
      baseRefName: string
      headRefName: string
      headRefOid: string
      createdAt: string
      state: string
      baseRepository: { nameWithOwner: string }
      headRepository: { nameWithOwner: string }
      additions: number
      deletions: number
      files: {
        nodes: GitHubFile[]
      }
      comments: {
        nodes: {
          id: string
          body: string
          author: GitHubAuthor
          createdAt: string
        }[]
      }
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parses GitHub remote URLs in various formats:
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo
 * - git@github.com:owner/repo.git
 * - git@github.com:owner/repo
 * - ssh://git@github.com/owner/repo.git
 * - ssh://git@github.com/owner/repo
 */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

// ============================================================================
// GitHub Provider Class
// ============================================================================

/**
 * @deprecated Use GitLabProvider instead
 *
 * GitHub provider implementation of IVCSProvider.
 * Maps GitHub concepts (Pull Requests, Review Comments) to VCS-agnostic types.
 */
export class GitHubProvider implements IVCSProvider {
  name = "github"

  private octokit: Octokit
  private graphql: typeof graphql
  private config: GitHubConfig

  constructor(config: GitHubConfig) {
    this.config = config
    this.octokit = new Octokit({
      auth: config.token,
      baseUrl: config.baseUrl,
    })
    this.graphql = graphql.defaults({
      headers: { authorization: `token ${config.token}` },
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    })
  }

  // --------------------------------------------------------------------------
  // Webhook handling
  // --------------------------------------------------------------------------

  /**
   * Parse GitHub webhook event into VCS-agnostic format
   */
  parseWebhook(headers: Headers, body: string): WebhookEvent {
    const eventName = headers.get("x-github-event") || ""
    const payload = JSON.parse(body)

    // Map GitHub event types to VCS event types
    let type: WebhookEvent["type"] = "merge_request"
    let objectKind = eventName

    // Extract project/PR info from different event types
    const projectId = payload.repository?.id || 0
    let mrIid: number | undefined
    let author: VCSAuthor | undefined
    let eventBody: string | undefined

    switch (eventName) {
      case "issue_comment":
        type = "note"
        mrIid = payload.issue?.number
        author = payload.comment?.user ? { login: payload.comment.user.login } : undefined
        eventBody = payload.comment?.body
        break
      case "pull_request_review_comment":
        type = "discussion"
        mrIid = payload.pull_request?.number
        author = payload.comment?.user ? { login: payload.comment.user.login } : undefined
        eventBody = payload.comment?.body
        break
      case "pull_request":
        type = "merge_request"
        mrIid = payload.pull_request?.number
        author = payload.pull_request?.user ? { login: payload.pull_request.user.login } : undefined
        eventBody = payload.pull_request?.body
        break
      case "issues":
        type = "note"
        mrIid = payload.issue?.number
        author = payload.issue?.user ? { login: payload.issue.user.login } : undefined
        eventBody = payload.issue?.body
        break
    }

    return {
      type,
      objectKind,
      projectId,
      mrIid,
      author,
      body: eventBody,
    }
  }

  // --------------------------------------------------------------------------
  // Merge Request operations
  // --------------------------------------------------------------------------

  /**
   * Get a single Pull Request (mapped to MergeRequest)
   */
  async getMR(projectId: string, mrIid: number): Promise<MergeRequest> {
    const owner = this.config.owner
    const repo = this.config.repo

    const result = await this.graphql<PullRequestQueryResponse>(
      `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      body
      author {
        login
      }
      baseRefName
      headRefName
      headRefOid
      createdAt
      state
      baseRepository {
        nameWithOwner
      }
      headRepository {
        nameWithOwner
      }
    }
  }
}`,
      { owner, repo, number: mrIid }
    )

    const pr = result.repository.pullRequest
    if (!pr) {
      throw new Error(`Pull Request #${mrIid} not found`)
    }

    return this.mapPullRequestToMR(pr, mrIid)
  }

  /**
   * List Pull Requests with optional filters
   */
  async listMRs(projectId: string, filters?: MRFilters): Promise<MergeRequest[]> {
    const owner = this.config.owner
    const repo = this.config.repo
    const state = filters?.state === "opened" ? "open" : filters?.state === "closed" ? "closed" : "all"

    const result = await this.octokit.rest.pulls.list({
      owner,
      repo,
      state,
      ...(filters?.author ? { creator: filters.author } : {}),
    })

    return result.data.map((pr) =>
      this.mapPullRequestToRestPR(pr, pr.number)
    )
  }

  /**
   * Get Pull Request changes (diffs)
   */
  async getMRChanges(projectId: string, mrIid: number): Promise<MRChanges> {
    const owner = this.config.owner
    const repo = this.config.repo

    const result = await this.graphql<PullRequestQueryResponse>(
      `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      additions
      deletions
      files(first: 100) {
        nodes {
          path
          additions
          deletions
          changeType
        }
      }
    }
  }
}`,
      { owner, repo, number: mrIid }
    )

    const pr = result.repository.pullRequest
    if (!pr) {
      throw new Error(`Pull Request #${mrIid} not found`)
    }

    return {
      files: pr.files.nodes.map((f) => ({
        path: f.path,
        newPath: f.path,
        oldPath: f.path,
        additions: f.additions,
        deletions: f.deletions,
        changeType: this.mapGitHubChangeType(f.changeType),
      })),
      additions: pr.additions,
      deletions: pr.deletions,
    }
  }

  // --------------------------------------------------------------------------
  // Comments (Notes)
  // --------------------------------------------------------------------------

  /**
   * List Pull Request comments (notes)
   */
  async listMRNotes(projectId: string, mrIid: number): Promise<Note[]> {
    const owner = this.config.owner
    const repo = this.config.repo

    const result = await this.octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: mrIid,
    })

    return result.data.map((comment) => ({
      id: comment.id,
      body: comment.body || "",
      author: {
        login: comment.user?.login || "unknown",
        name: comment.user?.name,
      },
      createdAt: comment.created_at,
      system: false,
    }))
  }

  /**
   * Create a Pull Request comment (note)
   */
  async createMRNote(projectId: string, mrIid: number, body: string): Promise<Note> {
    const owner = this.config.owner
    const repo = this.config.repo

    const result = await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: mrIid,
      body,
    })

    return {
      id: result.data.id,
      body: result.data.body || "",
      author: {
        login: result.data.user?.login || "unknown",
        name: result.data.user?.name,
      },
      createdAt: result.data.created_at,
      system: false,
    }
  }

  // --------------------------------------------------------------------------
  // Discussions (inline comments)
  // --------------------------------------------------------------------------

  /**
   * List Pull Request review comments (discussions)
   */
  async listMRDiscussions(projectId: string, mrIid: number): Promise<Discussion[]> {
    const owner = this.config.owner
    const repo = this.config.repo

    const result = await this.octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: mrIid,
    })

    // Group comments by thread (using pull_request_review_id as thread ID)
    const threadMap = new Map<number, typeof result.data>()

    for (const comment of result.data) {
      const threadId = comment.pull_request_review_id || comment.id
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, [])
      }
      threadMap.get(threadId)!.push(comment)
    }

    return Array.from(threadMap.entries()).map(([threadId, comments]) => ({
      id: String(threadId),
      notes: comments.map((comment) => ({
        id: comment.id,
        body: comment.body || "",
        author: {
          login: comment.user?.login || "unknown",
          name: comment.user?.name,
        },
        createdAt: comment.created_at,
        system: false,
      })),
    }))
  }

  /**
   * Create a Pull Request review comment (discussion)
   */
  async createMRDiscussion(
    projectId: string,
    mrIid: number,
    position: Position,
    body: string
  ): Promise<Discussion> {
    const owner = this.config.owner
    const repo = this.config.repo

    const result = await this.octokit.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number: mrIid,
      body,
      path: position.newPath,
      line: position.newLine,
      commit_id: position.headSha,
    })

    return {
      id: String(result.data.pull_request_review_id || result.data.id),
      notes: [
        {
          id: result.data.id,
          body: result.data.body || "",
          author: {
            login: result.data.user?.login || "unknown",
            name: result.data.user?.name,
          },
          createdAt: result.data.created_at,
          system: false,
        },
      ],
    }
  }

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  /**
   * Get the auth token
   */
  async getAuthToken(): Promise<string> {
    return this.config.token
  }

  // --------------------------------------------------------------------------
  // Helper methods for type mapping
  // --------------------------------------------------------------------------

  private mapPullRequestToMR(pr: PullRequestQueryResponse["repository"]["pullRequest"], iid: number): MergeRequest {
    return {
      iid,
      title: pr.title,
      description: pr.body,
      author: {
        login: pr.author.login,
        name: pr.author.name,
      },
      sourceBranch: pr.headRefName,
      targetBranch: pr.baseRefName,
      sourceSha: pr.headRefOid,
      targetSha: "", // Not directly available in basic PR query
      createdAt: pr.createdAt,
      state: this.mapGitHubState(pr.state),
      webUrl: `https://github.com/${pr.baseRepository.nameWithOwner}/pull/${iid}`,
    }
  }

  private mapPullRequestToRestPR(pr: any, iid: number): MergeRequest {
    return {
      iid,
      title: pr.title,
      description: pr.body || "",
      author: {
        login: pr.user?.login || "unknown",
        name: pr.user?.name,
      },
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      sourceSha: pr.head.sha,
      targetSha: pr.base.sha,
      createdAt: pr.created_at,
      state: this.mapGitHubState(pr.state),
      webUrl: pr.html_url,
    }
  }

  private mapGitHubState(state: string): string {
    // GitHub: open, closed, merged
    // GitLab: opened, closed, merged
    if (state === "open") return "opened"
    if (state === "merged") return "merged"
    return "closed"
  }

  private mapGitHubChangeType(changeType: string): VCSFile["changeType"] {
    // GitHub: added, modified, deleted, renamed
    // GitLab: added, modified, deleted, renamed
    if (changeType === "added") return "added"
    if (changeType === "modified") return "modified"
    if (changeType === "deleted") return "deleted"
    if (changeType === "renamed") return "renamed"
    return "modified" // default fallback
  }
}
