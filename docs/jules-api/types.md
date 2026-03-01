# Types Reference

> Source: https://jules.google/docs/api/reference/types

This page documents all data types used in the Jules REST API.

## Core Resources

### Session

A session represents a unit of work where Jules executes a coding task.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Output only. The full resource name (e.g., `sessions/{session}`). |
| `id` | `string` | Output only. The session ID. |
| `prompt` | `string` | The task description for Jules to execute. |
| `title` | `string` | Optional title. If not provided, the system generates one. |
| `state` | [SessionState](#sessionstate) | Output only. Current state of the session. |
| `url` | `string` | Output only. URL to view the session in the Jules web app. |
| `sourceContext` | [SourceContext](#sourcecontext) | The source repository and branch context. |
| `requirePlanApproval` | `boolean` | Input only. If true, plans require explicit approval. |
| `automationMode` | [AutomationMode](#automationmode) | Input only. Automation mode for the session. |
| `outputs` | [SessionOutput](#sessionoutput)[] | Output only. Results of the session (e.g., pull requests). |
| `createTime` | `string` | Output only. When the session was created. |
| `updateTime` | `string` | Output only. When the session was last updated. |

### SessionState

Enum representing the current state of a session:

| Value | Description |
|-------|-------------|
| `STATE_UNSPECIFIED` | Default unspecified state |
| `QUEUED` | Session is queued for processing |
| `PLANNING` | Jules is generating a plan |
| `AWAITING_PLAN_APPROVAL` | Plan requires user approval |
| `AWAITING_USER_FEEDBACK` | Jules is waiting for user input |
| `IN_PROGRESS` | Jules is executing the plan |
| `PAUSED` | Session is paused |
| `FAILED` | Session encountered an error |
| `COMPLETED` | Session finished successfully |

### AutomationMode

Enum for session automation settings:

| Value | Description |
|-------|-------------|
| `AUTOMATION_MODE_UNSPECIFIED` | Default unspecified mode |
| `AUTO_CREATE_PR` | Automatically create pull requests when code changes are ready |

### Activity

An activity represents a single event within a session.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | The full resource name (e.g., `sessions/{session}/activities/{activity}`). |
| `id` | `string` | Output only. The activity ID. |
| `originator` | `string` | The entity that created this activity (`user`, `agent`, or `system`). |
| `description` | `string` | Output only. A description of this activity. |
| `createTime` | `string` | Output only. When the activity was created. |
| `artifacts` | [Artifact](#artifact)[] | Output only. Artifacts produced by this activity. |
| `planGenerated` | [PlanGenerated](#plangenerated) | A plan was generated. |
| `planApproved` | [PlanApproved](#planapproved) | A plan was approved. |
| `userMessaged` | [UserMessaged](#usermessaged) | The user posted a message. |
| `agentMessaged` | [AgentMessaged](#agentmessaged) | Jules posted a message. |
| `progressUpdated` | [ProgressUpdated](#progressupdated) | A progress update occurred. |
| `sessionCompleted` | [SessionCompleted](#sessioncompleted) | The session completed. |
| `sessionFailed` | [SessionFailed](#sessionfailed) | The session failed. |

### Source

A source represents a connected repository.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | The full resource name (e.g., `sources/{source}`). |
| `id` | `string` | Output only. The source ID. |
| `githubRepo` | [GitHubRepo](#githubrepo) | GitHub repository details. |

---

## Plans

### Plan

A sequence of steps that Jules will take to complete the task.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Output only. Unique ID for this plan within a session. |
| `steps` | [PlanStep](#planstep)[] | Output only. The steps in the plan. |
| `createTime` | `string` | Output only. When the plan was created. |

### PlanStep

A single step in a plan.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Output only. Unique ID for this step within a plan. |
| `index` | `integer` | Output only. 0-based index in the plan. |
| `title` | `string` | Output only. The title of the step. |
| `description` | `string` | Output only. Detailed description of the step. |

---

## Artifacts

### Artifact

A single unit of data produced by an activity.

| Field | Type | Description |
|-------|------|-------------|
| `changeSet` | [ChangeSet](#changeset) | Code changes produced. |
| `bashOutput` | [BashOutput](#bashoutput) | Command output produced. |
| `media` | [Media](#media) | Media file produced (e.g., image, video). |

### ChangeSet

A set of changes to be applied to a source.

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | The source this change set applies to. Format: `sources/{source}` |
| `gitPatch` | [GitPatch](#gitpatch) | The patch in Git format. |

### GitPatch

A patch in Git format.

| Field | Type | Description |
|-------|------|-------------|
| `baseCommitId` | `string` | The commit ID the patch should be applied to. |
| `unidiffPatch` | `string` | The patch in unified diff format. |
| `suggestedCommitMessage` | `string` | A suggested commit message for the patch. |

### BashOutput

Output from a bash command.

| Field | Type | Description |
|-------|------|-------------|
| `command` | `string` | The bash command that was executed. |
| `output` | `string` | Combined stdout and stderr output. |
| `exitCode` | `integer` | The exit code of the command. |

### Media

A media file output.

| Field | Type | Description |
|-------|------|-------------|
| `mimeType` | `string` | The MIME type of the media (e.g., `image/png`). |
| `data` | `string` | Base64-encoded media data. |

---

## GitHub Types

### GitHubRepo

A GitHub repository.

| Field | Type | Description |
|-------|------|-------------|
| `owner` | `string` | The repository owner (user or organization). |
| `repo` | `string` | The repository name. |
| `isPrivate` | `boolean` | Whether the repository is private. |
| `defaultBranch` | [GitHubBranch](#githubbranch) | The default branch. |
| `branches` | [GitHubBranch](#githubbranch)[] | List of active branches. |

### GitHubBranch

A GitHub branch.

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | `string` | The branch name. |

### GitHubRepoContext

Context for using a GitHub repo in a session.

| Field | Type | Description |
|-------|------|-------------|
| `startingBranch` | `string` | The branch to start the session from. |

---

## Context Types

### SourceContext

Context for how to use a source in a session.

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | The source resource name. Format: `sources/{source}` |
| `githubRepoContext` | [GitHubRepoContext](#githubrepocontext) | Context for GitHub repositories. |

---

## Output Types

### SessionOutput

An output of a session.

| Field | Type | Description |
|-------|------|-------------|
| `pullRequest` | [PullRequest](#pullrequest) | A pull request created by the session. |

### PullRequest

A pull request.

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | The URL of the pull request. |
| `title` | `string` | The title of the pull request. |
| `description` | `string` | The description of the pull request. |

---

## Activity Event Types

### PlanGenerated

A plan was generated.

| Field | Type | Description |
|-------|------|-------------|
| `plan` | [Plan](#plan) | The generated plan. |

### PlanApproved

A plan was approved.

| Field | Type | Description |
|-------|------|-------------|
| `planId` | `string` | The ID of the approved plan. |

### UserMessaged

The user posted a message.

| Field | Type | Description |
|-------|------|-------------|
| `userMessage` | `string` | The message content. |

### AgentMessaged

Jules posted a message.

| Field | Type | Description |
|-------|------|-------------|
| `agentMessage` | `string` | The message content. |

### ProgressUpdated

A progress update occurred.

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | The title of the update. |
| `description` | `string` | Details about the progress. |

### SessionCompleted

The session completed successfully. No additional properties.

### SessionFailed

The session failed.

| Field | Type | Description |
|-------|------|-------------|
| `reason` | `string` | The reason for the failure. |

---

## Request/Response Types

### SendMessageRequest

Request to send a message to a session.

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | The message to send. |

### SendMessageResponse

Response from sending a message. Empty response on success.

### ApprovePlanRequest

Request to approve a plan. Empty request body.

### ApprovePlanResponse

Response from approving a plan. Empty response on success.

### ListSessionsResponse

Response from listing sessions.

| Field | Type | Description |
|-------|------|-------------|
| `sessions` | [Session](#session)[] | The list of sessions. |
| `nextPageToken` | `string` | Token for the next page of results. |

### ListActivitiesResponse

Response from listing activities.

| Field | Type | Description |
|-------|------|-------------|
| `activities` | [Activity](#activity)[] | The list of activities. |
| `nextPageToken` | `string` | Token for the next page of results. |

### ListSourcesResponse

Response from listing sources.

| Field | Type | Description |
|-------|------|-------------|
| `sources` | [Source](#source)[] | The list of sources. |
| `nextPageToken` | `string` | Token for the next page of results. |
