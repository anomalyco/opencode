/**
 * VCS Provider Interface
 * Abstraction layer for version control system providers (GitLab, GitHub)
 */

export interface IVCSProvider {
  name: string

  // Webhook handling
  parseWebhook(headers: Headers, body: string): WebhookEvent | Promise<WebhookEvent>

  // Merge Request operations
  getMR(projectId: string, mrIid: number): Promise<MergeRequest>
  listMRs(projectId: string, filters?: MRFilters): Promise<MergeRequest[]>

  // Diffs
  getMRChanges(projectId: string, mrIid: number): Promise<MRChanges>

  // Comments (Notes)
  listMRNotes(projectId: string, mrIid: number): Promise<Note[]>
  createMRNote(projectId: string, mrIid: number, body: string): Promise<Note>

  // Discussions (inline comments)
  listMRDiscussions(projectId: string, mrIid: number): Promise<Discussion[]>
  createMRDiscussion(
    projectId: string,
    mrIid: number,
    position: Position,
    body: string
  ): Promise<Discussion>

  // Authentication
  getAuthToken(): Promise<string>
}

// Webhook event types
export type WebhookEvent = {
  type: "note" | "merge_request" | "discussion"
  objectKind: string
  projectId: number
  mrIid?: number
  author?: VCSAuthor
  body?: string
}

export type VCSAuthor = {
  login: string
  name?: string
}

// Merge Request types
export type MergeRequest = {
  iid: number
  title: string
  description: string
  author: VCSAuthor
  sourceBranch: string
  targetBranch: string
  sourceSha: string
  targetSha: string
  createdAt: string
  state: string
  webUrl: string
}

export type MRFilters = {
  state?: "opened" | "closed" | "merged"
  author?: string
}

// MR Changes (diffs)
export type MRChanges = {
  files: VCSFile[]
  additions: number
  deletions: number
}

export type VCSFile = {
  path: string
  newPath: string
  oldPath: string
  additions: number
  deletions: number
  changeType: "added" | "modified" | "deleted" | "renamed"
}

// Notes (general comments)
export type Note = {
  id: number
  body: string
  author: VCSAuthor
  createdAt: string
  system: boolean
}

// Discussions (inline comments)
export type Discussion = {
  id: string
  notes: Note[]
}

// Position for inline comments
export type Position = {
  baseSha: string
  startSha: string
  headSha: string
  positionType: "text"
  newPath: string
  newLine: number
}
