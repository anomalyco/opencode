import { beforeAll, describe, expect, mock, test } from "bun:test"
import { ServerScope } from "@/utils/server-scope"

let createPromptRouteScope: typeof import("./prompt").createPromptRouteScope
let getPromptSessionCacheKey: typeof import("./prompt").getPromptSessionCacheKey

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useLocation: () => ({}),
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useSearchParams: () => [{}],
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))

  const mod = await import("./prompt")
  createPromptRouteScope = mod.createPromptRouteScope
  getPromptSessionCacheKey = mod.getPromptSessionCacheKey
})

describe("getPromptSessionCacheKey", () => {
  test("separates prompt sessions by server scope", () => {
    const local = getPromptSessionCacheKey(ServerScope.local, { dir: "/repo", id: "ses_123" })
    const remote = getPromptSessionCacheKey("ssh:debian" as ServerScope, { dir: "/repo", id: "ses_123" })

    expect(String(local)).toBe("local\0/repo\0ses_123")
    expect(String(remote)).toBe("ssh:debian\0/repo\0ses_123")
    expect(remote).not.toBe(local)
  })

  test("separates workspace prompt sessions by server scope", () => {
    expect(String(getPromptSessionCacheKey(ServerScope.local, { dir: "/repo" }))).toBe("local\0/repo\0__workspace__")
  })

  test("keeps explicit draft sessions keyed by draft id", () => {
    expect(getPromptSessionCacheKey(ServerScope.local, { draftID: "draft_123" })).toBe("draft:draft_123")
  })
})

describe("createPromptRouteScope", () => {
  test("returns undefined until a draft or directory scope is available", () => {
    expect(createPromptRouteScope({})).toBeUndefined()
  })

  test("prefers draft scope over route directory scope", () => {
    expect(createPromptRouteScope({ draftID: "draft-1", dir: "/tmp/project", id: "ses_1" })).toEqual({
      draftID: "draft-1",
    })
  })

  test("uses route directory scope when available", () => {
    expect(createPromptRouteScope({ dir: "/tmp/project", id: "ses_1" })).toEqual({
      dir: "/tmp/project",
      id: "ses_1",
    })
  })
})
