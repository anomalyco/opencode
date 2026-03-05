import { Octokit } from "@octokit/rest"
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

export type RetryOptions = {
  maxAttempts?: number
  baseDelay?: number
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const baseDelay = options.baseDelay ?? 100

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error("retryWithBackoff: Unexpected state")
}

export interface GitLabConfig {
  baseUrl: string
  token: string
  defaultProjectId?: number
}

namespace GitLabResponses {
  export interface Author {
    username: string
    name: string
  }

  export interface DiffRefs {
    base_sha: string
    head_sha: string
    start_sha: string
  }

  export interface MergeRequest {
    iid: number
    title: string
    description: string
    author: Author
    source_branch: string
    target_branch: string
    sha: string
    diff_refs: DiffRefs
    created_at: string
    state: string
    web_url: string
  }

  export interface MergeRequestChange {
    new_path: string
    old_path: string
    new_file: boolean
    renamed_file: boolean
    deleted_file: boolean
    diff?: string
    additions?: number
    deletions?: number
  }

  export interface MergeRequestChanges {
    changes: MergeRequestChange[]
    additions: number
    deletions: number
  }

  export interface Note {
    id: number
    body: string
    author: Author
    created_at: string
    system: boolean
  }

  export interface DiscussionNote extends Note {
    position_type?: string
    new_path?: string
    new_line?: number
  }

  export interface Discussion {
    id: string
    notes: DiscussionNote[]
  }

  export interface MergeRequestListResponse extends MergeRequest {}

  export interface MergeRequestSingleResponse extends MergeRequest {}

  export interface NotesListResponse extends Note {}

  export interface NoteSingleResponse extends Note {}

  export interface DiscussionsListResponse extends Discussion {}

  export interface DiscussionSingleResponse extends Discussion {}
}

export class GitLabProvider implements IVCSProvider {
  name = "gitlab"
  private octokit: Octokit

  constructor(private config: GitLabConfig) {
    this.octokit = new Octokit({
      auth: config.token,
      baseUrl: config.baseUrl,
    })
  }

  async parseWebhook(headers: Headers, body: string): Promise<WebhookEvent> {
    const token = headers.get("x-gitlab-token")
    if (!token) {
      throw new Error("Missing X-Gitlab-Token header")
    }

    const data = JSON.parse(body)
    const objectKind = data.object_kind ?? data.event_type

    const event: WebhookEvent = {
      type: this.mapEventType(objectKind),
      objectKind,
      projectId: data.project?.id ?? data.project_id,
    }

    if (data.merge_request) {
      event.mrIid = data.merge_request.iid
    } else if (data.object_attributes?.iid) {
      event.mrIid = data.object_attributes.iid
    }

    if (data.user) {
      event.author = {
        login: data.user.username,
        name: data.user.name,
      }
    }

    if (data.object_attributes?.note) {
      event.body = data.object_attributes.note
    } else if (data.object_attributes?.description) {
      event.body = data.object_attributes.description
    }

    return event
  }

  private mapEventType(objectKind: string): WebhookEvent["type"] {
    if (objectKind === "note" || objectKind === "discussion") {
      return "note"
    }
    return "merge_request"
  }

  async getMR(projectId: string, mrIid: number): Promise<MergeRequest> {
    try {
      const effectiveProjectId = projectId ?? String(this.config.defaultProjectId ?? "")
      if (!effectiveProjectId) {
        throw new Error("Project ID is required and was not provided or configured")
      }

      const response = await retryWithBackoff(() =>
        this.octokit.request<GitLabResponses.MergeRequestSingleResponse>(
          "GET /projects/{project_id}/merge_requests/{mr_iid}",
          {
            project_id: effectiveProjectId,
            mr_iid: mrIid,
          }
        )
      )

      const data = response.data
      return {
        iid: data.iid,
        title: data.title,
        description: data.description,
        author: {
          login: data.author.username,
          name: data.author.name,
        },
        sourceBranch: data.source_branch,
        targetBranch: data.target_branch,
        sourceSha: data.sha,
        targetSha: data.diff_refs?.base_sha ?? "",
        createdAt: data.created_at,
        state: data.state,
        webUrl: data.web_url,
      }
    } catch (error) {
      throw new Error(
        `Failed to get merge request ${mrIid} for project ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async listMRs(projectId: string, filters?: MRFilters): Promise<MergeRequest[]> {
    try {
      const effectiveProjectId = projectId ?? String(this.config.defaultProjectId ?? "")
      if (!effectiveProjectId) {
        throw new Error("Project ID is required and was not provided or configured")
      }

      const response = await retryWithBackoff(() =>
        this.octokit.request<GitLabResponses.MergeRequestListResponse[]>(
          "GET /projects/{project_id}/merge_requests",
          {
            project_id: effectiveProjectId,
            state: filters?.state ?? "opened",
          }
        )
      )

      return response.data.map((mr) => ({
        iid: mr.iid,
        title: mr.title,
        description: mr.description,
        author: {
          login: mr.author.username,
          name: mr.author.name,
        },
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
        sourceSha: mr.sha,
        targetSha: mr.diff_refs?.base_sha ?? "",
        createdAt: mr.created_at,
        state: mr.state,
        webUrl: mr.web_url,
      }))
    } catch (error) {
      throw new Error(
        `Failed to list merge requests for project ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async getMRChanges(projectId: string, mrIid: number): Promise<MRChanges> {
    try {
      const effectiveProjectId = projectId ?? String(this.config.defaultProjectId ?? "")
      if (!effectiveProjectId) {
        throw new Error("Project ID is required and was not provided or configured")
      }

      const response = await retryWithBackoff(() =>
        this.octokit.request<GitLabResponses.MergeRequestChanges>(
          "GET /projects/{project_id}/merge_requests/{mr_iid}/changes",
          {
            project_id: effectiveProjectId,
            mr_iid: mrIid,
          }
        )
      )

      const data = response.data
      return {
        files: (data.changes ?? []).map((file) => {
          // Use GitLab's provided additions/deletions if available, otherwise parse diff
          let additions = 0
          let deletions = 0

          if (file.additions !== undefined && file.deletions !== undefined) {
            additions = file.additions
            deletions = file.deletions
          } else if (file.diff) {
            const lines = file.diff.split("\n")
            additions = lines.filter((l) => l.startsWith("+")).length
            deletions = lines.filter((l) => l.startsWith("-")).length
          }

          return {
            path: file.new_path ?? file.old_path,
            newPath: file.new_path ?? "",
            oldPath: file.old_path ?? "",
            additions,
            deletions,
            changeType: this.mapChangeType(file.new_file, file.renamed_file, file.deleted_file),
          }
        }),
        additions: data.additions ?? 0,
        deletions: data.deletions ?? 0,
      }
    } catch (error) {
      throw new Error(
        `Failed to get merge request changes for MR ${mrIid} in project ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  private mapChangeType(
    newFile: boolean | undefined,
    renamed: boolean | undefined,
    deleted: boolean | undefined
  ): VCSFile["changeType"] {
    if (deleted) return "deleted"
    if (newFile) return "added"
    if (renamed) return "renamed"
    return "modified"
  }

  async listMRNotes(projectId: string, mrIid: number): Promise<Note[]> {
    try {
      const effectiveProjectId = projectId ?? String(this.config.defaultProjectId ?? "")
      if (!effectiveProjectId) {
        throw new Error("Project ID is required and was not provided or configured")
      }

      const response = await retryWithBackoff(() =>
        this.octokit.request<GitLabResponses.NotesListResponse[]>(
          "GET /projects/{project_id}/merge_requests/{mr_iid}/notes",
          {
            project_id: effectiveProjectId,
            mr_iid: mrIid,
          }
        )
      )

      return response.data.map((note) => ({
        id: note.id,
        body: note.body,
        author: {
          login: note.author.username,
          name: note.author.name,
        },
        createdAt: note.created_at,
        system: note.system ?? false,
      }))
    } catch (error) {
      throw new Error(
        `Failed to list notes for MR ${mrIid} in project ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async createMRNote(projectId: string, mrIid: number, body: string): Promise<Note> {
    try {
      const effectiveProjectId = projectId ?? String(this.config.defaultProjectId ?? "")
      if (!effectiveProjectId) {
        throw new Error("Project ID is required and was not provided or configured")
      }

      const response = await retryWithBackoff(() =>
        this.octokit.request<GitLabResponses.NoteSingleResponse>(
          "POST /projects/{project_id}/merge_requests/{mr_iid}/notes",
          {
            project_id: effectiveProjectId,
            mr_iid: mrIid,
            body,
          }
        )
      )

      const note = response.data
      return {
        id: note.id,
        body: note.body,
        author: {
          login: note.author.username,
          name: note.author.name,
        },
        createdAt: note.created_at,
        system: note.system ?? false,
      }
    } catch (error) {
      throw new Error(
        `Failed to create note for MR ${mrIid} in project ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async listMRDiscussions(projectId: string, mrIid: number): Promise<Discussion[]> {
    try {
      const effectiveProjectId = projectId ?? String(this.config.defaultProjectId ?? "")
      if (!effectiveProjectId) {
        throw new Error("Project ID is required and was not provided or configured")
      }

      const response = await retryWithBackoff(() =>
        this.octokit.request<GitLabResponses.DiscussionsListResponse[]>(
          "GET /projects/{project_id}/merge_requests/{mr_iid}/discussions",
          {
            project_id: effectiveProjectId,
            mr_iid: mrIid,
          }
        )
      )

      return response.data.map((discussion) => ({
        id: discussion.id,
        notes: discussion.notes.map((note) => ({
          id: note.id,
          body: note.body,
          author: {
            login: note.author.username,
            name: note.author.name,
          },
          createdAt: note.created_at,
          system: note.system ?? false,
        })),
      }))
    } catch (error) {
      throw new Error(
        `Failed to list discussions for MR ${mrIid} in project ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async createMRDiscussion(
    projectId: string,
    mrIid: number,
    position: Position,
    body: string
  ): Promise<Discussion> {
    try {
      const effectiveProjectId = projectId ?? String(this.config.defaultProjectId ?? "")
      if (!effectiveProjectId) {
        throw new Error("Project ID is required and was not provided or configured")
      }

      const response = await retryWithBackoff(() =>
        this.octokit.request<GitLabResponses.DiscussionSingleResponse>(
          "POST /projects/{project_id}/merge_requests/{mr_iid}/discussions",
          {
            project_id: effectiveProjectId,
            mr_iid: mrIid,
            body,
            position: {
              base_sha: position.baseSha,
              start_sha: position.startSha,
              head_sha: position.headSha,
              position_type: position.positionType,
              new_path: position.newPath,
              new_line: position.newLine,
            },
          }
        )
      )

      const discussion = response.data
      return {
        id: discussion.id,
        notes: discussion.notes.map((note) => ({
          id: note.id,
          body: note.body,
          author: {
            login: note.author.username,
            name: note.author.name,
          },
          createdAt: note.created_at,
          system: note.system ?? false,
        })),
      }
    } catch (error) {
      throw new Error(
        `Failed to create inline comment for MR ${mrIid} in project ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async getAuthToken(): Promise<string> {
    return this.config.token
  }
}
