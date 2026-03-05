# OPENSACIA Phase 3: GitLab Migration Design

**Date:** 2026-03-05
**Author:** Victor Gonzalez (vicorente)
**Status:** Approved
**Related Issue:** N/A

## Overview

This document establishes the design for Phase 3 of OPENSACIA: migrating from GitHub to GitLab for complete version control system integration in self-hosted environments.

**Repository:** https://github.com/vicorente/OPENSACIA
**GitLab Instance:** https://hera.tics.inta
**Upstream:** https://github.com/anomalyco/opencode

## Architecture

### VCS Provider Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OPENSACIA VCS Layer                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │  GitHub Provider│  │  GitLab Provider│  │   Interface   │ │
│  │  (deprecated)  │  │     (new)       │  │   IVCSProvider │ │
│  └────────────────┘  └────────────────┘  └──────────────┘ │
│                              ↓                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              VCS Manager / Router                  │  │
│  │  (selects provider based on config or auto-detect)    │  │
│  └───────────────────────────────────────────────────────┘  │
│                              ↓                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Session / Agent / Comment Logic              │  │
│  │  (unchanged, uses VCS abstraction layer)             │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Default Provider:** GitLab (self-hosted at https://hera.tics.inta)

**Compatibility:** GitHub maintained as fallback for upstream synchronization.

## Components to Create/Modify

### 3.1 VCS Provider Interface (New)

**Create:** `packages/opencode/src/vcs/provider.ts`

```typescript
export interface IVCSProvider {
  name: string

  // Webhook handling
  parseWebhook(headers: Headers, body: string): WebhookEvent

  // Merge Request operations
  getMR(projectId: string, mrIid: number): Promise<MergeRequest>
  listMRs(projectId: string, filters?: MRFilters): Promise<MergeRequest[]>

  // Diffs
  getMRChanges(projectId: string, mrIid: number): Promise<MRChanges>

  // Comments
  listMRNotes(projectId: string, mrIid: number): Promise<Note[]>
  createMRNote(projectId: string, mrIid: number, body: string): Promise<Note>

  // Discussions (inline comments)
  listMRDiscussions(projectId: string, mrIid: number): Promise<Discussion[]>
  createMRDiscussion(projectId: string, mrIid: number, position: Position, body: string): Promise<Discussion>

  // Authentication
  getAuthToken(): Promise<string>
}

export type WebhookEvent = {
  type: 'note' | 'merge_request' | 'discussion'
  objectKind: string
  projectId: number
  mrIid?: number
  // ... other fields
}
```

### 3.2 GitHub Provider (Refactor)

**Move:** `packages/opencode/src/cli/cmd/github.ts` → `packages/opencode/src/vcs/github/github.ts`

**Changes:**
- Extract logic to `GitHubProvider` class implementing `IVCSProvider`
- Mark as deprecated in favor of GitLab provider
- Maintain functionality for upstream compatibility

### 3.3 GitLab Provider (New)

**Create:** `packages/opencode/src/vcs/gitlab/gitlab.ts`

```typescript
import { Octokit } from "@octokit/rest"

export class GitLabProvider implements IVCSProvider {
  name = "gitlab"

  constructor(private config: GitLabConfig) {
    this.octokit = new Octokit({
      auth: config.token,
      baseUrl: config.baseUrl // https://hera.tics.inta/api/v4
    })
  }

  async getMR(projectId: string, mrIid: number): Promise<MergeRequest> {
    const { data } = await this.octokit.rest.mergeRequests.show(projectId, mrIid)
    return this.transformMR(data)
  }

  async createMRDiscussion(projectId: string, mrIid: number, position: Position, body: string) {
    const { data } = await this.octokit.rest.Discussions.create(projectId, mrIid, {
      position,
      body
    })
    return data
  }

  // ... other methods
}
```

### 3.4 VCS Manager (New)

**Create:** `packages/opencode/src/vcs/manager.ts`

```typescript
export class VCSManager {
  private provider: IVCSProvider

  async initialize() {
    const config = await Config.get()
    const providerType = config.vcs?.provider ?? "gitlab"

    switch (providerType) {
      case "gitlab":
        this.provider = new GitLabProvider(config.vcs.gitlab)
        break
      case "github":
        this.provider = new GitHubProvider(config.vcs.github)
        break
      default:
        throw new Error(`Unknown VCS provider: ${providerType}`)
    }
  }

  // Delegate methods
  async getMR(...) { return this.provider.getMR(...) }
  async listMRs(...) { return this.provider.listMRs(...) }
  async createMRNote(...) { return this.provider.createMRNote(...) }
  async createMRDiscussion(...) { return this.provider.createMRDiscussion(...) }
}
```

## Data Flow - Webhooks and Merge Requests

```
┌─────────────────────────────────────────────────────────────┐
│                    GitLab Webhook                          │
│  (POST /hooks/{project}/merge_request_events or note events)   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              VCS Manager Router                              │
│  - Parse X-Gitlab-Token header                                  │
│  - Extract event type (note vs merge_request)                  │
│  - Filter: object_kind === "note" && noteable_type === "MergeRequest"│
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  GitLab Provider                              │
│  - Validate webhook signature                                   │
│  - Extract project ID, MR IID, author info                      │
│  - Trigger security audit session or direct comment action     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              OPENSACIA Security Auditor                       │
│  - Analyze MR changes via GitLab API                          │
│  - Generate security findings                                 │
│  - Post inline comments via Discussions API                    │
└─────────────────────────────────────────────────────────────┘
```

## Error Handling & Edge Cases

### Scenarios

| Scenario | Behavior |
|-----------|----------|
| GitLab API timeout | Retry with exponential backoff (3 attempts) |
| Token invalid | Clear error with instructions to regenerate PAT |
| MR too large (>100 files) | Paginate diff requests, process in chunks |
| Inline comment fails (line deleted) | Store as general note in MR instead |
| Private project no access | Specific error: "Access denied to project X" |
| Webhook without X-Gitlab-Token | Reject with 401 Forbidden |

### Configuration Validation

```typescript
async function validateGitLabConfig(config: GitLabConfig): Promise<Valid> {
  const errors: string[] = []

  if (!config.baseUrl) errors.push("baseUrl is required")
  if (!config.token) errors.push("token (PAT) is required")

  // Test connection
  try {
    const response = await fetch(`${config.baseUrl}/user`, {
      headers: { "PRIVATE-TOKEN": config.token }
    })
    if (response.status === 401) errors.push("Invalid token")
  } catch {
    errors.push("Cannot reach GitLab instance")
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
```

### Inline Comment Migration

GitLab inline comments require a `position` object:

```typescript
interface Position {
  baseSha: string
  startSha: string
  headSha: string
  positionType: "text"
  newPath: string
  newLine: number
}

// If line no longer exists (modified/deleted)
// Fallback: create general note on MR
```

## Testing & Validation

### Unit Tests

```typescript
// GitLab Provider tests
describe("GitLabProvider", () => {
  test("parseWebhook extracts MR note event", () => { })
  test("createMRDiscussion uses correct position format", async () => { })
  test("handle timeout with retry", async () => { })
})
```

### Integration Tests

```bash
# Requirement: GitLab instance running
# Set up test project and PAT

# Test: Webhook processing
bun test --cwd packages/opencode vcs/webhook.test.ts

# Test: MR diff extraction
bun test --cwd packages/opencode vcs/diff.test.ts

# Test: Inline comment creation
bun test --cwd packages/opencode vcs/discussion.test.ts
```

### Manual Validation Checklist

| Item | Command/Acción | Esperado |
|------|----------------|----------|
| GitLab connection | `curl -H "PRIVATE-TOKEN: $PAT" https://hera.tics.inta/api/v4/user` | User info JSON |
| Webhook receive | POST to webhook endpoint | 200 OK |
| MR listing | `glab mr list` in test project | List of MRs |
| Inline comment | Create discussion via API | Comment appears on line |
| Config validation | Start OPENSACIA with invalid config | Clear error |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSACIA_VCS_PROVIDER` | `gitlab` | VCS provider to use |
| `OPENSACIA_GITLAB_BASE_URL` | `https://hera.tics.inta/api/v4` | GitLab API URL |
| `OPENSACIA_GITLAB_TOKEN` | (none) | GitLab Personal Access Token |
| `OPENSACIA_GITLAB_PROJECT_ID` | (none) | Default project ID |

### Config File

**`~/.config/opensacia/config.json`:**

```json
{
  "vcs": {
    "provider": "gitlab",
    "gitlab": {
      "baseUrl": "https://hera.tics.inta/api/v4",
      "token": "glpat-xxxxxxxxxxxxxxxxxxxxx",
      "defaultProjectId": 123
    }
  }
}
```

## GitLab API Specifics

### Merge Request Events

**Webhook Headers:**
```
X-Gitlab-Token: <secret>
X-Gitlab-Event: Merge Request Hook
```

**Event Filtering:**
```typescript
// Process only MR note events
if (event.objectKind === "note" && event.noteableType === "MergeRequest") {
  // Process note comment
}

// Process MR open events
if (event.objectKind === "merge_request" && event.eventType === "open") {
  // New MR opened
}
```

### Inline Comment Position

```typescript
interface DiscussionPosition {
  base_sha: string
  start_sha: string
  head_sha: string
  position_type: "text"
  new_path: string
  new_line: number
}
```

### API Endpoints Used

| Operation | Endpoint | Method |
|-----------|----------|--------|
| Get MR | `/projects/:id/merge_requests/:iid` | GET |
| Get MR Changes | `/projects/:id/merge_requests/:iid/changes` | GET |
| List Notes | `/projects/:id/merge_requests/:iid/notes` | GET |
| Create Note | `/projects/:id/merge_requests/:iid/notes` | POST |
| List Discussions | `/projects/:id/merge_requests/:iid/discussions` | GET |
| Create Discussion | `/projects/:id/merge_requests/:iid/discussions` | POST |

## Next Steps

After Phase 3 completion:

1. **Phase 4:** Security auditor specialization
2. **Phase 5:** CI/CD orchestration and Zero Trust hardening
3. **Phase 6:** Testing and deployment

## References

- Design Document Phase 1: `docs/plans/2026-03-04-opensacia-phase1-design.md`
- Design Document Phase 2: `docs/plans/2026-03-05-opensacia-phase2-design.md`
- Implementation Plan Phase 1: `docs/plans/2026-03-04-opensacia-phase1-implementation.md`
- Implementation Plan Phase 2: `docs/plans/2026-03-05-opensacia-phase2-implementation.md`
- GitLab API Documentation: https://docs.gitlab.com/
- GitLab Webhooks: https://docs.gitlab.com/ee/user/project/integrations/webhooks.html
