import { describe, expect, test } from "bun:test"
import * as schemas from "../client/schemas"

describe("SessionState", () => {
  test("accepts valid states", () => {
    const states = [
      "STATE_UNSPECIFIED",
      "QUEUED",
      "PLANNING",
      "AWAITING_PLAN_APPROVAL",
      "AWAITING_USER_FEEDBACK",
      "IN_PROGRESS",
      "PAUSED",
      "FAILED",
      "COMPLETED",
    ]
    for (const s of states) {
      expect(schemas.SessionState.safeParse(s).success).toBe(true)
    }
  })

  test("rejects invalid state", () => {
    expect(schemas.SessionState.safeParse("RUNNING").success).toBe(false)
  })
})

describe("CreateSessionBody", () => {
  test("accepts minimal body", () => {
    const result = schemas.CreateSessionBody.safeParse({ prompt: "fix tests" })
    expect(result.success).toBe(true)
  })

  test("accepts full body", () => {
    const result = schemas.CreateSessionBody.safeParse({
      prompt: "fix tests",
      title: "Test fix",
      sourceContext: {
        source: "sources/github-org-repo",
        githubRepoContext: { startingBranch: "main" },
      },
      requirePlanApproval: true,
      automationMode: "AUTO_CREATE_PR",
    })
    expect(result.success).toBe(true)
  })

  test("rejects empty prompt", () => {
    const result = schemas.CreateSessionBody.safeParse({ prompt: "" })
    expect(result.success).toBe(false)
  })

  test("rejects missing prompt", () => {
    const result = schemas.CreateSessionBody.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe("Session", () => {
  const valid = {
    name: "sessions/123",
    id: "abc",
    prompt: "fix tests",
    state: "QUEUED",
    createTime: "2024-01-15T10:30:00Z",
    updateTime: "2024-01-15T10:30:00Z",
  }

  test("accepts valid session", () => {
    expect(schemas.Session.safeParse(valid).success).toBe(true)
  })

  test("accepts session with outputs", () => {
    const result = schemas.Session.safeParse({
      ...valid,
      state: "COMPLETED",
      outputs: [
        {
          pullRequest: {
            url: "https://github.com/org/repo/pull/1",
            title: "Fix tests",
            description: "Added missing tests",
          },
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  test("rejects session with invalid state", () => {
    expect(schemas.Session.safeParse({ ...valid, state: "RUNNING" }).success).toBe(false)
  })
})

describe("Activity", () => {
  const base = {
    name: "sessions/123/activities/act1",
    id: "act1",
    originator: "system",
    description: "Session started",
    createTime: "2024-01-15T10:30:00Z",
  }

  test("accepts base activity", () => {
    expect(schemas.Activity.safeParse(base).success).toBe(true)
  })

  test("accepts activity with plan generated", () => {
    const result = schemas.Activity.safeParse({
      ...base,
      planGenerated: {
        plan: {
          id: "plan1",
          steps: [{ id: "s1", index: 0, title: "Analyze", description: "Review code" }],
          createTime: "2024-01-15T10:31:00Z",
        },
      },
    })
    expect(result.success).toBe(true)
  })

  test("accepts activity with artifacts", () => {
    const result = schemas.Activity.safeParse({
      ...base,
      artifacts: [
        {
          changeSet: {
            source: "sources/github-org-repo",
            gitPatch: {
              baseCommitId: "abc123",
              unidiffPatch: "diff --git...",
              suggestedCommitMessage: "Fix tests",
            },
          },
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe("Source", () => {
  test("accepts valid source", () => {
    const result = schemas.Source.safeParse({
      name: "sources/github-org-repo",
      id: "github-org-repo",
      githubRepo: {
        owner: "org",
        repo: "repo",
        isPrivate: false,
        defaultBranch: { displayName: "main" },
        branches: [{ displayName: "main" }, { displayName: "dev" }],
      },
    })
    expect(result.success).toBe(true)
  })

  test("rejects source without githubRepo", () => {
    const result = schemas.Source.safeParse({
      name: "sources/github-org-repo",
      id: "github-org-repo",
    })
    expect(result.success).toBe(false)
  })
})

describe("ListResponses", () => {
  test("accepts list sessions response", () => {
    const result = schemas.ListSessionsResponse.safeParse({
      sessions: [
        {
          name: "sessions/1",
          id: "1",
          prompt: "task",
          state: "COMPLETED",
          createTime: "2024-01-15T10:30:00Z",
          updateTime: "2024-01-15T10:30:00Z",
        },
      ],
      nextPageToken: "abc",
    })
    expect(result.success).toBe(true)
  })

  test("accepts list activities response", () => {
    const result = schemas.ListActivitiesResponse.safeParse({
      activities: [
        {
          name: "sessions/1/activities/1",
          id: "1",
          originator: "system",
          description: "Started",
          createTime: "2024-01-15T10:30:00Z",
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  test("accepts list sources response", () => {
    const result = schemas.ListSourcesResponse.safeParse({
      sources: [
        {
          name: "sources/github-org-repo",
          id: "github-org-repo",
          githubRepo: {
            owner: "org",
            repo: "repo",
            isPrivate: false,
            defaultBranch: { displayName: "main" },
            branches: [{ displayName: "main" }],
          },
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe("JulesErrorResponse", () => {
  test("accepts error response", () => {
    const result = schemas.JulesErrorResponse.safeParse({
      error: {
        code: 400,
        message: "Invalid session ID",
        status: "INVALID_ARGUMENT",
      },
    })
    expect(result.success).toBe(true)
  })
})
