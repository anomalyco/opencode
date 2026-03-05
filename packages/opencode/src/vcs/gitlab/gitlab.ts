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

export interface GitLabConfig {
  baseUrl: string
  token: string
  defaultProjectId?: number
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
    const objectKind = data.object_kind || data.event_type

    const event: WebhookEvent = {
      type: this.mapEventType(objectKind),
      objectKind,
      projectId: data.project?.id || data.project_id,
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
    const response = await this.octokit.request("GET /projects/{project_id}/merge_requests/{mr_iid}", {
      project_id: projectId,
      mr_iid: mrIid,
      headers: {
        "PRIVATE-TOKEN": this.config.token,
      },
    })

    const data = response.data as any
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
      targetSha: data.diff_refs?.base_sha || "",
      createdAt: data.created_at,
      state: data.state,
      webUrl: data.web_url,
    }
  }

  async listMRs(projectId: string, filters?: MRFilters): Promise<MergeRequest[]> {
    const response = await this.octokit.request("GET /projects/{project_id}/merge_requests", {
      project_id: projectId,
      state: filters?.state || "opened",
      headers: {
        "PRIVATE-TOKEN": this.config.token,
      },
    })

    return (response.data as any).map((mr: any) => ({
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
      targetSha: mr.diff_refs?.base_sha || "",
      createdAt: mr.created_at,
      state: mr.state,
      webUrl: mr.web_url,
    }))
  }

  async getMRChanges(projectId: string, mrIid: number): Promise<MRChanges> {
    const response = await this.octokit.request(
      "GET /projects/{project_id}/merge_requests/{mr_iid}/changes",
      {
        project_id: projectId,
        mr_iid: mrIid,
        headers: {
          "PRIVATE-TOKEN": this.config.token,
        },
      }
    )

    const data = response.data as any
    return {
      files: (data.changes || []).map((file: any) => ({
        path: file.new_path || file.old_path,
        newPath: file.new_path || "",
        oldPath: file.old_path || "",
        additions: file.diff?.split("\n").filter((l: string) => l.startsWith("+")).length || 0,
        deletions: file.diff?.split("\n").filter((l: string) => l.startsWith("-")).length || 0,
        changeType: this.mapChangeType(!!file.new_file, !!file.renamed_file, !!file.deleted_file),
      })),
      additions: data.additions || 0,
      deletions: data.deletions || 0,
    }
  }

  private mapChangeType(newFile: boolean, renamed: boolean, deleted: boolean): VCSFile["changeType"] {
    if (deleted) return "deleted"
    if (newFile) return "added"
    if (renamed) return "renamed"
    return "modified"
  }

  async listMRNotes(projectId: string, mrIid: number): Promise<Note[]> {
    const response = await this.octokit.request(
      "GET /projects/{project_id}/merge_requests/{mr_iid}/notes",
      {
        project_id: projectId,
        mr_iid: mrIid,
        headers: {
          "PRIVATE-TOKEN": this.config.token,
        },
      }
    )

    return (response.data as any).map((note: any) => ({
      id: note.id,
      body: note.body,
      author: {
        login: note.author.username,
        name: note.author.name,
      },
      createdAt: note.created_at,
      system: note.system || false,
    }))
  }

  async createMRNote(projectId: string, mrIid: number, body: string): Promise<Note> {
    const response = await this.octokit.request(
      "POST /projects/{project_id}/merge_requests/{mr_iid}/notes",
      {
        project_id: projectId,
        mr_iid: mrIid,
        body,
        headers: {
          "PRIVATE-TOKEN": this.config.token,
        },
      }
    )

    const note = response.data as any
    return {
      id: note.id,
      body: note.body,
      author: {
        login: note.author.username,
        name: note.author.name,
      },
      createdAt: note.created_at,
      system: note.system || false,
    }
  }

  async listMRDiscussions(projectId: string, mrIid: number): Promise<Discussion[]> {
    const response = await this.octokit.request(
      "GET /projects/{project_id}/merge_requests/{mr_iid}/discussions",
      {
        project_id: projectId,
        mr_iid: mrIid,
        headers: {
          "PRIVATE-TOKEN": this.config.token,
        },
      }
    )

    return (response.data as any).map((discussion: any) => ({
      id: discussion.id,
      notes: discussion.notes.map((note: any) => ({
        id: note.id,
        body: note.body,
        author: {
          login: note.author.username,
          name: note.author.name,
        },
        createdAt: note.created_at,
        system: note.system || false,
      })),
    }))
  }

  async createMRDiscussion(
    projectId: string,
    mrIid: number,
    position: Position,
    body: string
  ): Promise<Discussion> {
    try {
      const response = await this.octokit.request(
        "POST /projects/{project_id}/merge_requests/{mr_iid}/discussions",
        {
          project_id: projectId,
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
          headers: {
            "PRIVATE-TOKEN": this.config.token,
          },
        }
      )

      const discussion = response.data as any
      return {
        id: discussion.id,
        notes: discussion.notes.map((note: any) => ({
          id: note.id,
          body: note.body,
          author: {
            login: note.author.username,
            name: note.author.name,
          },
          createdAt: note.created_at,
          system: note.system || false,
        })),
      }
    } catch (error) {
      throw new Error(`Failed to create inline comment: ${error}`)
    }
  }

  async getAuthToken(): Promise<string> {
    return this.config.token
  }
}
