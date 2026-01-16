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
  RateLimitConfig,
} from "./types"

export interface IGitPlatform {
  readonly platform: Platform
  readonly baseUrl: string
  readonly botUsername: string

  getRepository(owner: string, repo: string): Promise<Repository>

  getIssue(owner: string, repo: string, number: number): Promise<Issue>
  createIssueComment(owner: string, repo: string, number: number, body: string): Promise<Comment>

  getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest>
  createPullRequest(params: CreatePRParams): Promise<PullRequest>
  listPullRequests(owner: string, repo: string, options?: ListPROptions): Promise<PullRequest[]>

  getCollaboratorPermission(owner: string, repo: string, username: string): Promise<Permission>

  addReaction(owner: string, repo: string, commentId: number, reaction: ReactionType): Promise<Reaction | null>
  removeReaction(owner: string, repo: string, commentId: number, reactionId: number): Promise<void>
  listReactions(owner: string, repo: string, commentId: number): Promise<Reaction[]>

  configureGitAuth(token: string): Promise<void>
  restoreGitConfig(): Promise<void>
  getRemoteUrl(owner: string, repo: string): string
  getAgentName(): string
  getAgentEmail(): string
}

export abstract class BasePlatformAdapter implements IGitPlatform {
  abstract readonly platform: Platform
  readonly baseUrl: string
  readonly botUsername: string
  protected token: string
  protected savedGitConfig?: string
  protected rateLimitConfig: RateLimitConfig

  constructor(config: PlatformConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "")
    this.token = config.token
    this.botUsername = config.botUsername || "opencode-bot"
    this.rateLimitConfig = {
      requestsPerMinute: 60,
      retryDelay: 1000,
      maxRetries: 3,
    }
  }

  setRateLimit(config: Partial<RateLimitConfig>): void {
    this.rateLimitConfig = { ...this.rateLimitConfig, ...config }
  }

  abstract getRepository(owner: string, repo: string): Promise<Repository>
  abstract getIssue(owner: string, repo: string, number: number): Promise<Issue>
  abstract createIssueComment(owner: string, repo: string, number: number, body: string): Promise<Comment>
  abstract getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest>
  abstract createPullRequest(params: CreatePRParams): Promise<PullRequest>
  abstract listPullRequests(owner: string, repo: string, options?: ListPROptions): Promise<PullRequest[]>
  abstract getCollaboratorPermission(owner: string, repo: string, username: string): Promise<Permission>
  abstract addReaction(owner: string, repo: string, commentId: number, reaction: ReactionType): Promise<Reaction | null>
  abstract removeReaction(owner: string, repo: string, commentId: number, reactionId: number): Promise<void>
  abstract listReactions(owner: string, repo: string, commentId: number): Promise<Reaction[]>

  abstract configureGitAuth(token: string): Promise<void>
  abstract restoreGitConfig(): Promise<void>
  abstract getRemoteUrl(owner: string, repo: string): string

  getAgentName(): string {
    return this.botUsername
  }

  getAgentEmail(): string {
    const host = new URL(this.baseUrl).host
    return `${this.botUsername}@${host}`
  }

  protected async withRetry<T>(fn: () => Promise<T>, retries?: number): Promise<T> {
    const maxRetries = retries ?? this.rateLimitConfig.maxRetries
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn()
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        if (attempt < maxRetries) {
          await Bun.sleep(this.rateLimitConfig.retryDelay * (attempt + 1))
        }
      }
    }

    throw lastError
  }
}
