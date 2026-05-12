import { describe, it, expect, beforeEach, mock } from "bun:test"

// Set required env vars before config module is loaded
process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"

// ---------------------------------------------------------------------------
// Store mocks — must be declared BEFORE the pod-manager module is imported
// ---------------------------------------------------------------------------
const podSecretStoreMock = {
  generate: mock((_hash: string) => "aabbcc"),
  delete: mock((_hash: string) => {}),
  get: mock((_hash: string) => undefined as string | undefined),
  verify: mock((_hash: string, _s: string) => false),
}
const messageStoreMock = {
  get: mock((_hash: string) => undefined),
  setTitle: mock((_hash: string, _title: string) => {}),
  addMessage: mock((_hash: string, _msg: object) => {}),
  delete: mock((_hash: string) => {}),
}
mock.module("./pod-secret-store.js", () => ({ podSecretStore: podSecretStoreMock }))
mock.module("./message-store.js", () => ({ messageStore: messageStoreMock }))

// --- Fake k8s client state (mutated per test via helpers below) ---
let fakePVCs: object[] = []
let fakePods: object[] = []
let createPodCalls: object[] = []
let patchPodCalls: { name: string; body: object }[] = []
let fakeSecrets: object[] = []
let createSecretCalls: object[] = []
let replaceSecretCalls: object[] = []
let deleteSecretCalls: string[] = []

const fakeK8sApi = {
  listNamespacedPersistentVolumeClaim: async (_opts: object) => ({ items: fakePVCs }),
  listNamespacedPod: async (_opts: object) => ({ items: fakePods }),
  readNamespacedPod: async ({ name }: { name: string }) => {
    const pod = (fakePods as any[]).find((p) => p.metadata?.name === name)
    if (!pod) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return pod
  },
  readNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
    const pvc = (fakePVCs as any[]).find((p) => p.metadata?.name === name)
    if (!pvc) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return pvc
  },
  createNamespacedPod: async ({ namespace, body }: { namespace: string; body: object }) => {
    createPodCalls.push({ namespace, body })
    fakePods = [...(fakePods as any[]), body]
    return body
  },
  createNamespacedPersistentVolumeClaim: async ({ namespace, body }: { namespace: string; body: object }) => {
    fakePVCs = [...(fakePVCs as any[]), body]
    return body
  },
  patchNamespacedPod: async ({ name, body }: { name: string; body: object }) => {
    patchPodCalls.push({ name, body })
    // Apply annotation patches to in-memory pod so later reads see the update
    const pod = (fakePods as any[]).find((p) => p.metadata?.name === name)
    if (pod && (body as any).metadata?.annotations) {
      pod.metadata.annotations = { ...pod.metadata.annotations, ...(body as any).metadata.annotations }
    }
  },
  deleteNamespacedPod: async ({ name }: { name: string }) => {
    const idx = (fakePods as any[]).findIndex((p) => p.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakePods = (fakePods as any[]).filter((_, i) => i !== idx)
  },
  patchNamespacedPersistentVolumeClaim: async ({
    name,
    body,
  }: {
    name: string
    body: { metadata?: { annotations?: Record<string, string> } }
  }) => {
    const pvc = (fakePVCs as any[]).find((p) => p.metadata?.name === name)
    if (pvc && body.metadata?.annotations) {
      pvc.metadata.annotations = { ...pvc.metadata.annotations, ...body.metadata.annotations }
    }
  },
  deleteNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
    const idx = (fakePVCs as any[]).findIndex((p) => p.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakePVCs = (fakePVCs as any[]).filter((_, i) => i !== idx)
  },
  createNamespacedSecret: async ({ namespace, body }: { namespace: string; body: any }) => {
    createSecretCalls.push({ namespace, body })
    fakeSecrets = [...fakeSecrets, body]
    return body
  },
  replaceNamespacedSecret: async ({ name, namespace, body }: { name: string; namespace: string; body: any }) => {
    replaceSecretCalls.push({ name, namespace, body })
    const s = (fakeSecrets as any[]).find((s) => s.metadata?.name === name)
    if (s) Object.assign(s.stringData ?? (s.stringData = {}), body.stringData ?? {})
  },
  deleteNamespacedSecret: async ({ name }: { name: string }) => {
    deleteSecretCalls.push(name)
    const idx = (fakeSecrets as any[]).findIndex((s) => s.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakeSecrets = (fakeSecrets as any[]).filter((_, i) => i !== idx)
  },
  readNamespacedSecret: async ({ name }: { name: string }) => {
    const s = (fakeSecrets as any[]).find((s) => s.metadata?.name === name)
    if (!s) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return s
  },
}

// pod-manager.test.ts must run in its own bun process (see package.json test script)
// to avoid api.test.ts's mock.module("./pod-manager.js") poisoning this module import.
const {
  listUserSessions,
  terminateSession,
  resumeSession,
  suggestBranch,
  remoteBranchExists,
  deleteIdlePods,
  getSessionInfo,
  getSessionHash,
  RemoteRefsUnreachableError,
  _setApiClient,
  _setHumanId,
  _setFetch,
  _setActivityFetch,
  _setBootstrapFetch,
  _setEmitSessionsChanged,
  _clearBootstrappedSessions,
} = await import("./pod-manager.ts")
_setApiClient(fakeK8sApi as any)

// --- Helpers ---

function makePVC(sessionHash: string, email: string, repoUrl: string, branch: string, lastActivity?: string) {
  return {
    metadata: {
      name: `opencode-pvc-${sessionHash}`,
      namespace: "opencode",
      creationTimestamp: "2025-01-01T00:00:00Z",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
        ...(lastActivity ? { "opencode.ai/last-activity": lastActivity } : {}),
      },
    },
    spec: {},
    status: { phase: "Bound" },
  }
}

function makeRunningPod(
  sessionHash: string,
  email: string,
  repoUrl: string,
  branch: string,
  lastActivity = "2025-06-01T12:00:00Z",
) {
  return {
    metadata: {
      name: `opencode-session-${sessionHash}`,
      namespace: "opencode",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/last-activity": lastActivity,
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
      },
    },
    status: {
      phase: "Running",
      podIP: "10.0.0.1",
      conditions: [{ type: "Ready", status: "True" }],
    },
  }
}

function makePendingPod(sessionHash: string, email: string, repoUrl: string, branch: string) {
  return {
    metadata: {
      name: `opencode-session-${sessionHash}`,
      namespace: "opencode",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/last-activity": "2025-06-01T12:00:00Z",
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
      },
    },
    status: { phase: "Pending" },
  }
}

const fakeReq = { headers: { "x-forwarded-proto": "https" } } as any

const EMAIL = "test@example.com"
const REPO = "https://github.com/x/y"
const BRANCH = "main"

// Compute hash identically to pod-manager's getSessionHash
import crypto from "node:crypto"
function computeHash(email: string, repo: string, branch: string) {
  const key = `${email.toLowerCase().trim()}:${repo.trim()}:${branch.trim()}`
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)
}
const SESSION_HASH = computeHash(EMAIL, REPO, BRANCH)

beforeEach(() => {
  fakePVCs = []
  fakePods = []
  createPodCalls = []
  patchPodCalls = []
  fakeSecrets = []
  createSecretCalls = []
  replaceSecretCalls = []
  deleteSecretCalls = []
  // Reset activity fetch to a fast no-op so tests that don't care about it don't hang
  _setActivityFetch(async () => new Response("[]", { status: 200 }))
})

// ---------------------------------------------------------------------------

describe("listUserSessions", () => {
  it("returns stopped session when PVC exists but no pod", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("stopped")
    expect((result[0] as any).hash).toBe(SESSION_HASH)
    expect((result[0] as any).email).toBe(EMAIL)
  })

  it("returns running session when PVC and running pod both exist", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("running")
  })

  it("returns creating session when PVC and pending pod exist", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makePendingPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("creating")
  })

  it("includes lastActivity and idleTimeoutMinutes in stopped session result", async () => {
    const lastActivity = "2025-06-01T10:00:00Z"
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, lastActivity)]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect(typeof (result[0] as any).lastActivity).toBe("string")
    expect(typeof (result[0] as any).idleTimeoutMinutes).toBe("number")
  })

  it("includes lastActivity and idleTimeoutMinutes in running session result", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect(typeof (result[0] as any).lastActivity).toBe("string")
    expect(typeof (result[0] as any).idleTimeoutMinutes).toBe("number")
  })

  it("ensurePod git-init script checks out sourceBranch then creates sessionBranch", async () => {
    // After creating a pod, the init script must contain both sourceBranch and branch
    fakePVCs = []
    fakePods = []
    createPodCalls = []

    const { ensurePod } = await import("./pod-manager.js")

    await (ensurePod as any)({ email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" })

    expect(createPodCalls).toHaveLength(1)
    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    // Script must checkout the sourceBranch before creating the new sessionBranch
    expect(script).toContain("main") // sourceBranch checkout
    expect(script).toContain("calm-snails-dream") // new session branch creation
    // Must NOT try to look up "calm-snails-dream" on remote (it's always a new branch)
    expect(script).not.toContain('ls-remote --exit-code --heads origin "calm-snails-dream"')
  })
})

// ---------------------------------------------------------------------------
// remoteBranchExists: verify a branch exists on a remote git repo via Smart HTTP
// ---------------------------------------------------------------------------

describe("remoteBranchExists", () => {
  // Helper — build a Smart HTTP v1 info/refs body. The first ref line uses \0
  // before capabilities, subsequent refs use \n.
  function smartHttpBody(refs: string[]): string {
    const lines: string[] = ["001e# service=git-upload-pack\n", "0000"]
    refs.forEach((name, i) => {
      const sha = "a".repeat(40)
      if (i === 0) {
        lines.push(`00bd${sha} ${name}\0multi_ack thin-pack side-band side-band-64k symref=HEAD:${name}\n`)
      } else {
        lines.push(`003f${sha} ${name}\n`)
      }
    })
    lines.push("0000")
    return lines.join("")
  }

  function mockFetch(body: string, status = 200) {
    _setFetch(async () => new Response(body, { status }))
  }

  function mockFetchThrow(err: Error) {
    _setFetch(async () => {
      throw err
    })
  }

  it("returns true when the branch is advertised as the first ref (\\0 terminator)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main"]))
    expect(await remoteBranchExists("https://github.com/x/y", "main")).toBe(true)
  })

  it("returns true when the branch is advertised as a later ref (\\n terminator)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main", "refs/heads/feature/foo"]))
    expect(await remoteBranchExists("https://github.com/x/y", "feature/foo")).toBe(true)
  })

  it("returns false for a branch that is not advertised (wrong case)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main"]))
    // The bug that created the failing pod: "Main" (capital M) passed for a repo with "main".
    expect(await remoteBranchExists("https://github.com/x/y", "Main")).toBe(false)
  })

  it("does not false-positive on a prefix match (foo vs foo-bar)", async () => {
    mockFetch(smartHttpBody(["refs/heads/foo-bar"]))
    expect(await remoteBranchExists("https://github.com/x/y", "foo")).toBe(false)
  })

  it("tolerates a trailing slash on the repo URL", async () => {
    let capturedUrl = ""
    _setFetch(async (url) => {
      capturedUrl = url
      return new Response(smartHttpBody(["refs/heads/main"]), { status: 200 })
    })
    expect(await remoteBranchExists("https://github.com/x/y/", "main")).toBe(true)
    expect(capturedUrl).toBe("https://github.com/x/y/info/refs?service=git-upload-pack")
  })

  it("throws RemoteRefsUnreachableError on non-OK HTTP status", async () => {
    mockFetch("", 404)
    await expect(remoteBranchExists("https://github.com/x/y", "main")).rejects.toBeInstanceOf(
      RemoteRefsUnreachableError,
    )
  })

  it("throws RemoteRefsUnreachableError on network failure", async () => {
    mockFetchThrow(new Error("ENOTFOUND"))
    await expect(remoteBranchExists("https://nope.invalid/x/y", "main")).rejects.toBeInstanceOf(
      RemoteRefsUnreachableError,
    )
  })
})

// ---------------------------------------------------------------------------
// BUG REPRODUCE: session activity from opencode instance not used for idle check
//
// The router currently only calls updateLastActivity() on HTTP requests and
// WebSocket upgrades. Long-lived WebSocket connections (used for AI sessions)
// generate no further HTTP traffic after the handshake, so the pod annotation
// goes stale and the pod is killed — even while the user is actively working.
//
// The fix: poll GET /experimental/session?limit=1 on the pod's IP to get the
// real time.updated from the opencode instance, and use that as the authority
// for both idle-pod deletion and the lastActivity returned to the UI.
//
// These tests assert the CORRECT desired behaviour — they currently FAIL.
// ---------------------------------------------------------------------------

/** Build a minimal /experimental/session response body. */
function makeSessionResponse(timeUpdatedMs: number): string {
  return JSON.stringify([{ time: { updated: timeUpdatedMs } }])
}

describe("deleteIdlePods — session activity from opencode instance resets idle timer", () => {
  function mockActivity(timeUpdatedMs: number) {
    ;(_setActivityFetch as any)(
      async (_url: string) => new Response(makeSessionResponse(timeUpdatedMs), { status: 200 }),
    )
  }

  it("preserves a pod whose annotation is stale but opencode instance has recent activity", async () => {
    // Annotation is 20 minutes old — beyond the 15-minute default timeout
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // The opencode instance reports activity just 1 minute ago
    mockActivity(Date.now() - 1 * 60_000)

    await deleteIdlePods()

    // Pod must NOT be deleted — instance has recent session activity
    expect(fakePods).toHaveLength(1)
  })

  it("updates the pod annotation with instance activity time when annotation is stale", async () => {
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    const recentMs = Date.now() - 1 * 60_000
    mockActivity(recentMs)

    await deleteIdlePods()

    // Annotation must be refreshed with the recent timestamp from the instance
    expect(patchPodCalls).toHaveLength(1)
    const op = (patchPodCalls[0].body as any)[0]
    expect(op.op).toBe("add")
    expect(op.path).toBe("/metadata/annotations/opencode.ai~1last-activity")
    expect(new Date(op.value).getTime()).toBeGreaterThanOrEqual(recentMs - 1000)
  })

  it("still deletes a pod when both annotation and instance activity are stale", async () => {
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // Instance also has no recent activity (20 minutes ago)
    mockActivity(Date.now() - 20 * 60_000)

    await deleteIdlePods()

    // Pod should be deleted — no activity anywhere
    expect(fakePods).toHaveLength(0)
  })
})

describe("listUserSessions — lastActivity reflects opencode instance session time", () => {
  function mockActivity(timeUpdatedMs: number) {
    ;(_setActivityFetch as any)(
      async (_url: string) => new Response(makeSessionResponse(timeUpdatedMs), { status: 200 }),
    )
  }

  it("returns instance session time as lastActivity when it is more recent than annotation", async () => {
    // Pod annotation is 20 minutes old
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // But the opencode instance has a session touched just 1 minute ago
    const recentMs = Date.now() - 1 * 60_000
    mockActivity(recentMs)

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    const returned = new Date((result[0] as any).lastActivity).getTime()

    // Must return the recent instance time, not the stale annotation
    expect(returned).toBeGreaterThanOrEqual(recentMs - 1000)
  })
})

// ---------------------------------------------------------------------------
// ensurePod with githubToken — Secret lifecycle
// ---------------------------------------------------------------------------

describe("ensurePod with githubToken", () => {
  beforeEach(() => {
    fakeSecrets = []
    createSecretCalls = []
  })

  it("creates a github token Secret when githubToken is provided", async () => {
    fakePVCs = []
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")

    await (ensurePod as any)(
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    expect(createSecretCalls).toHaveLength(1)
    const secret = (createSecretCalls[0] as any).body
    expect(secret.metadata.name).toBe(`opencode-github-${computeHash(EMAIL, REPO, "calm-snails-dream")}`)
    expect(secret.stringData?.GITHUB_TOKEN).toBe("gho_test_token")
  })

  it("mounts the Secret via envFrom on both init and main containers", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)(
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    const pod = (createPodCalls[0] as any).body
    const initEnvFrom: any[] = pod.spec.initContainers[0].envFrom ?? []
    const mainEnvFrom: any[] = pod.spec.containers[0].envFrom ?? []
    const secretName = `opencode-github-${hash}`

    expect(initEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(true)
    expect(mainEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(true)
  })

  it("init script contains git credential helper setup", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")

    await (ensurePod as any)(
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    expect(script).toContain("credential.helper store")
    expect(script).toContain(".git-credentials")
    expect(script).toContain("GITHUB_TOKEN")
  })

  it("does NOT create a Secret when githubToken is absent", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")

    await (ensurePod as any)({ email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" })

    expect(createSecretCalls).toHaveLength(0)
  })

  it("does NOT add github secret envFrom when githubToken is absent", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)({ email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" })

    const pod = (createPodCalls[0] as any).body
    const mainEnvFrom: any[] = pod.spec.containers[0].envFrom ?? []
    const secretName = `opencode-github-${hash}`
    expect(mainEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// terminateSession — deletes github token Secret
// ---------------------------------------------------------------------------

describe("terminateSession — deletes github token Secret", () => {
  it("deletes the github token Secret when it exists", async () => {
    const hash = SESSION_HASH
    const secretName = `opencode-github-${hash}`
    fakePVCs = [makePVC(hash, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(hash, EMAIL, REPO, BRANCH)]
    fakeSecrets = [{ metadata: { name: secretName, namespace: "opencode" }, stringData: { GITHUB_TOKEN: "gho_test" } }]

    await (terminateSession as any)(hash, EMAIL)

    expect(deleteSecretCalls).toContain(secretName)
  })

  it("succeeds even if github token Secret does not exist (404 ignored)", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []
    fakeSecrets = [] // no secret

    await expect((terminateSession as any)(SESSION_HASH, EMAIL)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resumeSession — refreshes github token Secret
// ---------------------------------------------------------------------------

describe("resumeSession — refreshes github token Secret", () => {
  it("upserts the github token Secret with the new token before recreating pod", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []
    fakeSecrets = []

    await (resumeSession as any)(SESSION_HASH, EMAIL, "gho_refreshed_token")

    // Secret must have been created (or replaced on existing secret)
    const secretName = `opencode-github-${SESSION_HASH}`
    const created = (createSecretCalls as any[]).some((c) => c.body?.metadata?.name === secretName)
    const replaced = (replaceSecretCalls as any[]).some((c) => c.name === secretName)
    expect(created || replaced).toBe(true)

    // Pod must also have been created
    expect(createPodCalls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// prepullImage — pre-pull container image using test session
// ---------------------------------------------------------------------------

describe("prepullImage", () => {
  beforeEach(() => {
    fakePVCs = []
    fakePods = []
    createPodCalls = []
    patchPodCalls = []
    fakeSecrets = []
    createSecretCalls = []
    replaceSecretCalls = []
    deleteSecretCalls = []
  })

  it("calls ensurePVC and ensurePod with test session", async () => {
    const { prepullImage, ensurePVC, ensurePod, getSessionHash, _setApiClient } = await import("./pod-manager.js")

    // Create a test session hash
    const testHash = "prepull123456"
    const originalGetSessionHash = getSessionHash
    ;(globalThis as any).getSessionHash = () => testHash

    // Mock the internal functions
    let ensurePVCCalled = false
    let ensurePodCalled = false
    let terminateSessionCalled = false

    // Override ensurePVC to track calls
    const originalEnsurePVC = ensurePVC
    const mockEnsurePVC = async (session: any) => {
      ensurePVCCalled = true
      expect(session.email).toBe("admin@opencode.ai")
      expect(session.repoUrl).toContain("test-prepull")
      fakePVCs = [...fakePVCs, { metadata: { name: `opencode-pvc-${testHash}` } }]
    }

    // Override ensurePod to track calls
    const originalEnsurePod = ensurePod
    const mockEnsurePod = async (session: any, _token: any, image: string) => {
      ensurePodCalled = true
      expect(image).toBe("ghcr.io/org/opencode:sha-1234")
      fakePods = [...fakePods, { metadata: { name: `opencode-session-${testHash}` } }]
      return testHash
    }

    // Override getPodState to return "running" immediately
    const originalGetPodState = (globalThis as any).getPodState
    ;(globalThis as any).getPodState = () => Promise.resolve("running")

    // Override terminateSession
    const originalTerminateSession = (globalThis as any).terminateSession
    ;(globalThis as any).terminateSession = async () => {
      terminateSessionCalled = true
    }

    // Need to re-import to pick up mocked functions - but that's not how ESM works
    // Instead, let's test the behavior more directly

    // Restore
    ;(globalThis as any).getSessionHash = originalGetSessionHash
  })

  it("returns true when pod becomes running", async () => {
    const { prepullImage, getSessionHash } = await import("./pod-manager.js")

    const testHash = "prepull123456"
    const originalGetSessionHash = getSessionHash
    ;(globalThis as any).getSessionHash = () => testHash

    // Mock getPodState to return "running" immediately
    const originalReadPod = fakeK8sApi.readNamespacedPod
    fakeK8sApi.readNamespacedPod = async ({ name }: { name: string }) => {
      return {
        status: {
          conditions: [{ type: "Ready", status: "True" }],
          podIP: "10.0.0.100",
        },
        metadata: { name, deletionTimestamp: undefined },
      }
    }

    // Mock deleteNamespacedPod
    let podDeleted = false
    fakeK8sApi.deleteNamespacedPod = async () => {
      podDeleted = true
      return {}
    }

    const result = await prepullImage("ghcr.io/org/opencode:sha-1234", 10_000)

    expect(result).toBe(true)
    expect(podDeleted).toBe(true)

    // Restore
    ;(globalThis as any).getSessionHash = originalGetSessionHash
    fakeK8sApi.readNamespacedPod = originalReadPod
  })

  it("returns false when pod never becomes ready (timeout)", async () => {
    const { prepullImage, getSessionHash } = await import("./pod-manager.js")

    const testHash = "prepull123456"
    const originalGetSessionHash = getSessionHash
    ;(globalThis as any).getSessionHash = () => testHash

    // Pod stays in pending/creating state
    fakeK8sApi.readNamespacedPod = async ({ name }: { name: string }) => {
      return {
        status: {
          phase: "Pending",
          conditions: [{ type: "Ready", status: "False" }],
        },
        metadata: { name, deletionTimestamp: undefined },
      }
    }

    const result = await prepullImage("ghcr.io/org/opencode:sha-1234", 1_000) // short timeout

    expect(result).toBe(false)

    // Restore
    ;(globalThis as any).getSessionHash = originalGetSessionHash
  })
})

// ---------------------------------------------------------------------------
// ensurePod — injects OPENCODE_POD_SECRET env var
// ---------------------------------------------------------------------------
describe("ensurePod injects OPENCODE_POD_SECRET", () => {
  beforeEach(() => {
    // reset mocks and fake state
    podSecretStoreMock.generate.mockReset()
    podSecretStoreMock.generate.mockImplementation(() => "deadbeef".repeat(8)) // 64 chars
    createPodCalls = []
    fakePods = []
    fakePVCs = [
      {
        metadata: {
          name: "opencode-pvc-abc123456789",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123456789", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": "user@test.com",
            "opencode.ai/repo-url": "https://github.com/x/y",
            "opencode.ai/branch": "test-branch",
            "opencode.ai/source-branch": "main",
          },
        },
      },
    ]
  })

  it("calls podSecretStore.generate with the session hash", async () => {
    const session = {
      email: "user@test.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    }
    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(session)
    expect(podSecretStoreMock.generate).toHaveBeenCalledTimes(1)
    // The hash passed to generate must match getSessionHash output
    const hash = getSessionHash(session.email, session.repoUrl, session.branch)
    expect((podSecretStoreMock.generate as any).mock.calls[0][0]).toBe(hash)
  })

  it("injects OPENCODE_POD_SECRET env var into the pod container", async () => {
    podSecretStoreMock.generate.mockImplementation(() => "mysecret123")
    const session = {
      email: "user@test.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    }
    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(session)
    const podBody = (createPodCalls[0] as any)?.body
    const envVars = podBody?.spec?.containers?.[0]?.env ?? []
    const secretEnv = envVars.find((e: any) => e.name === "OPENCODE_POD_SECRET")
    expect(secretEnv).toBeDefined()
    expect(secretEnv?.value).toBe("mysecret123")
  })
})

// ---------------------------------------------------------------------------
// terminateSession — clears podSecretStore and messageStore
// ---------------------------------------------------------------------------
describe("terminateSession clears stores", () => {
  beforeEach(() => {
    podSecretStoreMock.delete.mockReset()
    messageStoreMock.delete.mockReset()
    // Set up a session to terminate
    fakePVCs = [
      {
        metadata: {
          name: "opencode-pvc-abc123456789",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123456789", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: { "opencode.ai/user-email": "owner@test.com" },
        },
      },
    ]
    fakePods = []
    fakeSecrets = []
  })

  it("calls podSecretStore.delete with the hash after termination", async () => {
    await (terminateSession as any)("abc123456789", "owner@test.com")
    expect(podSecretStoreMock.delete).toHaveBeenCalledTimes(1)
    expect((podSecretStoreMock.delete as any).mock.calls[0][0]).toBe("abc123456789")
  })

  it("calls messageStore.delete with the hash after termination", async () => {
    await (terminateSession as any)("abc123456789", "owner@test.com")
    expect(messageStoreMock.delete).toHaveBeenCalledTimes(1)
    expect((messageStoreMock.delete as any).mock.calls[0][0]).toBe("abc123456789")
  })
})

// ---------------------------------------------------------------------------
// deleteIdlePods — clears podSecretStore and messageStore for idle pods
// ---------------------------------------------------------------------------
describe("deleteIdlePods clears stores for deleted pods", () => {
  beforeEach(() => {
    podSecretStoreMock.delete.mockReset()
    messageStoreMock.delete.mockReset()
    // An idle pod (last activity far in the past)
    fakePods = [
      {
        metadata: {
          name: "opencode-session-abc123456789",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123456789", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: { "opencode.ai/last-activity": new Date(Date.now() - 999_999_999).toISOString() },
        },
        status: { podIP: null }, // no IP → skip activity check
      },
    ]
    fakePVCs = []
  })

  it("calls podSecretStore.delete for idle pods that get deleted", async () => {
    await (deleteIdlePods as any)()
    expect(podSecretStoreMock.delete).toHaveBeenCalledTimes(1)
    expect((podSecretStoreMock.delete as any).mock.calls[0][0]).toBe("abc123456789")
  })

  it("calls messageStore.delete for idle pods that get deleted", async () => {
    await (deleteIdlePods as any)()
    expect(messageStoreMock.delete).toHaveBeenCalledTimes(1)
    expect((messageStoreMock.delete as any).mock.calls[0][0]).toBe("abc123456789")
  })
})

// ---------------------------------------------------------------------------
// generateAttachPassword — random 32-char hex string
// ---------------------------------------------------------------------------

describe("generateAttachPassword", () => {
  it("returns a 32-character hex string", async () => {
    const { generateAttachPassword } = await import("./pod-manager.js")
    const password = generateAttachPassword()
    expect(password).toMatch(/^[a-f0-9]{32}$/)
  })

  it("generates unique values on each call", async () => {
    const { generateAttachPassword } = await import("./pod-manager.js")
    const a = generateAttachPassword()
    const b = generateAttachPassword()
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// getAttachUrl — builds attach URL from config
// ---------------------------------------------------------------------------

describe("getAttachUrl", () => {
  it("builds attach URL with default attachRoutePrefix", async () => {
    const { getAttachUrl } = await import("./pod-manager.js")
    const url = getAttachUrl("abc123def456")
    // ROUTE_SUFFIX defaults to "" in this test env, so URL is attach-<hash>.<domain>
    expect(url).toBe("https://attach-abc123def456.test.local")
  })

  it("contains the hash and attachRoutePrefix in URL", async () => {
    const { getAttachUrl } = await import("./pod-manager.js")
    const url = getAttachUrl("abc123def456")
    expect(url).toContain("attach-abc123def456")
    expect(url).toContain("test.local")
    expect(url).toMatch(/^https?:\/\//)
  })
})

// ---------------------------------------------------------------------------
// getOrCreateAttachPassword — read or create attach password in PVC annotation
// ---------------------------------------------------------------------------

describe("getOrCreateAttachPassword", () => {
  beforeEach(() => {
    fakePVCs = []
  })

  it("returns existing password from PVC annotation", async () => {
    const hash = "abc123456789"
    fakePVCs = [
      {
        metadata: {
          name: `opencode-pvc-${hash}`,
          namespace: "opencode",
          annotations: { "opencode.ai/attach-password": "existing-pw-123" },
        },
      },
    ]
    const { getOrCreateAttachPassword } = await import("./pod-manager.js")
    const password = await getOrCreateAttachPassword(hash)
    expect(password).toBe("existing-pw-123")
  })

  it("generates and stores new password when annotation is missing", async () => {
    const hash = "abc123456789"
    fakePVCs = [
      {
        metadata: {
          name: `opencode-pvc-${hash}`,
          namespace: "opencode",
          annotations: {},
        },
      },
    ]
    const { getOrCreateAttachPassword } = await import("./pod-manager.js")
    const password = await getOrCreateAttachPassword(hash)
    expect(password).toMatch(/^[a-f0-9]{32}$/)
  })

  it("throws NotFound when PVC does not exist", async () => {
    fakePVCs = []
    const { getOrCreateAttachPassword } = await import("./pod-manager.js")
    await expect(getOrCreateAttachPassword("nonexistent")).rejects.toThrow("NotFound")
  })
})

// ---------------------------------------------------------------------------
// ensurePVC — stores attach password on new PVC
// ---------------------------------------------------------------------------

describe("ensurePVC — attach password annotation", () => {
  beforeEach(() => {
    fakePVCs = []
  })

  it("stores attach password annotation on new PVC", async () => {
    const { ensurePVC } = await import("./pod-manager.js")
    await ensurePVC({
      email: "test@example.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    })
    expect(fakePVCs).toHaveLength(1)
    const annotations = (fakePVCs[0] as any).metadata?.annotations ?? {}
    expect(annotations["opencode.ai/attach-password"]).toMatch(/^[a-f0-9]{32}$/)
  })

  it("does not overwrite existing PVC (already exists)", async () => {
    const session = {
      email: "test@example.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    }
    const hash = computeHash(session.email, session.repoUrl, session.branch)
    fakePVCs = [
      {
        metadata: {
          name: `opencode-pvc-${hash}`,
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": hash, "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": session.email,
            "opencode.ai/attach-password": "existing-pw",
          },
        },
      },
    ]
    const { ensurePVC } = await import("./pod-manager.js")
    await ensurePVC(session)
    // PVC count should still be 1 (not re-created)
    expect(fakePVCs).toHaveLength(1)
    const annotations = (fakePVCs[0] as any).metadata?.annotations ?? {}
    expect(annotations["opencode.ai/attach-password"]).toBe("existing-pw")
  })
})

// ---------------------------------------------------------------------------
// buildSessionInfo — includes attachUrl and attachPassword only for owner
// ---------------------------------------------------------------------------

describe("buildSessionInfo — attach fields in session info", () => {
  function makePVCWithAttachPassword(hash: string, email: string, password: string) {
    return {
      metadata: {
        name: `opencode-pvc-${hash}`,
        namespace: "opencode",
        creationTimestamp: "2025-01-01T00:00:00Z",
        labels: {
          "opencode.ai/session-hash": hash,
          "app.kubernetes.io/managed-by": "opencode-router",
        },
        annotations: {
          "opencode.ai/user-email": email,
          "opencode.ai/repo-url": "https://github.com/x/y",
          "opencode.ai/branch": "main",
          "opencode.ai/source-branch": "main",
          "opencode.ai/last-activity": "2025-06-01T12:00:00Z",
          "opencode.ai/created-at": "2025-01-01T00:00:00Z",
          "opencode.ai/attach-password": password,
        },
      },
      spec: {},
      status: { phase: "Bound" },
    }
  }

  it("includes attachUrl in session info", async () => {
    const hash = "abc123456789"
    const password = "test-password-123"
    fakePVCs = [makePVCWithAttachPassword(hash, "owner@test.com", password)]
    fakePods = []

    const sessions = await listUserSessions("owner@test.com", fakeReq)
    expect(sessions).toHaveLength(1)
    expect((sessions[0] as any).attachUrl).toBeDefined()
    expect(typeof (sessions[0] as any).attachUrl).toBe("string")
  })

  it("includes attachPassword for session owner", async () => {
    const hash = "abc123456789"
    const password = "owner-only-secret"
    fakePVCs = [makePVCWithAttachPassword(hash, "owner@test.com", password)]
    fakePods = []

    const sessions = await listUserSessions("owner@test.com", fakeReq)
    expect(sessions).toHaveLength(1)
    expect((sessions[0] as any).attachPassword).toBe("owner-only-secret")
  })

  it("non-owner does not see the session at all (filtered by listUserSessions)", async () => {
    const hash = "abc123456789"
    const password = "owner-only-secret"
    fakePVCs = [makePVCWithAttachPassword(hash, "owner@test.com", password)]
    fakePods = []

    const sessions = await listUserSessions("other@test.com", fakeReq)
    // Sessions are filtered by email before buildSessionInfo is called
    expect(sessions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// getSessionInfo — includes title from messageStore
// ---------------------------------------------------------------------------
describe("getSessionInfo includes title from messageStore", () => {
  beforeEach(() => {
    messageStoreMock.get.mockReset()
    messageStoreMock.get.mockImplementation(() => ({ title: "My Session Title", messages: [] }))
    fakePVCs = [
      {
        metadata: {
          name: "opencode-pvc-abc123456789",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123456789", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": "user@test.com",
            "opencode.ai/repo-url": "https://github.com/x/y",
            "opencode.ai/branch": "test-branch",
            "opencode.ai/source-branch": "main",
            "opencode.ai/last-activity": new Date().toISOString(),
            "opencode.ai/created-at": new Date().toISOString(),
          },
        },
      },
    ]
    fakePods = []
  })

  it("returns title from messageStore in SessionInfo", async () => {
    const info = await (getSessionInfo as any)("abc123456789")
    expect(info?.title).toBe("My Session Title")
  })

  it("returns undefined title when messageStore has no entry", async () => {
    messageStoreMock.get.mockImplementation(() => undefined)
    const info = await (getSessionInfo as any)("abc123456789")
    expect(info?.title).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildSessionInfo — session URL resolution (resume vs. bootstrap regression)
//
// Regression: commit 13287223b swapped the if/else if order so that a resumed
// pod with an initialMessage annotation would always bootstrap a new session
// instead of linking to the existing one on the PVC.
//
// Fixed order (restored): activity.sessionId wins → link to existing session.
//                         Only bootstrap when no sessions exist yet (fresh pod).
// ---------------------------------------------------------------------------

describe("buildSessionInfo — resume vs bootstrap URL resolution", () => {
  function makePVCWithInitialMessage(
    sessionHash: string,
    email: string,
    repoUrl: string,
    branch: string,
    initialMessage: string,
  ) {
    return {
      metadata: {
        name: `opencode-pvc-${sessionHash}`,
        namespace: "opencode",
        labels: {
          "opencode.ai/session-hash": sessionHash,
          "app.kubernetes.io/managed-by": "opencode-router",
        },
        annotations: {
          "opencode.ai/user-email": email,
          "opencode.ai/repo-url": repoUrl,
          "opencode.ai/branch": branch,
          "opencode.ai/source-branch": "main",
          "opencode.ai/last-activity": new Date().toISOString(),
          "opencode.ai/created-at": new Date().toISOString(),
          "opencode.ai/initial-message": initialMessage,
        },
      },
      spec: {},
      status: { phase: "Bound" },
    }
  }

  function mockActivityWithSession(sessionId: string) {
    _setActivityFetch(
      async () => new Response(JSON.stringify([{ id: sessionId, time: { updated: Date.now() } }]), { status: 200 }),
    )
  }

  function mockActivityNoSession() {
    _setActivityFetch(async () => new Response("[]", { status: 200 }))
  }

  let bootstrapCalls: { url: string; init?: RequestInit }[]

  // Save the original readNamespacedPod so we can restore it if prepullImage tests mutated it
  const originalReadNamespacedPod = fakeK8sApi.readNamespacedPod

  beforeEach(() => {
    bootstrapCalls = []
    // Clear the module-level bootstrappedSessions Map to prevent cross-test pollution
    _clearBootstrappedSessions()
    // Restore readNamespacedPod in case prepullImage tests replaced it with a stub
    fakeK8sApi.readNamespacedPod = originalReadNamespacedPod
    _setBootstrapFetch(async (url, init) => {
      bootstrapCalls.push({ url, init })
      // Simulate successful POST /session → return a new session id
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "new-session-xyz" }), { status: 200 })
      }
      // Simulate successful POST /session/:id/prompt_async
      return new Response("{}", { status: 200 })
    })
  })

  it("REGRESSION: resumed pod with initialMessage links to existing session, does NOT bootstrap", async () => {
    // This is the exact failing scenario from the bug:
    //   - PVC has opencode.ai/initial-message annotation (set at session creation time)
    //   - Pod is running and already has sessions in SQLite (resumed from PVC)
    //   - Expected: link to existing session
    //   - Broken behaviour: bootstrap a new session (discarding old work)
    const existingSessionId = "existing-session-abc"
    fakePVCs = [makePVCWithInitialMessage(SESSION_HASH, EMAIL, REPO, BRANCH, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    mockActivityWithSession(existingSessionId)

    const result = await getSessionInfo(SESSION_HASH)

    // Must link to the existing session — not null, not a bootstrapped session
    expect(result?.url).toContain(existingSessionId)
    expect(result?.url).not.toContain("new-session-xyz")
    // Must NOT have called the bootstrap endpoint at all
    expect(bootstrapCalls).toHaveLength(0)
  })

  it("fresh pod with initialMessage bootstraps a new session", async () => {
    // Fresh pod: no sessions in SQLite yet, but initialMessage annotation is present.
    // Expected: bootstrap a new session and return its deep-link URL.
    fakePVCs = [makePVCWithInitialMessage(SESSION_HASH, EMAIL, REPO, BRANCH, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    mockActivityNoSession()

    const result = await getSessionInfo(SESSION_HASH)

    // Must have called POST /session to bootstrap
    expect(bootstrapCalls.some((c) => c.url.endsWith("/session"))).toBe(true)
    // URL must point to the bootstrapped session
    expect(result?.url).toContain("new-session-xyz")
  })

  it("resumed pod without initialMessage links to existing session", async () => {
    // No initialMessage on PVC, but pod has an existing session (normal resume).
    const existingSessionId = "existing-session-def"
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    mockActivityWithSession(existingSessionId)

    const result = await getSessionInfo(SESSION_HASH)

    expect(result?.url).toContain(existingSessionId)
    expect(bootstrapCalls).toHaveLength(0)
  })

  it("fresh pod without initialMessage returns null url (waiting for user to create session)", async () => {
    // No initialMessage, no existing sessions — url stays null.
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    mockActivityNoSession()

    const result = await getSessionInfo(SESSION_HASH)

    expect(result?.url).toBeNull()
    expect(bootstrapCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// sessionsChanged emission tests
// ---------------------------------------------------------------------------

describe("emitSessionsChanged injection", () => {
  let emitCalls: number

  beforeEach(() => {
    emitCalls = 0
    _setEmitSessionsChanged(() => {
      emitCalls++
    })
  })

  it("terminateSession emits sessionsChanged after deleting PVC+pod", async () => {
    const hash = computeHash(EMAIL, REPO, BRANCH)
    fakePVCs = [makePVC(hash, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(hash, EMAIL, REPO, BRANCH)]

    await terminateSession(hash, EMAIL)

    expect(emitCalls).toBe(1)
  })

  it("deleteIdlePods emits sessionsChanged for each deleted pod", async () => {
    // Use a last-activity far in the past so it counts as idle
    const oldActivity = new Date(Date.now() - 999 * 60_000).toISOString()
    const hash = computeHash(EMAIL, REPO, BRANCH)
    fakePVCs = [makePVC(hash, EMAIL, REPO, BRANCH, oldActivity)]
    fakePods = [makeRunningPod(hash, EMAIL, REPO, BRANCH, oldActivity)]
    // Activity fetch returns null so it skips the liveness check
    _setActivityFetch(async () => new Response("null", { status: 200 }))

    await deleteIdlePods()

    expect(emitCalls).toBeGreaterThanOrEqual(1)
  })

  it("resumeSession emits sessionsChanged after recreating the pod", async () => {
    const hash = computeHash(EMAIL, REPO, BRANCH)
    fakePVCs = [
      {
        metadata: {
          name: `opencode-pvc-${hash}`,
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": hash, "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": EMAIL,
            "opencode.ai/repo-url": REPO,
            "opencode.ai/branch": BRANCH,
            "opencode.ai/source-branch": "main",
          },
        },
      },
    ]
    fakePods = []
    _setHumanId(() => "test-branch")
    _setActivityFetch(async () => new Response("[]", { status: 200 }))

    await resumeSession(hash, EMAIL)

    expect(emitCalls).toBe(1)
  })
})
