# Sessions

> Source: https://jules.google/docs/api/reference/sessions

Sessions are the core resource in the Jules REST API. A session represents a unit of work where Jules executes a coding task on your repository.

## Create a Session

```
POST /v1alpha/sessions
```

Creates a new session to start a coding task.

### Request Body

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | The task description for Jules to execute. |
| `title` | `string` | Optional title for the session. If not provided, the system will generate one. |
| `sourceContext` | [SourceContext](./types.md#sourcecontext) | The source repository and branch context for this session. Optional for repoless sessions. |
| `requirePlanApproval` | `boolean` | If true, plans require explicit approval before execution. If not set, plans are auto-approved. |
| `automationMode` | [AutomationMode](./types.md#automationmode) | Automation mode. Use `AUTO_CREATE_PR` to automatically create pull requests when code changes are ready. |

### Example Request

```bash
curl -X POST \
  -H "x-goog-api-key: $JULES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Add comprehensive unit tests for the authentication module",
    "title": "Add auth tests",
    "sourceContext": {
      "source": "sources/github-myorg-myrepo",
      "githubRepoContext": {
        "startingBranch": "main"
      }
    },
    "requirePlanApproval": true
  }' \
  https://jules.googleapis.com/v1alpha/sessions
```

### Response

Returns the created [Session](./types.md#session) object:

```json
{
  "name": "sessions/1234567",
  "id": "abc123",
  "prompt": "Add comprehensive unit tests for the authentication module",
  "title": "Add auth tests",
  "state": "QUEUED",
  "url": "https://jules.google.com/session/abc123",
  "createTime": "2024-01-15T10:30:00Z",
  "updateTime": "2024-01-15T10:30:00Z"
}
```

---

## List Sessions

```
GET /v1alpha/sessions
```

Lists all sessions for the authenticated user.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `pageSize` | `integer` | Number of sessions to return (1-100). Defaults to 30. |
| `pageToken` | `string` | Page token from a previous ListSessions response. |

### Example Request

```bash
curl -H "x-goog-api-key: $JULES_API_KEY" \
  "https://jules.googleapis.com/v1alpha/sessions?pageSize=10"
```

### Response

```json
{
  "sessions": [
    {
      "name": "sessions/1234567",
      "id": "abc123",
      "title": "Add auth tests",
      "state": "COMPLETED",
      "createTime": "2024-01-15T10:30:00Z",
      "updateTime": "2024-01-15T11:45:00Z"
    }
  ],
  "nextPageToken": "eyJvZmZzZXQiOjEwfQ=="
}
```

---

## Get a Session

```
GET /v1alpha/sessions/{sessionId}
```

Retrieves a single session by ID.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | The resource name of the session. Format: `sessions/{session}`. Pattern: `^sessions/[^/]+$` |

### Example Request

```bash
curl -H "x-goog-api-key: $JULES_API_KEY" \
  https://jules.googleapis.com/v1alpha/sessions/1234567
```

### Response

Returns the full [Session](./types.md#session) object including outputs if the session has completed:

```json
{
  "name": "sessions/1234567",
  "id": "abc123",
  "prompt": "Add comprehensive unit tests for the authentication module",
  "title": "Add auth tests",
  "state": "COMPLETED",
  "url": "https://jules.google.com/session/abc123",
  "createTime": "2024-01-15T10:30:00Z",
  "updateTime": "2024-01-15T11:45:00Z",
  "outputs": [
    {
      "pullRequest": {
        "url": "https://github.com/myorg/myrepo/pull/42",
        "title": "Add auth tests",
        "description": "Added unit tests for authentication module"
      }
    }
  ]
}
```

---

## Delete a Session

```
DELETE /v1alpha/sessions/{sessionId}
```

Deletes a session.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | The resource name of the session to delete. Format: `sessions/{session}`. Pattern: `^sessions/[^/]+$` |

### Example Request

```bash
curl -X DELETE \
  -H "x-goog-api-key: $JULES_API_KEY" \
  https://jules.googleapis.com/v1alpha/sessions/1234567
```

### Response

Returns an empty response on success.

---

## Send a Message

```
POST /v1alpha/sessions/{sessionId}:sendMessage
```

Sends a message from the user to an active session. Use this endpoint to provide feedback, answer questions, or give additional instructions to Jules during an active session.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `session` | `string` | The resource name of the session. Format: `sessions/{session}`. Pattern: `^sessions/[^/]+$` |

### Request Body

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | The message to send to the session. |

### Example Request

```bash
curl -X POST \
  -H "x-goog-api-key: $JULES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Please also add integration tests for the login flow"
  }' \
  https://jules.googleapis.com/v1alpha/sessions/1234567:sendMessage
```

### Response

Returns an empty [SendMessageResponse](./types.md#sendmessageresponse) on success.

---

## Approve a Plan

```
POST /v1alpha/sessions/{sessionId}:approvePlan
```

Approves a pending plan in a session. This endpoint is only needed when `requirePlanApproval` was set to `true` when creating the session.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `session` | `string` | The resource name of the session. Format: `sessions/{session}`. Pattern: `^sessions/[^/]+$` |

### Example Request

```bash
curl -X POST \
  -H "x-goog-api-key: $JULES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  https://jules.googleapis.com/v1alpha/sessions/1234567:approvePlan
```

### Response

Returns an empty [ApprovePlanResponse](./types.md#approveplanresponse) on success.

---

## Session States

Sessions progress through the following states:

| State | Description |
|-------|-------------|
| `QUEUED` | Session is queued for processing |
| `PLANNING` | Jules is generating a plan |
| `AWAITING_PLAN_APPROVAL` | Plan requires user approval |
| `AWAITING_USER_FEEDBACK` | Jules is waiting for user input |
| `IN_PROGRESS` | Jules is executing the plan |
| `PAUSED` | Session is paused |
| `COMPLETED` | Session finished successfully |
| `FAILED` | Session encountered an error |
