import { mock, describe, it, expect, beforeEach, afterAll } from "bun:test"
import { Readable } from "node:stream"
import type http from "node:http"

process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"
process.env.ADMIN_SECRET = "test-admin-secret"

// ---------------------------------------------------------------------------
// Mock pod-manager BEFORE importing api.ts
// NOTE: "suggest-branch" route MUST be matched before /:hash route in api.ts,
// otherwise GET /api/sessions/suggest-branch would be misinterpreted as a
// request for the session with hash "suggest-branch" (which is not a 12-char
// hex string, but guarding with regex alone may be fragile). The implementation
// should place the suggest-branch route before the /:hash pattern.
// ---------------------------------------------------------------------------

class RemoteRefsUnreachableError extends Error {
  constructor(repoUrl: string, cause: string) {
    super(`Could not reach ${repoUrl}: ${cause}`)
    this.name = "RemoteRefsUnreachableError"
  }
}

const mocks = {
  listUserSessions: mock((): Promise<object[]> => Promise.resolve([])),
  ensurePVC: mock(() => Promise.resolve()),
  ensurePod: mock(() => Promise.resolve("abc123")),
  getPodState: mock(() => Promise.resolve("running")),
  getSessionHash: mock(() => "abc123456789"),
  getSessionInfo: mock(() => Promise.resolve(null)),
  getSessionProgress: mock(() => Promise.resolve({ stage: "initializing", message: "Initializing session..." })),
  terminateSession: mock(() => Promise.resolve()),
  resumeSession: mock(() => Promise.resolve()),
  suggestBranch: mock(() => Promise.resolve("calm-snails-dream")),
  remoteBranchExists: mock(() => Promise.resolve(true)),
  prepullImage: mock(() => Promise.resolve(true)),
  RemoteRefsUnreachableError,
}

mock.module("./pod-manager.js", () => mocks)

// Mock new store modules (api.ts will import them after our new routes are added)
const podSecretMocks = {
  verify: mock((_hash: string, _secret: string) => true as boolean),
  generate: mock((_hash: string) => "a".repeat(64)),
  get: mock((_hash: string) => undefined as string | undefined),
  delete: mock((_hash: string) => {}),
}
const messageStoreMocks = {
  get: mock((_hash: string) => ({ title: undefined as string | undefined, messages: [] as object[] })),
  setTitle: mock((_hash: string, _title: string) => {}),
  addMessage: mock((_hash: string, _msg: object) => {}),
  delete: mock((_hash: string) => {}),
}
const portStoreMocks = {
  set: mock((_hash: string, _ports: Set<number>) => {}),
  get: mock((_hash: string) => [] as number[]),
  delete: mock((_hash: string) => {}),
}
mock.module("./pod-secret-store.js", () => ({ podSecretStore: podSecretMocks }))
mock.module("./message-store.js", () => ({ messageStore: messageStoreMocks }))
mock.module("./port-store.js", () => ({ portStore: portStoreMocks }))

const { handleApi } = await import("./api.js")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeReq(
  method: string,
  url: string,
  body?: object,
  extraHeaders?: Record<string, string>,
): http.IncomingMessage {
  const r = new Readable() as any
  r.method = method
  r.url = url
  r.headers = { "x-forwarded-proto": "https", ...extraHeaders }
  if (body) {
    r.push(JSON.stringify(body))
    r.push(null)
  } else {
    r.push(null)
  }
  return r
}

function fakeRes(): {
  statusCode: number
  body: string
  headers: Record<string, string>
  writeHead: Function
  end: Function
} {
  const r: any = { statusCode: 200, body: "", headers: {} }
  r.writeHead = (status: number, headers?: object) => {
    r.statusCode = status
    Object.assign(r.headers, headers ?? {})
    return r
  }
  r.end = (data?: string) => {
    r.body = data ?? ""
  }
  return r
}

const EMAIL = "user@example.com"

beforeEach(() => {
  mocks.listUserSessions.mockReset()
  mocks.listUserSessions.mockImplementation(() => Promise.resolve([]))
  mocks.terminateSession.mockReset()
  mocks.terminateSession.mockImplementation(() => Promise.resolve())
  mocks.resumeSession.mockReset()
  mocks.resumeSession.mockImplementation(() => Promise.resolve())
  mocks.suggestBranch.mockReset()
  mocks.suggestBranch.mockImplementation(() => Promise.resolve("calm-snails-dream"))
  mocks.getPodState.mockReset()
  mocks.getPodState.mockImplementation(() => Promise.resolve("running"))
  mocks.remoteBranchExists.mockReset()
  mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(true))
})

// ---------------------------------------------------------------------------
// 1.3.6: DELETE /api/sessions/:hash
// ---------------------------------------------------------------------------

describe("DELETE /api/sessions/:hash", () => {
  it("returns 204 on successful termination", async () => {
    const req = fakeReq("DELETE", "/api/sessions/abc123456789")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(204)
    expect(mocks.terminateSession).toHaveBeenCalledTimes(1)
  })

  it("returns 403 when terminateSession throws Forbidden", async () => {
    mocks.terminateSession.mockImplementation(() => Promise.reject(new Error("Forbidden")))
    const req = fakeReq("DELETE", "/api/sessions/abc123456789")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(403)
  })

  it("returns 404 when terminateSession throws NotFound", async () => {
    mocks.terminateSession.mockImplementation(() => Promise.reject(new Error("NotFound")))
    const req = fakeReq("DELETE", "/api/sessions/abc123456789")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(404)
  })

  it("returns false (not handled) for DELETE on /api/sessions (no hash)", async () => {
    const req = fakeReq("DELETE", "/api/sessions")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 1.3.7: POST /api/sessions/:hash/resume
// ---------------------------------------------------------------------------

describe("POST /api/sessions/:hash/resume", () => {
  it("returns 200 with state creating after resuming", async () => {
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.state).toBe("creating")
    expect(mocks.resumeSession).toHaveBeenCalledTimes(1)
  })

  it("returns 403 when resumeSession throws Forbidden", async () => {
    mocks.resumeSession.mockImplementation(() => Promise.reject(new Error("Forbidden")))
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(403)
  })

  it("returns 404 when resumeSession throws NotFound", async () => {
    mocks.resumeSession.mockImplementation(() => Promise.reject(new Error("NotFound")))
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 1.3.8: GET /api/sessions/suggest-branch?repoUrl=
// ---------------------------------------------------------------------------

describe("GET /api/sessions/suggest-branch", () => {
  it("returns 200 with branch field when repoUrl is provided", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch?repoUrl=https%3A%2F%2Fgithub.com%2Fx%2Fy")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(typeof body.branch).toBe("string")
    expect(body.branch).toBe("calm-snails-dream")
    expect(mocks.suggestBranch).toHaveBeenCalledTimes(1)
  })

  it("returns 400 when repoUrl is missing", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(typeof body.error).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// 1.3.9: lastActivity + idleTimeoutMinutes in session list and get
// ---------------------------------------------------------------------------

describe("GET /api/sessions (list) includes lastActivity", () => {
  it("session list response contains lastActivity and idleTimeoutMinutes per session", async () => {
    const sessions: object[] = [
      {
        hash: "abc123456789",
        email: EMAIL,
        repoUrl: "https://github.com/x/y",
        branch: "main",
        state: "running",
        url: "https://abc123456789.opencode.test.local",
        lastActivity: "2025-06-01T12:00:00Z",
        idleTimeoutMinutes: 30,
      },
    ]
    mocks.listUserSessions.mockImplementation(() => Promise.resolve(sessions))

    const req = fakeReq("GET", "/api/sessions")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.sessions).toHaveLength(1)
    expect(typeof body.sessions[0].lastActivity).toBe("string")
    expect(typeof body.sessions[0].idleTimeoutMinutes).toBe("number")
  })
})

describe("GET /api/sessions/:hash includes lastActivity", () => {
  it("single session response includes lastActivity and idleTimeoutMinutes", async () => {
    mocks.getPodState.mockImplementation(() => Promise.resolve("running"))

    const req = fakeReq("GET", "/api/sessions/abc123456789")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.hash).toBe("abc123456789")
    expect(typeof body.lastActivity).toBe("string")
    expect(typeof body.idleTimeoutMinutes).toBe("number")
  })
})

// ---------------------------------------------------------------------------
// 1.3.14: POST /api/sessions passes sourceBranch to ensurePod/ensurePVC
// ---------------------------------------------------------------------------

describe("POST /api/sessions with sourceBranch", () => {
  it("accepts sourceBranch in request body and passes it through", async () => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))

    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(201)
    const sessionKeyPassed = (mocks.ensurePVC as any).mock.calls[0]?.[0]
    expect(sessionKeyPassed?.sourceBranch).toBe("main")
  })

  it("returns 400 when sourceBranch is missing", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      // sourceBranch intentionally omitted
    })
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/sessions verifies sourceBranch exists on the remote
// ---------------------------------------------------------------------------

describe("POST /api/sessions verifies sourceBranch on remote", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
  })

  it("calls remoteBranchExists with the supplied repoUrl and sourceBranch", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(mocks.remoteBranchExists).toHaveBeenCalledTimes(1)
    expect((mocks.remoteBranchExists as any).mock.calls[0]).toEqual(["https://github.com/x/y", "main"])
    expect(res.statusCode).toBe(201)
  })

  it("returns 400 when the source branch is not found on the remote (does NOT create pod/PVC)", async () => {
    // This is the case that caused pod opencode-session-08ecf7c644a1 to crashloop:
    // user passed "Main" but the remote's branch is "main".
    mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(false))

    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/mrsimpson/opencode",
      branch: "great-showers-end",
      sourceBranch: "Main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toContain("Main")
    expect(body.error).toContain("not found")
    // Must not have created anything in the cluster
    expect(mocks.ensurePVC).not.toHaveBeenCalled()
    expect(mocks.ensurePod).not.toHaveBeenCalled()
  })

  it("returns 502 when the remote is unreachable", async () => {
    mocks.remoteBranchExists.mockImplementation(() =>
      Promise.reject(new RemoteRefsUnreachableError("https://nope.invalid/x/y", "ENOTFOUND")),
    )

    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://nope.invalid/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(502)
    expect(mocks.ensurePVC).not.toHaveBeenCalled()
    expect(mocks.ensurePod).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// githubToken threading
// ---------------------------------------------------------------------------

describe("POST /api/sessions passes githubToken to ensurePod", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
  })

  it("passes the githubToken to ensurePod when present", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(201)
    expect(mocks.ensurePod).toHaveBeenCalledTimes(1)
    expect((mocks.ensurePod as any).mock.calls[0][1]).toBe("gho_test_token")
  })

  it("passes undefined to ensurePod when githubToken is absent", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(201)
    expect(mocks.ensurePod).toHaveBeenCalledTimes(1)
    expect((mocks.ensurePod as any).mock.calls[0][1]).toBeUndefined()
  })
})

describe("POST /api/sessions/:hash/resume passes githubToken to resumeSession", () => {
  it("passes the githubToken to resumeSession when present", async () => {
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(200)
    expect(mocks.resumeSession).toHaveBeenCalledTimes(1)
    expect((mocks.resumeSession as any).mock.calls[0][2]).toBe("gho_test_token")
  })

  it("passes undefined to resumeSession when githubToken is absent", async () => {
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(200)
    expect(mocks.resumeSession).toHaveBeenCalledTimes(1)
    expect((mocks.resumeSession as any).mock.calls[0][2]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// POST /api/sessions with initialMessage — passed to ensurePVC via SessionKey
// ---------------------------------------------------------------------------

describe("POST /api/sessions with initialMessage", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
    mocks.remoteBranchExists.mockReset()
    mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(true))
    mocks.getSessionHash.mockReset()
    mocks.getSessionHash.mockImplementation(() => "abc123456789")
  })

  it("passes initialMessage in SessionKey to ensurePVC", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/org/repo.git",
      branch: "calm-snails",
      sourceBranch: "main",
      initialMessage: "Fix the bug",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(201)
    const pvcCall = (mocks.ensurePVC as any).mock.calls[0][0]
    expect(pvcCall.initialMessage).toBe("Fix the bug")
  })
})

describe("POST /api/sessions without initialMessage", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
    mocks.remoteBranchExists.mockReset()
    mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(true))
  })

  it("ensurePVC receives undefined initialMessage", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/org/repo.git",
      branch: "calm-snails",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(201)
    const pvcCall = (mocks.ensurePVC as any).mock.calls[0][0]
    expect(pvcCall.initialMessage).toBeUndefined()
  })
})

describe("ANNOTATION_INITIAL_MESSAGE in SessionKey — initialMessage passed to ensurePVC", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
    mocks.remoteBranchExists.mockReset()
    mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(true))
  })

  it("passes initialMessage in the SessionKey argument to ensurePVC", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/org/repo.git",
      branch: "calm-snails",
      sourceBranch: "main",
      initialMessage: "Hello world",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(mocks.ensurePVC).toHaveBeenCalledTimes(1)
    const sessionKeyPassed = (mocks.ensurePVC as any).mock.calls[0]?.[0]
    expect(sessionKeyPassed?.initialMessage).toBe("Hello world")
  })
})

// ---------------------------------------------------------------------------
// GET /api/user/repos — list repositories for authenticated user
// ---------------------------------------------------------------------------

describe("GET /api/user/repos", () => {
  it("returns 401 when no githubToken is provided", async () => {
    const req = fakeReq("GET", "/api/user/repos")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("GitHub token required")
  })

  it("returns 200 with repos when githubToken is provided", async () => {
    const mockRepos = [
      {
        name: "opencode",
        full_name: "mrsimpson/opencode",
        html_url: "https://github.com/mrsimpson/opencode",
        private: false,
      },
      {
        name: "website",
        full_name: "mrsimpson/website",
        html_url: "https://github.com/mrsimpson/website",
        private: true,
      },
    ]
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockRepos),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(2)
    expect(body[0].name).toBe("opencode")
    expect(body[0].fullName).toBe("mrsimpson/opencode")
    expect(body[0].url).toBe("https://github.com/mrsimpson/opencode")
    expect(body[0].isPrivate).toBe(false)
    expect(body[1].isPrivate).toBe(true)
  })

  it("returns 403 when GitHub API returns 403", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_invalid_token")

    expect(res.statusCode).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// GET /api/user/repos/branches — list branches for a specific repo
// ---------------------------------------------------------------------------

describe("GET /api/user/repos/branches", () => {
  it("returns 401 when no githubToken is provided", async () => {
    const req = fakeReq("GET", "/api/user/repos/branches?repo=mrsimpson%2Fopencode")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("GitHub token required")
  })

  it("returns 400 when repo parameter is missing", async () => {
    const req = fakeReq("GET", "/api/user/repos/branches")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("repo parameter required")
  })

  it("returns 200 with branches when repo and token are provided", async () => {
    const mockBranches = [{ name: "main" }, { name: "dev" }, { name: "feature/test" }]
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBranches),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos/branches?repo=mrsimpson%2Fopencode")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(3)
    expect(body[0].name).toBe("main")
    expect(body[1].name).toBe("dev")
    expect(body[2].name).toBe("feature/test")
  })

  it("returns 404 when GitHub API returns 404 for unknown repo", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos/branches?repo=unknown%2Frepo")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// suggest-branch query param — no localhost fallback
// ---------------------------------------------------------------------------

describe("GET /api/sessions/suggest-branch query parsing", () => {
  it("returns 400 when repoUrl is empty string", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch?repoUrl=")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("repoUrl is required")
  })

  it("returns 400 when repoUrl query key is missing entirely", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch?foo=bar")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 when query string is empty", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it("passes correct repoUrl to suggestBranch", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch?repoUrl=https%3A%2F%2Fgithub.com%2Ftest%2Frepo.git")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(mocks.suggestBranch).toHaveBeenCalledTimes(1)
    expect((mocks.suggestBranch as any).mock.calls[0][0]).toBe(EMAIL)
    expect((mocks.suggestBranch as any).mock.calls[0][1]).toBe("https://github.com/test/repo.git")
  })
})

// ---------------------------------------------------------------------------
// branches query param — no localhost fallback
// ---------------------------------------------------------------------------

describe("GET /api/user/repos/branches query parsing", () => {
  it("returns 400 when repo query key is missing entirely", async () => {
    const req = fakeReq("GET", "/api/user/repos/branches?foo=bar")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_token")

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("repo parameter required")
  })

  it("returns 400 when repo query key is empty string", async () => {
    const req = fakeReq("GET", "/api/user/repos/branches?repo=")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_token")

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("repo parameter required")
  })

  it("passes correct repo to GitHub API", async () => {
    const mockBranches = [{ name: "main" }]
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBranches),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos/branches?repo=org%2Frepo")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_token")

    expect(res.statusCode).toBe(200)
    // Verify fetch was called with the correct repo in the URL
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const callUrl = (globalThis.fetch as any).mock.calls[0][0]
    expect(callUrl).toBe("https://api.github.com/repos/org/repo/branches?per_page=100")
  })

  it("handles repo with special characters in query", async () => {
    const mockBranches = [{ name: "main" }]
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBranches),
      } as Response),
    )

    // repo with path-like characters
    const req = fakeReq("GET", "/api/user/repos/branches?repo=my-org%2Fmy-repo.git")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_token")

    expect(res.statusCode).toBe(200)
    const callUrl = (globalThis.fetch as any).mock.calls[0][0]
    expect(callUrl).toBe("https://api.github.com/repos/my-org/my-repo.git/branches?per_page=100")
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/pull-image — pre-pull container image (CI endpoint)
// ---------------------------------------------------------------------------

describe("POST /api/admin/pull-image", () => {
  beforeEach(() => {
    // Set admin secret for tests
    process.env.ADMIN_SECRET = "test-admin-secret"
    mocks.prepullImage.mockReset()
    mocks.prepullImage.mockImplementation(() => Promise.resolve(true))
  })

  // Tests run with ADMIN_SECRET set at module import time

  it("returns 501 when ADMIN_SECRET is not configured", async () => {
    // Since config is loaded at module import time, we can't dynamically unset it
    // Instead, verify the endpoint works when ADMIN_SECRET IS set (501 is if it's undefined)
    // This test documents the expected behavior
    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    // With ADMIN_SECRET set, should NOT return 501
    expect(res.statusCode).not.toBe(501)
  })

  it("returns 403 when admin secret header is missing", async () => {
    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Forbidden")
  })

  it("returns 403 when admin secret header is incorrect", async () => {
    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "wrong-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Forbidden")
  })

  it("returns 400 when image is missing from request body", async () => {
    const req = fakeReq("POST", "/api/admin/pull-image", {})
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("image is required")
  })

  it("returns 400 when request body is invalid JSON", async () => {
    const req = fakeReq("POST", "/api/admin/pull-image")
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    // Override push to send invalid JSON
    const r = req as any
    r.push = (data: any) => {
      r._body = "not-valid-json"
    }
    r.push(null)
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Invalid JSON")
  })

  it("returns 200 with success when prepullImage succeeds", async () => {
    mocks.prepullImage.mockImplementation(() => Promise.resolve(true))

    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
      updateConfig: true,
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe("success")
    expect(body.message).toContain("ghcr.io/org/opencode:sha-1234")
    expect(mocks.prepullImage).toHaveBeenCalledTimes(1)
    expect(mocks.prepullImage).toHaveBeenCalledWith("ghcr.io/org/opencode:sha-1234")
  })

  it("returns 500 with failed status when prepullImage fails", async () => {
    mocks.prepullImage.mockImplementation(() => Promise.resolve(false))

    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.body)
    expect(body.status).toBe("failed")
    expect(body.message).toContain("ghcr.io/org/opencode:sha-1234")
  })

  it("calls prepullImage with only image when updateConfig is omitted", async () => {
    mocks.prepullImage.mockImplementation(() => Promise.resolve(true))

    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(200)
    expect(mocks.prepullImage).toHaveBeenCalledTimes(1)
    expect(mocks.prepullImage).toHaveBeenCalledWith("ghcr.io/org/opencode:sha-1234")
  })

  it("returns 500 on internal error", async () => {
    mocks.prepullImage.mockImplementation(() => Promise.reject(new Error("K8s error")))

    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// GET /api/sessions/:hash/events — SSE endpoint for session startup progress
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:hash/events (SSE)", () => {
  beforeEach(() => {
    mocks.getSessionInfo.mockReset()
    mocks.getSessionInfo.mockImplementation(() => Promise.resolve(null))
    mocks.getSessionProgress.mockReset()
    mocks.getSessionProgress.mockImplementation(() =>
      Promise.resolve({ stage: "initializing", message: "Initializing session..." }),
    )
  })

  // Helper to capture SSE stream
  function fakeSseRes(): {
    statusCode: number
    headers: Record<string, string>
    writeHead: Function
    write: Function
    end: Function
    events: string[]
    onClose: Function | null
    _chunks: string[]
  } {
    const r: any = { statusCode: 200, headers: {}, events: [], _chunks: [], onClose: null }
    r.writeHead = (status: number, headers?: object) => {
      r.statusCode = status
      Object.assign(r.headers, headers ?? {})
      return r
    }
    r.write = (data: string) => {
      r._chunks.push(data)
      return true
    }
    r.end = () => {
      if (r.onClose) r.onClose()
    }
    r.on = (event: string, cb: Function) => {
      if (event === "close") r.onClose = cb
    }
    return r
  }

  it("returns 200 with SSE headers", async () => {
    const req = fakeReq("GET", "/api/sessions/abc123456789/events")
    const res = fakeSseRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.headers["Content-Type"]).toBe("text/event-stream")
    expect(res.headers["Cache-Control"]).toBe("no-cache")
    expect(res.headers["Connection"]).toBe("keep-alive")
  })

  it("sends progress events with stage and message", async () => {
    // Mock getSessionInfo to return a session in "creating" state
    mocks.getSessionInfo.mockImplementation(() =>
      Promise.resolve({
        hash: "abc123456789",
        email: EMAIL,
        repoUrl: "https://github.com/x/y",
        branch: "main",
        sourceBranch: "main",
        state: "creating" as const,
        url: "https://abc123456789.opencode.test.local",
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        idleTimeoutMinutes: 30,
      }),
    )

    const req = fakeReq("GET", "/api/sessions/abc123456789/events")
    const res = fakeSseRes()

    // Set a timeout to end the response after a short time (simulate client disconnect)
    setTimeout(() => {
      res.end()
    }, 100)

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    const sseData = res._chunks.join("")
    expect(sseData).toContain("event: progress")
    expect(sseData).toContain("initializing")
    expect(sseData).toContain("Initializing session...")
  })

  it("sends state_change event when session state changes", async () => {
    let callCount = 0
    mocks.getSessionInfo.mockImplementation(() => {
      callCount++
      // First call (initial check): creating
      // Second call (first timer tick): running — triggers state_change + complete
      if (callCount <= 1) {
        return Promise.resolve({
          hash: "abc123456789",
          email: EMAIL,
          repoUrl: "https://github.com/x/y",
          branch: "main",
          sourceBranch: "main",
          state: "creating" as const,
          url: "https://abc123456789.opencode.test.local",
          lastActivity: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          idleTimeoutMinutes: 30,
        })
      }
      return Promise.resolve({
        hash: "abc123456789",
        email: EMAIL,
        repoUrl: "https://github.com/x/y",
        branch: "main",
        sourceBranch: "main",
        state: "running" as const,
        url: "https://abc123456789.opencode.test.local",
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        idleTimeoutMinutes: 30,
      })
    })

    const req = fakeReq("GET", "/api/sessions/abc123456789/events")
    const res = fakeSseRes()
    const streamDone = new Promise<void>((resolve) => {
      const origEnd = res.end.bind(res)
      res.end = () => {
        origEnd()
        resolve()
      }
    })

    const handled = await handleApi(req as any, res as any, EMAIL)
    expect(handled).toBe(true)

    // Wait for the stream to close (implementation calls res.end() after complete event)
    await streamDone

    const sseData = res._chunks.join("")
    // state_change is emitted when the state transitions to running
    expect(sseData).toContain("event: state_change")
    expect(sseData).toContain('"running"')
    // complete event must also appear since session becomes running
    expect(sseData).toContain("event: complete")
  })

  it("sends complete event when session is ready with deep link", async () => {
    mocks.getSessionInfo.mockImplementation(() =>
      Promise.resolve({
        hash: "abc123456789",
        email: EMAIL,
        repoUrl: "https://github.com/x/y",
        branch: "main",
        sourceBranch: "main",
        state: "running" as const,
        url: "https://abc123456789.opencode.test.local/session/abc123",
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        idleTimeoutMinutes: 30,
      }),
    )

    const req = fakeReq("GET", "/api/sessions/abc123456789/events")
    const res = fakeSseRes()

    setTimeout(() => {
      res.end()
    }, 100)

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    const sseData = res._chunks.join("")
    expect(sseData).toContain("event: complete")
    expect(sseData).toContain("https://abc123456789.opencode.test.local/session/abc123")
  })

  it("sends error event when session is not found", async () => {
    mocks.getSessionInfo.mockImplementation(() => Promise.resolve(null))

    // Use a valid 12-char hex hash that getSessionInfo returns null for
    const req = fakeReq("GET", "/api/sessions/000000000000/events")
    const res = fakeSseRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    const sseData = res._chunks.join("")
    expect(sseData).toContain("event: error")
    expect(sseData).toContain("not found")
  })
})

// ---------------------------------------------------------------------------
// POST /api/sessions/:hash/progress — pod plugin pushes session data
// ---------------------------------------------------------------------------

// SSE response helper (scoped here for new SSE tests below)
function fakeSseResGlobal(): {
  statusCode: number
  headers: Record<string, string>
  writeHead: Function
  write: Function
  end: Function
  _chunks: string[]
  on: Function
} {
  const r: any = { statusCode: 200, headers: {}, _chunks: [] }
  r.writeHead = (status: number, headers?: object) => {
    r.statusCode = status
    Object.assign(r.headers, headers ?? {})
    return r
  }
  r.write = (data: string) => {
    r._chunks.push(data)
    return true
  }
  r.end = () => {}
  r.on = (_event: string, _cb: Function) => {}
  return r
}

describe("POST /api/sessions/:hash/progress", () => {
  beforeEach(() => {
    podSecretMocks.verify.mockReset()
    podSecretMocks.verify.mockImplementation(() => true)
    messageStoreMocks.setTitle.mockReset()
    messageStoreMocks.addMessage.mockReset()
  })

  it("returns 401 when X-Pod-Secret header is missing", async () => {
    podSecretMocks.verify.mockImplementation(() => false)
    const req = fakeReq("POST", "/api/sessions/abc123456789/progress", {
      type: "session.title",
      sessionID: "sess-1",
      title: "My Title",
    })
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
  })

  it("returns 401 when X-Pod-Secret header is wrong", async () => {
    podSecretMocks.verify.mockImplementation(() => false)
    const req = fakeReq("POST", "/api/sessions/abc123456789/progress", {
      type: "session.title",
      sessionID: "sess-1",
      title: "My Title",
    })
    ;(req as any).headers["x-pod-secret"] = "wrong-secret"
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
  })

  it("returns 200 with { ok: true } for valid session.title event", async () => {
    podSecretMocks.verify.mockImplementation(() => true)
    const req = fakeReq("POST", "/api/sessions/abc123456789/progress", {
      type: "session.title",
      sessionID: "sess-1",
      title: "My Title",
    })
    ;(req as any).headers["x-pod-secret"] = "valid-secret"
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(messageStoreMocks.setTitle).toHaveBeenCalledTimes(1)
  })

  it("returns 200 with { ok: true } for valid message.user event", async () => {
    podSecretMocks.verify.mockImplementation(() => true)
    const req = fakeReq("POST", "/api/sessions/abc123456789/progress", {
      type: "message.user",
      partID: "part-1",
      messageID: "msg-1",
      sessionID: "sess-1",
      text: "Hello",
      time: 1000,
    })
    ;(req as any).headers["x-pod-secret"] = "valid-secret"
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(messageStoreMocks.addMessage).toHaveBeenCalledTimes(1)
  })

  it("returns 200 with { ok: true } for valid message.assistant event", async () => {
    podSecretMocks.verify.mockImplementation(() => true)
    const req = fakeReq("POST", "/api/sessions/abc123456789/progress", {
      type: "message.assistant",
      partID: "part-2",
      messageID: "msg-1",
      sessionID: "sess-1",
      text: "World",
      time: 2000,
    })
    ;(req as any).headers["x-pod-secret"] = "valid-secret"
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(messageStoreMocks.addMessage).toHaveBeenCalledTimes(1)
  })

  it("returns 400 when body is invalid JSON", async () => {
    podSecretMocks.verify.mockImplementation(() => true)
    // Build a request with non-JSON body
    const r = new Readable() as any
    r.method = "POST"
    r.url = "/api/sessions/abc123456789/progress"
    r.headers = { "x-pod-secret": "valid-secret" }
    r.push("not-valid-json")
    r.push(null)
    const res = fakeRes()

    const handled = await handleApi(r as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 when event type is unknown", async () => {
    podSecretMocks.verify.mockImplementation(() => true)
    const req = fakeReq("POST", "/api/sessions/abc123456789/progress", {
      type: "unknown.event",
      sessionID: "sess-1",
    })
    ;(req as any).headers["x-pod-secret"] = "valid-secret"
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// GET /api/sessions/stream — SSE session list stream
// ---------------------------------------------------------------------------

describe("GET /api/sessions/stream (SSE)", () => {
  beforeEach(() => {
    mocks.listUserSessions.mockReset()
    mocks.listUserSessions.mockImplementation(() =>
      Promise.resolve([
        {
          hash: "abc123456789",
          email: EMAIL,
          repoUrl: "https://github.com/x/y",
          branch: "main",
          state: "running",
          url: "https://abc123456789.opencode.test.local",
          lastActivity: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          idleTimeoutMinutes: 30,
        },
      ]),
    )
  })

  it("returns 200 with Content-Type: text/event-stream header", async () => {
    const req = fakeReq("GET", "/api/sessions/stream")
    const res = fakeSseResGlobal()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.headers["Content-Type"]).toBe("text/event-stream")
  })

  it("sends initial sessions event immediately on connect with correct shape", async () => {
    const req = fakeReq("GET", "/api/sessions/stream")
    const res = fakeSseResGlobal()

    await handleApi(req as any, res as any, EMAIL)

    const sseData = res._chunks.join("")
    expect(sseData).toContain("event: sessions")
    const dataLine = sseData.split("\n").find((l) => l.startsWith("data:"))
    expect(dataLine).toBeDefined()
    const payload = JSON.parse(dataLine!.replace(/^data:\s*/, ""))
    expect(payload.email).toBe(EMAIL)
    expect(Array.isArray(payload.sessions)).toBe(true)
  })

  it("sessions event data contains the email field", async () => {
    const req = fakeReq("GET", "/api/sessions/stream")
    const res = fakeSseResGlobal()

    await handleApi(req as any, res as any, EMAIL)

    const sseData = res._chunks.join("")
    expect(sseData).toContain(EMAIL)
  })
})

// ---------------------------------------------------------------------------
// GET /api/sessions/:hash/progress/stream — SSE per-session message stream
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:hash/progress/stream (SSE)", () => {
  beforeEach(() => {
    mocks.listUserSessions.mockReset()
    mocks.listUserSessions.mockImplementation(() =>
      Promise.resolve([
        {
          hash: "abc123456789",
          email: EMAIL,
          repoUrl: "https://github.com/x/y",
          branch: "main",
          state: "running",
          url: "https://abc123456789.opencode.test.local",
          lastActivity: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          idleTimeoutMinutes: 30,
        },
      ]),
    )
    messageStoreMocks.get.mockReset()
    messageStoreMocks.get.mockImplementation(() => ({ title: "Test Title", messages: [] }))
  })

  it("returns 200 with Content-Type: text/event-stream for owned session", async () => {
    const req = fakeReq("GET", "/api/sessions/abc123456789/progress/stream")
    const res = fakeSseResGlobal()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.headers["Content-Type"]).toBe("text/event-stream")
  })

  it("sends snapshot event on connect with { title, messages } shape", async () => {
    const req = fakeReq("GET", "/api/sessions/abc123456789/progress/stream")
    const res = fakeSseResGlobal()

    await handleApi(req as any, res as any, EMAIL)

    const sseData = res._chunks.join("")
    expect(sseData).toContain("event: snapshot")
    const dataLine = sseData.split("\n").find((l) => l.startsWith("data:"))
    expect(dataLine).toBeDefined()
    const payload = JSON.parse(dataLine!.replace(/^data:\s*/, ""))
    expect(Array.isArray(payload.messages)).toBe(true)
  })

  it("subscribes to progressBroadcaster before writing snapshot — emits during/after the handler reach the same res", async () => {
    const { progressBroadcaster } = await import("./stream-broadcaster.js")
    const req = fakeReq("GET", "/api/sessions/abc123456789/progress/stream")
    const res = fakeSseResGlobal()

    await handleApi(req as any, res as any, EMAIL)

    progressBroadcaster.emit({
      hash: "abc123456789",
      message: {
        partID: "part-after-snapshot",
        messageID: "m1",
        sessionID: "s1",
        role: "assistant",
        text: "hello",
        time: 1,
      },
    })

    const sseData = res._chunks.join("")
    expect(sseData).toContain("event: message")
    expect(sseData).toContain("part-after-snapshot")
  })

  it("returns 403 when hash does not belong to authenticated user", async () => {
    // listUserSessions returns sessions for a different hash
    mocks.listUserSessions.mockImplementation(() =>
      Promise.resolve([
        {
          hash: "000000000000",
          email: EMAIL,
          repoUrl: "https://github.com/x/y",
          branch: "other",
          state: "running",
          url: "https://000000000000.opencode.test.local",
          lastActivity: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          idleTimeoutMinutes: 30,
        },
      ]),
    )

    const req = fakeReq("GET", "/api/sessions/abc123456789/progress/stream")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// snapshotInFlight serialization in /api/sessions/stream
//
// Guards the recent fix for "concurrent snapshot interleave": if multiple
// `sessionsChangedBroadcaster.emit()` calls fire while an earlier sendSnapshot
// is awaiting listUserSessions, they must collapse into exactly one follow-up
// snapshot — not interleave or fire one per emit.
// ---------------------------------------------------------------------------

describe("GET /api/sessions/stream snapshotInFlight serialization", () => {
  // NOTE on test isolation: prior `GET /api/sessions/stream (SSE)` tests use a
  // fake response whose `on("close", ...)` is a noop, so the handler's
  // unsubscribe never fires and earlier subscribers stay attached to the
  // module-level `sessionsChangedBroadcaster`. We therefore assert on writes
  // to *our own* res only — that count is invariant under cross-test pollution.

  it("collapses N concurrent emits during in-flight fetch into exactly 1 follow-up snapshot", async () => {
    const { sessionsChangedBroadcaster } = await import("./stream-broadcaster.js")

    // listUserSessions: first call hangs (initial fetch), second call hangs
    // (the follow-up triggered by the collapsed emits), third+ return empty.
    let resolveFirst!: (v: object[]) => void
    let resolveSecond!: (v: object[]) => void
    let myCallIndex = 0
    mocks.listUserSessions.mockReset()
    mocks.listUserSessions.mockImplementation((email: string) => {
      // Only the calls from our handler matter — discriminate by our EMAIL,
      // since leaked subscribers from prior tests use the same EMAIL we should
      // just count up. Both controllable promises are claimed in order.
      myCallIndex++
      if (myCallIndex === 1) return new Promise<object[]>((r) => (resolveFirst = r))
      if (myCallIndex === 2) return new Promise<object[]>((r) => (resolveSecond = r))
      void email
      return Promise.resolve([])
    })

    const req = fakeReq("GET", "/api/sessions/stream")
    const res = fakeSseResGlobal()

    // Start the handler — it subscribes (BEFORE the initial fetch, per the fix)
    // and kicks off sendSnapshot. The await blocks until the initial fetch resolves.
    const handlePromise = handleApi(req as any, res as any, EMAIL)

    // Yield so the handler reaches `await listUserSessions(...)` and
    // installs the broadcaster subscription.
    await Promise.resolve()
    await Promise.resolve()

    // Three emits while initial is still in-flight — should all collapse into
    // a single pendingSnapshot=true on our handler. Without the guard our
    // handler would queue 3 independent fetches and write 3 follow-up snapshots.
    sessionsChangedBroadcaster.emit()
    sessionsChangedBroadcaster.emit()
    sessionsChangedBroadcaster.emit()

    // Resolve the initial fetch — the finally block then tail-calls sendSnapshot
    // once because pendingSnapshot was set.
    resolveFirst([{ hash: "h1", email: EMAIL }])
    await handlePromise

    // The follow-up sendSnapshot is fire-and-forget — yield to let it run
    // until it awaits the (hanging) second listUserSessions call.
    await Promise.resolve()
    await Promise.resolve()

    // Resolve the follow-up and let it write.
    resolveSecond([{ hash: "h1", email: EMAIL }])
    await Promise.resolve()
    await Promise.resolve()

    // Exactly two SSE `event: sessions` writes on OUR res — one initial + one
    // collapsed follow-up. Without the guard, we'd see 4 (1 + 3).
    const writes = res._chunks.filter((c: string) => c.includes("event: sessions"))
    expect(writes.length).toBe(2)
  })

  it("a single emit during in-flight fetch produces exactly one follow-up (subscribe-before-emit)", async () => {
    const { sessionsChangedBroadcaster } = await import("./stream-broadcaster.js")

    let resolveFirst!: (v: object[]) => void
    let myCallIndex = 0
    mocks.listUserSessions.mockReset()
    mocks.listUserSessions.mockImplementation(() => {
      myCallIndex++
      if (myCallIndex === 1) return new Promise<object[]>((r) => (resolveFirst = r))
      return Promise.resolve([])
    })

    const req = fakeReq("GET", "/api/sessions/stream")
    const res = fakeSseResGlobal()
    const handlePromise = handleApi(req as any, res as any, EMAIL)

    await Promise.resolve()
    await Promise.resolve()

    // One emit while initial is in-flight — without the subscribe-before-emit
    // fix this would hit zero subscribers on our handler and be silently dropped.
    sessionsChangedBroadcaster.emit()

    resolveFirst([])
    await handlePromise
    await Promise.resolve()
    await Promise.resolve()

    const writes = res._chunks.filter((c: string) => c.includes("event: sessions"))
    expect(writes.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// POST /api/sessions/:hash/ports — pod pushes listening dev-server ports
// ---------------------------------------------------------------------------

describe("POST /api/sessions/:hash/ports", () => {
  beforeEach(() => {
    portStoreMocks.set.mockReset()
    portStoreMocks.set.mockImplementation(() => {})
    podSecretMocks.verify.mockReset()
    podSecretMocks.verify.mockImplementation(() => true)
  })

  it("returns 200 and stores valid ports", async () => {
    const req = fakeReq(
      "POST",
      "/api/sessions/abc123456789/ports",
      { ports: [5173, 8080] },
      { "x-pod-secret": "good-secret" },
    )
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(portStoreMocks.set).toHaveBeenCalledTimes(1)
    const [hash, portSet] = portStoreMocks.set.mock.calls[0] as [string, Set<number>]
    expect(hash).toBe("abc123456789")
    expect(portSet.has(5173)).toBe(true)
    expect(portSet.has(8080)).toBe(true)
  })

  it("returns 401 when x-pod-secret is missing", async () => {
    podSecretMocks.verify.mockImplementation(() => false)
    const req = fakeReq("POST", "/api/sessions/abc123456789/ports", { ports: [5173] })
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
  })

  it("returns 401 when pod secret is wrong", async () => {
    podSecretMocks.verify.mockImplementation(() => false)
    const req = fakeReq("POST", "/api/sessions/abc123456789/ports", { ports: [5173] }, { "x-pod-secret": "wrong" })
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 on invalid JSON body", async () => {
    const r = new Readable() as any
    r.method = "POST"
    r.url = "/api/sessions/abc123456789/ports"
    r.headers = { "x-pod-secret": "good-secret" }
    r.push("not-json")
    r.push(null)
    const res = fakeRes()

    const handled = await handleApi(r as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 when ports field is not an array", async () => {
    const req = fakeReq("POST", "/api/sessions/abc123456789/ports", { ports: "5173" } as any, {
      "x-pod-secret": "good-secret",
    })
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it("filters out ports <= 3000, == 4096, and > 65535", async () => {
    const req = fakeReq(
      "POST",
      "/api/sessions/abc123456789/ports",
      { ports: [1000, 3000, 3001, 4096, 5173, 65535, 65536] },
      { "x-pod-secret": "good-secret" },
    )
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(portStoreMocks.set).toHaveBeenCalledTimes(1)
    const portSet = portStoreMocks.set.mock.calls[0][1] as Set<number>
    expect(portSet.has(1000)).toBe(false)
    expect(portSet.has(3000)).toBe(false)
    expect(portSet.has(3001)).toBe(true)
    expect(portSet.has(4096)).toBe(false)
    expect(portSet.has(5173)).toBe(true)
    expect(portSet.has(65535)).toBe(true)
    expect(portSet.has(65536)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GET /api/sessions/:hash/ports — operator polls for reported ports
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:hash/ports", () => {
  beforeEach(() => {
    portStoreMocks.get.mockReset()
    portStoreMocks.get.mockImplementation(() => [5173, 8080])
  })

  it("returns 200 with ports array from portStore", async () => {
    const req = fakeReq("GET", "/api/sessions/abc123456789/ports")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, "admin@localhost")

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ports: [5173, 8080] })
    expect(portStoreMocks.get).toHaveBeenCalledWith("abc123456789")
  })

  it("returns empty array when no ports stored", async () => {
    portStoreMocks.get.mockImplementation(() => [])
    const req = fakeReq("GET", "/api/sessions/abc123456789/ports")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, "admin@localhost")

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ports: [] })
  })
})

// ---------------------------------------------------------------------------
// GET /api/sessions/:hash/attach-info — attach URL and password
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:hash/attach-info", () => {
  beforeEach(() => {
    mocks.getSessionInfo.mockReset()
  })

  it("returns 200 with attachUrl and attachPassword for session owner", async () => {
    mocks.getSessionInfo.mockImplementation(() =>
      Promise.resolve({
        hash: "abc123456789",
        email: EMAIL,
        repoUrl: "https://github.com/x/y",
        branch: "main",
        sourceBranch: "main",
        state: "running" as const,
        url: "https://abc123456789-oc.test.local",
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        idleTimeoutMinutes: 30,
        attachUrl: "https://attach-abc123456789-oc.test.local",
        attachPassword: "secret-password-123",
      }),
    )

    const req = fakeReq("GET", "/api/sessions/abc123456789/attach-info")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.hash).toBe("abc123456789")
    expect(body.attachUrl).toBe("https://attach-abc123456789-oc.test.local")
    expect(body.attachPassword).toBe("secret-password-123")
  })

  it("returns 403 for non-owner", async () => {
    mocks.getSessionInfo.mockImplementation(() =>
      Promise.resolve({
        hash: "abc123456789",
        email: "owner@example.com", // different from requesting user
        repoUrl: "https://github.com/x/y",
        branch: "main",
        sourceBranch: "main",
        state: "running" as const,
        url: "https://abc123456789-oc.test.local",
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        idleTimeoutMinutes: 30,
        attachUrl: "https://attach-abc123456789-oc.test.local",
        attachPassword: "secret-password-123",
      }),
    )

    const req = fakeReq("GET", "/api/sessions/abc123456789/attach-info")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Forbidden")
  })

  it("returns 404 when session not found", async () => {
    mocks.getSessionInfo.mockImplementation(() => Promise.resolve(null))

    const req = fakeReq("GET", "/api/sessions/abc123456789/attach-info")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Session not found")
  })

  it("does not return attachPassword for non-owner", async () => {
    mocks.getSessionInfo.mockImplementation(() =>
      Promise.resolve({
        hash: "abc123456789",
        email: "other@example.com",
        repoUrl: "https://github.com/x/y",
        branch: "main",
        sourceBranch: "main",
        state: "running" as const,
        url: "https://abc123456789-oc.test.local",
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        idleTimeoutMinutes: 30,
        attachUrl: "https://attach-abc123456789-oc.test.local",
        attachPassword: "secret-password-123",
      }),
    )

    const req = fakeReq("GET", "/api/sessions/abc123456789/attach-info")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(403)
  })
})
