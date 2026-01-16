import { $ } from "bun"
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
} from "../types"
import { GiteaClient } from "./client"

export class GiteaAdapter extends BasePlatformAdapter {
  readonly platform: Platform = "gitea"
  protected client: GiteaClient

  constructor(config: PlatformConfig) {
    super(config)
    this.client = new GiteaClient(this.baseUrl, this.token)

    if (this.baseUrl.includes("codeberg.org")) {
      this.setRateLimit({ requestsPerMinute: 30, retryDelay: 2000 })
    }
  }

  async getRepository(owner: string, repo: string): Promise<Repository> {
    return this.withRetry(() => this.client.getRepo(owner, repo))
  }

  async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
    return this.withRetry(() => this.client.getIssue(owner, repo, number))
  }

  async createIssueComment(owner: string, repo: string, number: number, body: string): Promise<Comment> {
    return this.withRetry(() => this.client.createIssueComment(owner, repo, number, body))
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    return this.withRetry(() => this.client.getPullRequest(owner, repo, number))
  }

  async createPullRequest(params: CreatePRParams): Promise<PullRequest> {
    return this.withRetry(() => this.client.createPullRequest(params))
  }

  async listPullRequests(owner: string, repo: string, options?: ListPROptions): Promise<PullRequest[]> {
    return this.withRetry(() => this.client.listPullRequests(owner, repo, options))
  }

  async getCollaboratorPermission(owner: string, repo: string, username: string): Promise<Permission> {
    return this.withRetry(() => this.client.getCollaboratorPermission(owner, repo, username))
  }

  async addReaction(owner: string, repo: string, commentId: number, reaction: ReactionType): Promise<Reaction | null> {
    return this.withRetry(() => this.client.addReaction(owner, repo, commentId, reaction))
  }

  async removeReaction(owner: string, repo: string, commentId: number, reactionId: number): Promise<void> {
    return this.withRetry(() => this.client.removeReaction(owner, repo, commentId, reactionId))
  }

  async listReactions(owner: string, repo: string, commentId: number): Promise<Reaction[]> {
    return this.withRetry(() => this.client.listReactions(owner, repo, commentId))
  }

  async configureGitAuth(token: string): Promise<void> {
    const ret = await $`git config --global credential.helper`.nothrow()
    if (ret.exitCode === 0) {
      this.savedGitConfig = ret.stdout.toString().trim()
    }

    const host = new URL(this.baseUrl).host
    await $`git config --global credential.helper store`
    await $`git config --global url.https://${this.botUsername}:${token}@${host}/.insteadOf https://${host}/`
  }

  async restoreGitConfig(): Promise<void> {
    const host = new URL(this.baseUrl).host
    await $`git config --global --unset url.https://${this.botUsername}:${this.token}@${host}/.insteadOf`.nothrow()

    if (this.savedGitConfig) {
      await $`git config --global credential.helper ${this.savedGitConfig}`
    }
  }

  getRemoteUrl(owner: string, repo: string): string {
    const host = new URL(this.baseUrl).host
    return `https://${host}/${owner}/${repo}.git`
  }
}
