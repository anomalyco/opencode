import { Flag } from "../flag/flag"
import { GitLabProvider, type GitLabConfig } from "./gitlab/gitlab"
import { GitHubProvider, type GitHubConfig } from "./github/provider"
import type {
  IVCSProvider,
  WebhookEvent,
  MergeRequest,
  MRFilters,
  MRChanges,
  Note,
  Discussion,
  Position,
} from "./provider"

export type VCSConfig = {
  provider?: "gitlab" | "github"
  gitlab?: Partial<GitLabConfig>
  github?: Partial<GitHubConfig>
}

export class VCSManager {
  private provider?: IVCSProvider
  private _providerName?: string

  constructor(private config?: VCSConfig) {}

  async initialize(): Promise<void> {
    const providerType = this.config?.provider ?? Flag.OPENSACIA_VCS_PROVIDER

    switch (providerType) {
      case "gitlab":
        const gitlabConfig: GitLabConfig = {
          baseUrl:
            this.config?.gitlab?.baseUrl ?? Flag.OPENSACIA_GITLAB_BASE_URL,
          token: this.config?.gitlab?.token ?? Flag.OPENSACIA_GITLAB_TOKEN ?? "",
          defaultProjectId: this.config?.gitlab?.defaultProjectId ??
            (Flag.OPENSACIA_GITLAB_PROJECT_ID
              ? Number(Flag.OPENSACIA_GITLAB_PROJECT_ID)
              : undefined),
        }
        this.provider = new GitLabProvider(gitlabConfig)
        this._providerName = "gitlab"
        break

      case "github":
        const githubConfig: GitHubConfig = {
          token: this.config?.github?.token ?? "",
          owner: this.config?.github?.owner ?? "",
          repo: this.config?.github?.repo ?? "",
          baseUrl: this.config?.github?.baseUrl,
        }
        this.provider = new GitHubProvider(githubConfig)
        this._providerName = "github"
        break

      default:
        throw new Error(`Unknown VCS provider: ${providerType}`)
    }
  }

  get providerName(): string | undefined {
    return this._providerName
  }

  // Delegate all IVCSProvider methods
  async parseWebhook(headers: Headers, body: string): Promise<WebhookEvent> {
    this.ensureInitialized()
    return this.provider!.parseWebhook(headers, body)
  }

  async getMR(projectId: string, mrIid: number): Promise<MergeRequest> {
    this.ensureInitialized()
    return this.provider!.getMR(projectId, mrIid)
  }

  async listMRs(projectId: string, filters?: MRFilters): Promise<MergeRequest[]> {
    this.ensureInitialized()
    return this.provider!.listMRs(projectId, filters)
  }

  async getMRChanges(projectId: string, mrIid: number): Promise<MRChanges> {
    this.ensureInitialized()
    return this.provider!.getMRChanges(projectId, mrIid)
  }

  async listMRNotes(projectId: string, mrIid: number): Promise<Note[]> {
    this.ensureInitialized()
    return this.provider!.listMRNotes(projectId, mrIid)
  }

  async createMRNote(projectId: string, mrIid: number, body: string): Promise<Note> {
    this.ensureInitialized()
    return this.provider!.createMRNote(projectId, mrIid, body)
  }

  async listMRDiscussions(projectId: string, mrIid: number): Promise<Discussion[]> {
    this.ensureInitialized()
    return this.provider!.listMRDiscussions(projectId, mrIid)
  }

  async createMRDiscussion(
    projectId: string,
    mrIid: number,
    position: Position,
    body: string
  ): Promise<Discussion> {
    this.ensureInitialized()
    return this.provider!.createMRDiscussion(projectId, mrIid, position, body)
  }

  async getAuthToken(): Promise<string> {
    this.ensureInitialized()
    return this.provider!.getAuthToken()
  }

  private ensureInitialized(): void {
    if (!this.provider) {
      throw new Error("VCSManager not initialized. Call initialize() first.")
    }
  }
}
