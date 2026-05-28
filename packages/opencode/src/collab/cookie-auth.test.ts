/**
 * Unit tests for the URL-extraction half of the cookie-auth gate.
 *
 * `cookieAuthorizesRequest` itself touches the database (cookie lookup,
 * participation check) so it isn't tested directly here — the smaller
 * pure helpers it composes are.  This is enough to lock in the
 * regression that motivated the file (Q&A reply / session DELETE 401ing
 * in the iframe because the URL-encoded `x-opencode-directory` header
 * wasn't being decoded before the workspace-root prefix check).
 */
import { expect, test, describe } from "bun:test"
import { base64Encode } from "@opencode-ai/core/util/encode"

import { directoryToCollabSessionId, workspaceParamFrom } from "./cookie-auth"

const WORKSPACE_ROOT = "/var/opencode/workspaces"
const COLLAB_ID = "abc123"
const REAL_DIR = `${WORKSPACE_ROOT}/${COLLAB_ID}/repo-name`

function makeRequest(opts: { method?: string; pathname?: string; search?: string; headers?: Record<string, string> }) {
  const url = "http://localhost" + (opts.pathname ?? "/") + (opts.search ?? "")
  return new Request(url, {
    method: opts.method ?? "GET",
    headers: opts.headers ?? {},
  })
}

describe("workspaceParamFrom — header-encoded directory", () => {
  test("URL-encoded x-opencode-directory header is decoded", () => {
    // POST/DELETE/PATCH path through the SDK: the directory header arrives
    // encoded (sdk/js/src/v2/client.ts line 63) because the rewrite
    // interceptor that moves it into a query param only fires for GET/HEAD.
    const req = makeRequest({
      method: "POST",
      pathname: "/question/q_42/reply",
      headers: { "x-opencode-directory": encodeURIComponent(REAL_DIR) },
    })
    const dir = workspaceParamFrom(req)
    expect(dir).toBe(REAL_DIR)
    expect(directoryToCollabSessionId(dir!)).toBe(COLLAB_ID)
  })

  test("raw (unencoded) x-opencode-directory header still resolves", () => {
    // Defensive: an internal caller that sets the header directly (e.g.
    // a test harness or future fetch wrapper) shouldn't have to mirror
    // the SDK's encode step.  decodeURIComponent on a raw path is a no-op.
    const req = makeRequest({
      method: "POST",
      pathname: "/session/sid/abort",
      headers: { "x-opencode-directory": REAL_DIR },
    })
    expect(workspaceParamFrom(req)).toBe(REAL_DIR)
  })

  test("malformed percent-encoding falls back to raw value (no throw)", () => {
    // A stray `%` in the header value would crash decodeURIComponent.
    // We swallow that and return the raw string so the gate can deny
    // cleanly rather than 500.
    const malformed = "/var/opencode/workspaces/%ZZ/repo"
    const req = makeRequest({
      method: "POST",
      pathname: "/question/q/reply",
      headers: { "x-opencode-directory": malformed },
    })
    expect(workspaceParamFrom(req)).toBe(malformed)
  })
})

describe("workspaceParamFrom — query and base64-path fallbacks", () => {
  test("?directory= query param is returned as-is (already decoded by URLSearchParams)", () => {
    const req = makeRequest({
      method: "GET",
      pathname: "/session",
      search: "?directory=" + encodeURIComponent(REAL_DIR),
    })
    expect(workspaceParamFrom(req)).toBe(REAL_DIR)
  })

  test("?location[directory]= query param is honoured", () => {
    const req = makeRequest({
      method: "GET",
      pathname: "/session",
      search: "?" + new URLSearchParams({ "location[directory]": REAL_DIR }).toString(),
    })
    expect(workspaceParamFrom(req)).toBe(REAL_DIR)
  })

  test("first path segment as URL-safe base64(directory) is decoded", () => {
    // The iframe page URL shape — directory baked into the path so the
    // gate works even before any per-request header/query is set.
    const req = makeRequest({
      method: "GET",
      pathname: `/${base64Encode(REAL_DIR)}/session/sid`,
    })
    expect(workspaceParamFrom(req)).toBe(REAL_DIR)
  })

  test("non-base64 first path segment returns null", () => {
    const req = makeRequest({ method: "GET", pathname: "/session/sid/message" })
    expect(workspaceParamFrom(req)).toBeNull()
  })

  test("no addressing at all → null", () => {
    const req = makeRequest({ method: "GET", pathname: "/global/event" })
    expect(workspaceParamFrom(req)).toBeNull()
  })

  test("header takes precedence over query param", () => {
    // Defines the precedence order the SDK relies on: when both arrive
    // (e.g. a future GET that didn't get rewritten) the header wins.
    const otherDir = `${WORKSPACE_ROOT}/other/repo`
    const req = makeRequest({
      method: "POST",
      pathname: "/question/q/reply",
      search: "?directory=" + encodeURIComponent(otherDir),
      headers: { "x-opencode-directory": encodeURIComponent(REAL_DIR) },
    })
    expect(workspaceParamFrom(req)).toBe(REAL_DIR)
  })
})

describe("directoryToCollabSessionId", () => {
  test("strips the workspace root and returns the first segment", () => {
    expect(directoryToCollabSessionId(REAL_DIR)).toBe(COLLAB_ID)
  })

  test("session-id-only directory (no repo segment) still resolves", () => {
    expect(directoryToCollabSessionId(`${WORKSPACE_ROOT}/${COLLAB_ID}`)).toBe(COLLAB_ID)
  })

  test("path outside workspace root returns null", () => {
    expect(directoryToCollabSessionId("/Users/dev/code/opencode")).toBeNull()
  })

  test("workspace root exactly (no session segment) returns null", () => {
    expect(directoryToCollabSessionId(WORKSPACE_ROOT + "/")).toBeNull()
  })
})
