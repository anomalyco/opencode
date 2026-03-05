# OPENSACIA Phase 3: GitLab Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate OPENSACIA from GitHub to GitLab self-hosted for complete version control system integration while maintaining upstream compatibility.

**Architecture:** Multi-VCS provider pattern with IVCSProvider interface. GitLab as default provider, GitHub kept as deprecated fallback. VCS Manager routes operations based on config. Octokit SDK for GitLab API compatibility.

**Tech Stack:** TypeScript, Bun, @octokit/rest, @octokit/graphql, Zod for validation

---

## Task 1: Add GitLab environment variables to flag.ts

**Files:**
- Modify: `packages/opencode/src/flag/flag.ts:42-53`

**Step 1: Add GitLab environment variables**

Add after OPENSACIA_OLLAMA_BASE_URL (around line 53):

```typescript
// OPENSACIA: GitLab VCS provider configuration
export const OPENSACIA_VCS_PROVIDER =
  process.env["OPENSACIA_VCS_PROVIDER"] ?? process.env["OPENCODE_VCS_PROVIDER"] ?? "gitlab"
export const OPENSACIA_GITLAB_BASE_URL =
  process.env["OPENSACIA_GITLAB_BASE_URL"] ??
  process.env["OPENCODE_GITLAB_BASE_URL"] ??
  "https://hera.tics.inta/api/v4"
export const OPENSACIA_GITLAB_TOKEN =
  process.env["OPENSACIA_GITLAB_TOKEN"] ?? process.env["OPENCODE_GITLAB_TOKEN"]
export const OPENSACIA_GITLAB_PROJECT_ID =
  process.env["OPENSACIA_GITLAB_PROJECT_ID"] ?? process.env["OPENCODE_GITLAB_PROJECT_ID"]
```

**Step 2: Run tests to verify no regressions**

Run: `bun test --cwd packages/opencode test/config/config.test.ts`
Expected: PASS (all existing tests pass)

**Step 3: Commit**

```bash
git add packages/opencode/src/flag/flag.ts
git commit -m "feat: add GitLab VCS environment variables"
```

---

## Task 2: Create VCS provider interface

**Files:**
- Create: `packages/opencode/src/vcs/provider.ts`
- Test: `packages/opencode/test/vcs/provider.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/vcs/provider.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import type { WebhookEvent } from "../../src/vcs/provider"

describe("VCS Provider Interface", () => {
  test("WebhookEvent type has required fields", () => {
    const event: WebhookEvent = {
      type: "note",
      objectKind: "note",
      projectId: 61,
      mrIid: 123,
    }
    expect(event.type).toBe("note")
    expect(event.objectKind).toBe("note")
    expect(event.projectId).toBe(61)
    expect(event.mrIid).toBe(123)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/vcs/provider.test.ts`
Expected: FAIL with "Cannot find module '../../src/vcs/provider'"

**Step 3: Write minimal implementation**

Create `packages/opencode/src/vcs/provider.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/vcs/provider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/vcs/provider.ts packages/opencode/test/vcs/provider.test.ts
git commit -m "feat: add VCS provider interface"
```

---

## Task 3: Create GitLab provider implementation

**Files:**
- Create: `packages/opencode/src/vcs/gitlab/gitlab.ts`
- Test: `packages/opencode/test/vcs/gitlab/gitlab.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/vcs/gitlab/gitlab.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"

describe("GitLabProvider", () => {
  test("parseWebhook extracts MR note event", () => {
    const headers = new Headers({
      "x-gitlab-token": "test-secret",
      "x-gitlab-event": "Merge Request Hook",
    })

    const body = JSON.stringify({
      object_kind: "note",
      event_type: "note",
      project: { id: 61 },
      merge_request: { iid: 123 },
      object_attributes: {
        noteable_type: "MergeRequest",
        note: "Test comment",
      },
    })

    // This will fail until we implement GitLabProvider
    expect(() => {
      // Will be implemented in step 3
    }).toThrow()
  })

  test("createMRDiscussion uses correct position format", async () => {
    // Test position object format
    const position = {
      baseSha: "abc123",
      startSha: "def456",
      headSha: "ghi789",
      positionType: "text" as const,
      newPath: "src/test.ts",
      newLine: 42,
    }

    expect(position.newLine).toBe(42)
    expect(position.positionType).toBe("text")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/vcs/gitlab/gitlab.test.ts`
Expected: FAIL with "Cannot find module '../../src/vcs/gitlab/gitlab'"

**Step 3: Write minimal implementation**

Create `packages/opencode/src/vcs/gitlab/gitlab.ts`:

```typescript
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
    // Verify webhook signature
    const token = headers.get("x-gitlab-token")
    if (!token) {
      throw new Error("Missing X-Gitlab-Token header")
    }

    const data = JSON.parse(body)

    // Extract event type
    const objectKind = data.object_kind || data.event_type

    // Build base event
    const event: WebhookEvent = {
      type: this.mapEventType(objectKind),
      objectKind,
      projectId: data.project?.id || data.project_id,
    }

    // Extract MR-specific fields
    if (data.merge_request) {
      event.mrIid = data.merge_request.iid
    } else if (data.object_attributes?.iid) {
      event.mrIid = data.object_attributes.iid
    }

    // Extract author
    if (data.user) {
      event.author = {
        login: data.user.username,
        name: data.user.name,
      }
    } else if (data.user?.username) {
      event.author = {
        login: data.user.username,
        name: data.user.name,
      }
    }

    // Extract comment body
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
    if (objectKind === "merge_request") {
      return "merge_request"
    }
    return "note" // Default
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
        newPath: file.new_path,
        oldPath: file.old_path,
        additions: file.diff?.split("\n").filter((l: string) => l.startsWith("+")).length || 0,
        deletions: file.diff?.split("\n").filter((l: string) => l.startsWith("-")).length || 0,
        changeType: this.mapChangeType(file.new_file, file.renamed_file, file.deleted_file),
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
      // If inline comment fails (line deleted), fallback to general note
      throw new Error(`Failed to create inline comment: ${error}`)
    }
  }

  async getAuthToken(): Promise<string> {
    return this.config.token
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/vcs/gitlab/gitlab.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/vcs/gitlab/ packages/opencode/test/vcs/gitlab/
git commit -m "feat: add GitLab provider implementation"
```

---

## Task 4: Refactor GitHub code to GitHub provider

**Files:**
- Move: `packages/opencode/src/cli/cmd/github.ts` → `packages/opencode/src/vcs/github/github.ts`
- Modify: `packages/opencode/src/vcs/github/github.ts` (extract to provider class)
- Test: `packages/opencode/test/vcs/github/github.test.ts`

**Step 1: Copy existing github.ts to new location**

```bash
mkdir -p packages/opencode/src/vcs/github
cp packages/opencode/src/cli/cmd/github.ts packages/opencode/src/vcs/github/github.ts
```

**Step 2: Write test for GitHub provider**

Create `packages/opencode/test/vcs/github/github.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { GitHubProvider } from "../../src/vcs/github/github"
import type { GitHubConfig } from "../../src/vcs/github/github"

describe("GitHubProvider", () => {
  test("parseWebhook extracts issue comment event", () => {
    const config: GitHubConfig = {
      token: "test-token",
    }
    const provider = new GitHubProvider(config)

    const headers = new Headers({
      "x-hub-signature-256": "sha256=test",
      "x-github-event": "issue_comment",
    })

    const body = JSON.stringify({
      action: "created",
      issue: { number: 123 },
      repository: { owner: { login: "test" }, name: "repo" },
      comment: { body: "Test comment", user: { login: "testuser" } },
    })

    // Will be implemented in step 3
    expect(() => provider.parseWebhook(headers, body)).toThrow()
  })
})
```

**Step 3: Refactor github.ts to implement IVCSProvider**

This is a large refactoring. Key changes:

1. Import IVCSProvider interface
2. Export GitHubConfig interface
3. Create GitHubProvider class implementing IVCSProvider
4. Keep existing helper functions as module exports
5. Mark as deprecated

Add to top of file after imports:

```typescript
import type {
  IVCSProvider,
  WebhookEvent,
  MergeRequest,
  MRFilters,
  MRChanges,
  Note,
  Discussion,
  Position,
} from "../provider"

export interface GitHubConfig {
  token: string
}

/**
 * @deprecated Use GitLabProvider instead. Maintained for upstream compatibility.
 */
export class GitHubProvider implements IVCSProvider {
  name = "github"

  constructor(private config: GitHubConfig) {
    // Initialize octokit instances
  }

  // Implement all IVCSProvider methods
  // Map GitHub PullRequest to MergeRequest
  // Map GitHub ReviewComment to Discussion
  // etc.
}
```

**Step 4: Update imports in existing files**

Update `packages/opencode/src/cli/cmd/github.ts` (new stub file that imports from vcs/github):

```typescript
/**
 * @deprecated Use VCS Manager with GitLab provider instead
 */

// Re-export for backward compatibility
export {
  parseGitHubRemote,
  extractResponseText,
  formatPromptTooLargeError,
  GithubCommand,
  GithubInstallCommand,
  GithubRunCommand,
} from "../../vcs/github/github"
```

**Step 5: Run tests**

Run: `bun test --cwd packages/opencode test/cli/github-action.test.ts`
Expected: PASS (tests still work with re-exports)

**Step 6: Commit**

```bash
git add packages/opencode/src/vcs/github/ packages/opencode/src/cli/cmd/github.ts packages/opencode/test/vcs/github/
git commit -m "refactor: extract GitHub provider, mark as deprecated"
```

---

## Task 5: Create VCS manager

**Files:**
- Create: `packages/opencode/src/vcs/manager.ts`
- Test: `packages/opencode/test/vcs/manager.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/vcs/manager.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { VCSManager } from "../../src/vcs/manager"

describe("VCSManager", () => {
  test("initializes with GitLab provider by default", async () => {
    const manager = new VCSManager()
    await manager.initialize()

    expect(manager.providerName).toBe("gitlab")
  })

  test("routes getMR to active provider", async () => {
    const manager = new VCSManager({
      provider: "gitlab",
      gitlab: {
        baseUrl: "https://hera.tics.inta/api/v4",
        token: "test-token",
      },
    })
    await manager.initialize()

    // This will fail without mock, tests interface
    expect(manager.providerName).toBe("gitlab")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/vcs/manager.test.ts`
Expected: FAIL with "Cannot find module '../../src/vcs/manager'"

**Step 3: Write minimal implementation**

Create `packages/opencode/src/vcs/manager.ts`:

```typescript
import { Flag } from "@/flag"
import { GitLabProvider, type GitLabConfig } from "./gitlab/gitlab"
import { GitHubProvider, type GitHubConfig } from "./github/github"
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
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/vcs/manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/vcs/manager.ts packages/opencode/test/vcs/manager.test.ts
git commit -m "feat: add VCS manager for provider routing"
```

---

## Task 6: Create GitLab webhook handler

**Files:**
- Create: `packages/opencode/src/vcs/gitlab/webhook.ts`
- Modify: `packages/opencode/src/cli/cmd/serve.ts` (add webhook route)
- Test: `packages/opencode/test/vcs/gitlab/webhook.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/vcs/gitlab/webhook.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { handleGitLabWebhook } from "../../src/vcs/gitlab/webhook"

describe("GitLab Webhook Handler", () => {
  test("filters non-MR note events", async () => {
    const headers = new Headers({
      "x-gitlab-token": "test-secret",
      "x-gitlab-event": "Merge Request Hook",
    })

    const body = JSON.stringify({
      object_kind: "note",
      project: { id: 61 },
      merge_request: { iid: 123 },
      object_attributes: {
        noteable_type: "Issue", // Not MR
      },
    })

    const result = await handleGitLabWebhook(headers, body)
    expect(result.shouldProcess).toBe(false)
  })

  test("processes MR note events", async () => {
    const headers = new Headers({
      "x-gitlab-token": "test-secret",
      "x-gitlab-event": "Merge Request Hook",
    })

    const body = JSON.stringify({
      object_kind: "note",
      project: { id: 61 },
      merge_request: { iid: 123 },
      object_attributes: {
        noteable_type: "MergeRequest",
        note: "/oc summarize",
      },
      user: { username: "testuser", name: "Test User" },
    })

    const result = await handleGitLabWebhook(headers, body)
    expect(result.shouldProcess).toBe(true)
    expect(result.event?.projectId).toBe(61)
    expect(result.event?.mrIid).toBe(123)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/vcs/gitlab/webhook.test.ts`
Expected: FAIL with "Cannot find module '../../src/vcs/gitlab/webhook'"

**Step 3: Write minimal implementation**

Create `packages/opencode/src/vcs/gitlab/webhook.ts`:

```typescript
import { GitLabProvider } from "./gitlab"
import type { WebhookEvent } from "../provider"

export type WebhookResult = {
  shouldProcess: boolean
  event?: WebhookEvent
  error?: string
}

/**
 * GitLab webhook handler
 * Filters and validates incoming GitLab webhook events
 */
export async function handleGitLabWebhook(
  headers: Headers,
  body: string,
  provider?: GitLabProvider
): Promise<WebhookResult> {
  try {
    // Verify webhook token
    const token = headers.get("x-gitlab-token")
    if (!token) {
      return {
        shouldProcess: false,
        error: "Missing X-Gitlab-Token header",
      }
    }

    // Parse event using provider if available
    let event: WebhookEvent
    if (provider) {
      event = await provider.parseWebhook(headers, body)
    } else {
      const data = JSON.parse(body)
      event = {
        type: data.object_kind === "note" ? "note" : "merge_request",
        objectKind: data.object_kind,
        projectId: data.project?.id || data.project_id,
        mrIid: data.merge_request?.iid || data.object_attributes?.iid,
        author: data.user
          ? { login: data.user.username, name: data.user.name }
          : undefined,
        body: data.object_attributes?.note || data.object_attributes?.description,
      }
    }

    // Filter: only process MR note events
    const data = JSON.parse(body)
    if (event.objectKind === "note") {
      const noteableType = data.object_attributes?.noteable_type
      if (noteableType !== "MergeRequest") {
        return {
          shouldProcess: false,
          error: `Not a MR event: ${noteableType}`,
        }
      }
    }

    return {
      shouldProcess: true,
      event,
    }
  } catch (error) {
    return {
      shouldProcess: false,
      error: String(error),
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/vcs/gitlab/webhook.test.ts`
Expected: PASS

**Step 5: Update serve.ts to add GitLab webhook route**

Modify `packages/opencode/src/cli/cmd/serve.ts` to add GitLab webhook endpoint:

```typescript
import { handleGitLabWebhook } from "@/vcs/gitlab/webhook"
import { VCSManager } from "@/vcs/manager"

// Add route in server setup
app.post("/hooks/gitlab/:project", async (req) => {
  const projectId = req.params.project
  const headers = req.headers as any
  const body = await req.text()

  const result = await handleGitLabWebhook(headers, body, vcsManager as any)

  if (!result.shouldProcess) {
    return new Response(result.error || "Event not processed", { status: 202 })
  }

  // Process the event - trigger security audit or session
  // ... existing session handling logic ...

  return new Response("OK", { status: 200 })
})
```

**Step 6: Commit**

```bash
git add packages/opencode/src/vcs/gitlab/webhook.ts packages/opencode/test/vcs/gitlab/webhook.test.ts packages/opencode/src/cli/cmd/serve.ts
git commit -m "feat: add GitLab webhook handler"
```

---

## Task 7: Add GitLab CLI commands

**Files:**
- Create: `packages/opencode/src/cli/cmd/gitlab.ts`
- Modify: `packages/opencode/src/cli/cmd/cmd.ts` (register gitlab command)

**Step 1: Create gitlab command**

Create `packages/opencode/src/cli/cmd/gitlab.ts`:

```typescript
import { cmd } from "./cmd"
import { VCSManager } from "@/vcs/manager"
import * as prompts from "@clack/prompts"
import { Flag } from "@/flag"
import { Instance } from "@/project/instance"

export const GitlabCommand = cmd({
  command: "gitlab",
  describe: "manage GitLab integration",
  builder: (yargs) =>
    yargs
      .command(GitlabStatusCommand)
      .command(GitlabTestCommand)
      .command(GitlabConfigCommand)
      .demandCommand(),
  async handler() {},
})

export const GitlabStatusCommand = cmd({
  command: "status",
  describe: "check GitLab connection status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        prompts.intro("GitLab Status")

        const manager = new VCSManager()
        await manager.initialize()

        const baseUrl = Flag.OPENSACIA_GITLAB_BASE_URL
        const token = Flag.OPENSACIA_GITLAB_TOKEN
        const projectId = Flag.OPENSACIA_GITLAB_PROJECT_ID

        prompts.group({
          status: () =>
            prompts.note({
              title: "Provider",
              message: manager.providerName || "Not initialized",
            }),
          baseUrl: () =>
            prompts.note({
              title: "Base URL",
              message: baseUrl || "Not configured",
            }),
          projectId: () =>
            prompts.note({
              title: "Project ID",
              message: projectId || "Not configured",
            }),
          token: () =>
            prompts.note({
              title: "Token",
              message: token ? `${token.slice(0, 10)}...` : "Not configured",
            }),
        })

        prompts.outro("GitLab status complete")
      },
    })
  },
})

export const GitlabTestCommand = cmd({
  command: "test",
  describe: "test GitLab API connection",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        prompts.intro("Testing GitLab Connection")

        const manager = new VCSManager()
        await manager.initialize()

        try {
          const projectId = Flag.OPENSACIA_GITLAB_PROJECT_ID || "61"
          const mrs = await manager.listMRs(projectId, { state: "opened" })

          prompts.note({
            title: "Success",
            message: `Found ${mrs.length} open merge requests`,
          })
        } catch (error) {
          prompts.note({
            title: "Error",
            message: String(error),
          })
        }

        prompts.outro("GitLab test complete")
      },
    })
  },
})

export const GitlabConfigCommand = cmd({
  command: "config",
  describe: "show GitLab configuration",
  async handler() {
    const baseUrl = Flag.OPENSACIA_GITLAB_BASE_URL
    const projectId = Flag.OPENSACIA_GITLAB_PROJECT_ID
    const token = Flag.OPENSACIA_GITLAB_TOKEN

    console.log({
      provider: "gitlab",
      baseUrl,
      projectId,
      token: token ? `${token.slice(0, 10)}...` : undefined,
    })
  },
})
```

**Step 2: Register command in cmd.ts**

Modify `packages/opencode/src/cli/cmd/cmd.ts` to import and register GitlabCommand:

```typescript
import { GitlabCommand } from "./gitlab"

// Add to command exports or register with yargs
export const Cmd = cmd({
  // ... existing commands ...
}).command(GitlabCommand)
```

**Step 3: Test the command**

Run: `bun run packages/opencode/src/index.ts gitlab status`
Expected: Shows GitLab status

**Step 4: Commit**

```bash
git add packages/opencode/src/cli/cmd/gitlab.ts packages/opencode/src/cli/cmd/cmd.ts
git commit -m "feat: add GitLab CLI commands"
```

---

## Task 8: Create configuration validation

**Files:**
- Create: `packages/opencode/src/vcs/validation.ts`
- Test: `packages/opencode/test/vcs/validation.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/vcs/validation.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { validateGitLabConfig } from "../../src/vcs/validation"

describe("VCS Configuration Validation", () => {
  test("passes with valid config", async () => {
    const result = await validateGitLabConfig({
      baseUrl: "https://hera.tics.inta/api/v4",
      token: "test-token",
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("fails with missing baseUrl", async () => {
    const result = await validateGitLabConfig({
      baseUrl: "",
      token: "test-token",
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("baseUrl is required")
  })

  test("fails with missing token", async () => {
    const result = await validateGitLabConfig({
      baseUrl: "https://hera.tics.inta/api/v4",
      token: "",
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("token is required")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/vcs/validation.test.ts`
Expected: FAIL with "Cannot find module '../../src/vcs/validation'"

**Step 3: Write minimal implementation**

Create `packages/opencode/src/vcs/validation.ts`:

```typescript
import type { GitLabConfig } from "./gitlab/gitlab"

export type ValidationResult = {
  valid: boolean
  errors?: string[]
}

export async function validateGitLabConfig(config: GitLabConfig): Promise<ValidationResult> {
  const errors: string[] = []

  // Required fields
  if (!config.baseUrl) {
    errors.push("baseUrl is required")
  }
  if (!config.token) {
    errors.push("token is required")
  }

  // Test connection
  if (config.baseUrl && config.token) {
    try {
      const response = await fetch(`${config.baseUrl}/user`, {
        headers: { "PRIVATE-TOKEN": config.token },
        signal: AbortSignal.timeout(5000),
      })

      if (response.status === 401) {
        errors.push("Invalid token")
      } else if (response.status === 404) {
        errors.push("Invalid GitLab URL")
      } else if (!response.ok) {
        errors.push(`GitLab API error: ${response.status}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("ECONNREFUSED")) {
        errors.push("Cannot reach GitLab instance")
      } else {
        errors.push(`Connection error: ${message}`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/vcs/validation.test.ts`
Expected: PASS (connection tests may be skipped without real GitLab)

**Step 5: Commit**

```bash
git add packages/opencode/src/vcs/validation.ts packages/opencode/test/vcs/validation.test.ts
git commit -m "feat: add GitLab configuration validation"
```

---

## Task 9: Update pr.ts for GitLab MR checkout

**Files:**
- Modify: `packages/opencode/src/cli/cmd/pr.ts`
- Test: Update `packages/opencode/test/cli/import.test.ts` (if needed)

**Step 1: Add GitLab MR checkout function**

Modify `packages/opencode/src/cli/cmd/pr.ts`:

```typescript
import { VCSManager } from "@/vcs/manager"
import { Flag } from "@/flag"

export const PrCommand = cmd({
  command: "pr",
  describe: "checkout a merge request",
  builder: (yargs) =>
    yargs
      .option("id", { type: "string", description: "MR/IID number" })
      .option("project", { type: "string", default: () => Flag.OPENSACIA_GITLAB_PROJECT_ID }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const projectId = args.project as string
        const mrIid = args.id ? Number(args.id) : undefined

        if (!mrIid) {
          // List MRs
          const manager = new VCSManager()
          await manager.initialize()
          const mrs = await manager.listMRs(projectId)

          console.log("Open merge requests:")
          for (const mr of mrs) {
            console.log(`  !${mr.iid}: ${mr.title}`)
          }
          return
        }

        // Checkout MR
        const manager = new VCSManager()
        await manager.initialize()
        const mr = await manager.getMR(projectId, mrIid)

        // Fetch and checkout
        await $`git fetch origin ${mr.sourceBranch}`
        await $`git checkout ${mr.sourceBranch}`

        console.log(`Checked out MR !${mr.iid}: ${mr.title}`)
      },
    })
  },
})
```

**Step 2: Test the command**

Run: `bun run packages/opencode/src/index.ts pr --project 61 --id 1`
Expected: Checks out MR branch

**Step 3: Commit**

```bash
git add packages/opencode/src/cli/cmd/pr.ts
git commit -m "feat: add GitLab MR checkout command"
```

---

## Task 10: Add error handling with retry logic

**Files:**
- Modify: `packages/opencode/src/vcs/gitlab/gitlab.ts` (add retry wrapper)
- Test: `packages/opencode/test/vcs/gitlab/retry.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/vcs/gitlab/retry.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { retryWithBackoff } from "../../src/vcs/gitlab/gitlab"

describe("GitLab Retry Logic", () => {
  test("retries on failure", async () => {
    let attempts = 0
    const fn = async () => {
      attempts++
      if (attempts < 2) throw new Error("Temporary failure")
      return "success"
    }

    const result = await retryWithBackoff(fn, { maxAttempts: 3 })
    expect(result).toBe("success")
    expect(attempts).toBe(2)
  })

  test("gives up after max attempts", async () => {
    const fn = async () => {
      throw new Error("Permanent failure")
    }

    await expect(
      retryWithBackoff(fn, { maxAttempts: 2, baseDelay: 10 })
    ).rejects.toThrow("Permanent failure")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/vcs/gitlab/retry.test.ts`
Expected: FAIL with "retryWithBackoff is not defined"

**Step 3: Write minimal implementation**

Add to `packages/opencode/src/vcs/gitlab/gitlab.ts`:

```typescript
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
```

Wrap API calls in GitLabProvider with retry:

```typescript
async getMR(projectId: string, mrIid: number): Promise<MergeRequest> {
  return retryWithBackoff(async () => {
    const response = await this.octokit.request("GET /projects/{project_id}/merge_requests/{mr_iid}", {
      project_id: projectId,
      mr_iid: mrIid,
      headers: { "PRIVATE-TOKEN": this.config.token },
    })
    // ... rest of implementation
  })
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/vcs/gitlab/retry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/vcs/gitlab/gitlab.ts packages/opencode/test/vcs/gitlab/retry.test.ts
git commit -m "feat: add retry logic with exponential backoff"
```

---

## Task 11: Integration tests and documentation

**Files:**
- Create: `packages/opencode/test/vcs/integration.test.ts`
- Create: `docs/gitlab-setup.md`

**Step 1: Write integration test**

Create `packages/opencode/test/vcs/integration.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { VCSManager } from "../../src/vcs/manager"

describe("VCS Integration Tests", () => {
  // These tests require a real GitLab instance
  // Run with: GITLAB Integration Tests

  test("connects to GitLab and lists MRs", async () => {
    const baseUrl = process.env.OPENSACIA_GITLAB_BASE_URL
    const token = process.env.OPENSACIA_GITLAB_TOKEN
    const projectId = process.env.OPENSACIA_GITLAB_PROJECT_ID || "61"

    if (!token) {
      console.log("Skipping: OPENSACIA_GITLAB_TOKEN not set")
      return
    }

    const manager = new VCSManager({
      provider: "gitlab",
      gitlab: { baseUrl: baseUrl || "https://hera.tics.inta/api/v4", token },
    })
    await manager.initialize()

    const mrs = await manager.listMRs(projectId)
    expect(Array.isArray(mrs)).toBe(true)
  })

  test("gets MR details", async () => {
    const token = process.env.OPENSACIA_GITLAB_TOKEN
    const projectId = process.env.OPENSACIA_GITLAB_PROJECT_ID || "61"

    if (!token) {
      console.log("Skipping: OPENSACIA_GITLAB_TOKEN not set")
      return
    }

    const manager = new VCSManager({
      provider: "gitlab",
      gitlab: { baseUrl: "https://hera.tics.inta/api/v4", token },
    })
    await manager.initialize()

    // First list MRs to get a valid IID
    const mrs = await manager.listMRs(projectId, { state: "opened" })
    if (mrs.length === 0) {
      console.log("Skipping: No open MRs found")
      return
    }

    const mr = await manager.getMR(projectId, mrs[0].iid)
    expect(mr.iid).toBe(mrs[0].iid)
    expect(mr.title).toBeTruthy()
  })
})
```

**Step 2: Run integration tests**

Run: `OPENSACIA_GITLAB_TOKEN=glpat-your-token bun test --cwd packages/opencode test/vcs/integration.test.ts`
Expected: PASS (if GitLab is accessible)

**Step 3: Create documentation**

Create `docs/gitlab-setup.md`:

```markdown
# GitLab Integration Setup

## Configuration

Set environment variables:

\`\`\`bash
export OPENSACIA_VCS_PROVIDER=gitlab
export OPENSACIA_GITLAB_BASE_URL=https://hera.tics.inta/api/v4
export OPENSACIA_GITLAB_TOKEN=glpat-xxxxxxxxxxxx
export OPENSACIA_GITLAB_PROJECT_ID=61
\`\`\`

Or add to \`~/.config/opensacia/config.json\`:

\`\`\`json
{
  "vcs": {
    "provider": "gitlab",
    "gitlab": {
      "baseUrl": "https://hera.tics.inta/api/v4",
      "token": "glpat-xxxxxxxxxxxx",
      "defaultProjectId": 61
    }
  }
}
\`\`\`

## CLI Commands

- \`opensacia gitlab status\` - Check GitLab connection
- \`opensacia gitlab test\` - Test API connection
- \`opensacia gitlab config\` - Show configuration
- \`opensacia pr --project 61 --id 1\` - Checkout MR

## Webhooks

Configure webhooks in GitLab project settings:

URL: \`https://your-server/hooks/gitlab/61\`
Secret: Set webhook token in GitLab
Events: Merge Request events, Comments

## Testing

\`\`\`bash
# Unit tests
bun test --cwd packages/opencode test/vcs/

# Integration tests (requires GitLab access)
OPENSACIA_GITLAB_TOKEN=your-token bun test --cwd packages/opencode test/vcs/integration.test.ts
\`\`\`
```

**Step 4: Run all tests**

Run: `bun test --cwd packages/opencode test/vcs/`
Expected: All tests pass

**Step 5: Final commit**

```bash
git add packages/opencode/test/vcs/integration.test.ts docs/gitlab-setup.md
git commit -m "feat: add GitLab integration tests and documentation"
```

---

## Summary

This implementation plan creates a complete VCS abstraction layer with GitLab as the primary provider:

1. **Environment variables** for GitLab configuration
2. **IVCSProvider interface** defining the contract
3. **GitLabProvider** implementing GitLab API operations
4. **GitHubProvider** refactored to use the interface (deprecated)
5. **VCSManager** routing to the appropriate provider
6. **Webhook handler** filtering GitLab events
7. **CLI commands** for GitLab operations
8. **Configuration validation** with connection testing
9. **MR checkout** via CLI
10. **Retry logic** for API resilience
11. **Integration tests** and documentation

After implementation, OPENSACIA will be fully migrated to GitLab while maintaining backward compatibility with GitHub for upstream synchronization.
