# Activities

> Source: https://jules.google/docs/api/reference/activities

Activities represent events that occur during a session. Use the Activities API to monitor progress, retrieve messages, and access artifacts like code changes.

## List Activities

```
GET /v1alpha/sessions/{sessionId}/activities
```

Lists all activities for a session.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `parent` | `string` | The parent session. Format: `sessions/{session}`. Pattern: `^sessions/[^/]+$` |

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `pageSize` | `integer` | Number of activities to return (1-100). Defaults to 50. |
| `pageToken` | `string` | Page token from a previous ListActivities response. |
| `createTime` | `string` | Optional timestamp filter to get activities after a specific time. |

### Example Requests

```bash
curl -H "x-goog-api-key: $JULES_API_KEY" \
  "https://jules.googleapis.com/v1alpha/sessions/1234567/activities?pageSize=20"
```

```bash
# Filter by timestamp
ENDPOINT="https://jules.googleapis.com/v1alpha/sessions/1234567/activities"
TIMESTAMP="2026-01-17T00:03:53.137240Z"

curl -H "x-goog-api-key: $JULES_API_KEY" \
  "$ENDPOINT?createTime=$TIMESTAMP"
```

### Response

```json
{
  "activities": [
    {
      "name": "sessions/1234567/activities/act1",
      "id": "act1",
      "originator": "system",
      "description": "Session started",
      "createTime": "2024-01-15T10:30:00Z"
    },
    {
      "name": "sessions/1234567/activities/act2",
      "id": "act2",
      "originator": "agent",
      "description": "Plan generated",
      "planGenerated": {
        "plan": {
          "id": "plan1",
          "steps": [
            {
              "id": "step1",
              "index": 0,
              "title": "Analyze existing code",
              "description": "Review the authentication module structure"
            },
            {
              "id": "step2",
              "index": 1,
              "title": "Write unit tests",
              "description": "Create comprehensive test coverage"
            }
          ],
          "createTime": "2024-01-15T10:31:00Z"
        }
      },
      "createTime": "2024-01-15T10:31:00Z"
    }
  ],
  "nextPageToken": "eyJvZmZzZXQiOjIwfQ=="
}
```

---

## Get an Activity

```
GET /v1alpha/sessions/{sessionId}/activities/{activityId}
```

Retrieves a single activity by ID.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | The resource name of the activity. Format: `sessions/{session}/activities/{activity}`. Pattern: `^sessions/[^/]+/activities/[^/]+$` |

### Example Request

```bash
curl -H "x-goog-api-key: $JULES_API_KEY" \
  https://jules.googleapis.com/v1alpha/sessions/1234567/activities/act2
```

### Response

Returns the full [Activity](./types.md#activity) object:

```json
{
  "name": "sessions/1234567/activities/act2",
  "id": "act2",
  "originator": "agent",
  "description": "Code changes ready",
  "createTime": "2024-01-15T11:00:00Z",
  "artifacts": [
    {
      "changeSet": {
        "source": "sources/github-myorg-myrepo",
        "gitPatch": {
          "baseCommitId": "a1b2c3d4",
          "unidiffPatch": "diff --git a/tests/auth.test.js...",
          "suggestedCommitMessage": "Add unit tests for authentication module"
        }
      }
    }
  ]
}
```

---

## Activity Types

Activities have different types based on what occurred. Each activity will have exactly one of these event fields populated:

### Plan Generated

Indicates Jules has created a plan for the task:

```json
{
  "planGenerated": {
    "plan": {
      "id": "plan1",
      "steps": [
        {
          "id": "step1",
          "index": 0,
          "title": "Step title",
          "description": "Details"
        }
      ],
      "createTime": "2024-01-15T10:31:00Z"
    }
  }
}
```

### Plan Approved

Indicates a plan was approved (by user or auto-approved):

```json
{
  "planApproved": {
    "planId": "plan1"
  }
}
```

### User Messaged

A message from the user:

```json
{
  "userMessaged": {
    "userMessage": "Please also add integration tests"
  }
}
```

### Agent Messaged

A message from Jules:

```json
{
  "agentMessaged": {
    "agentMessage": "I've completed the unit tests. Would you like me to add integration tests as well?"
  }
}
```

### Progress Updated

A status update during execution:

```json
{
  "progressUpdated": {
    "title": "Writing tests",
    "description": "Creating test cases for login functionality"
  }
}
```

### Session Completed

The session finished successfully:

```json
{
  "sessionCompleted": {}
}
```

### Session Failed

The session encountered an error:

```json
{
  "sessionFailed": {
    "reason": "Unable to install dependencies"
  }
}
```

---

## Artifacts

Activities may include artifacts — outputs produced during execution:

### Code Changes (ChangeSet)

```json
{
  "artifacts": [
    {
      "changeSet": {
        "source": "sources/github-myorg-myrepo",
        "gitPatch": {
          "baseCommitId": "a1b2c3d4e5f6",
          "unidiffPatch": "diff --git a/src/auth.js b/src/auth.js\n...",
          "suggestedCommitMessage": "Add authentication tests"
        }
      }
    }
  ]
}
```

### Bash Output

```json
{
  "artifacts": [
    {
      "bashOutput": {
        "command": "npm test",
        "output": "All tests passed (42 passing)",
        "exitCode": 0
      }
    }
  ]
}
```

### Media

```json
{
  "artifacts": [
    {
      "media": {
        "mimeType": "image/png",
        "data": "base64-encoded-data..."
      }
    }
  ]
}
```
