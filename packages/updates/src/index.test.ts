import { describe, expect, test } from "bun:test"
import worker, { channelsForRef, resolveChannel, validGitHubClaims } from "./index"

const claims = {
  repository: "anomalyco/opencode",
  repository_id: "975734319",
  repository_owner_id: "66570915",
  workflow_ref: "anomalyco/opencode/.github/workflows/publish.yml@refs/heads/dev",
  ref: "refs/heads/dev",
  sha: "abc123",
  run_id: "123",
  run_attempt: "1",
  actor: "opencode-agent",
}

describe("GitHub publish authorization", () => {
  test("allows the publish workflow from the repository", () => {
    expect(validGitHubClaims(claims)).toBe(true)
    expect(channelsForRef(claims.ref)).toEqual(["dev", "latest"])
  })

  test("maps V2 development to the dev channel", () => {
    expect(channelsForRef("refs/heads/v2")).toEqual(["dev"])
  })

  test("rejects another repository or workflow", () => {
    expect(validGitHubClaims({ ...claims, repository_id: "1" })).toBe(false)
    expect(
      validGitHubClaims({ ...claims, workflow_ref: "anomalyco/opencode/.github/workflows/other.yml@refs/heads/dev" }),
    ).toBe(false)
  })

  test("rejects unconfigured refs", () => {
    const ref = "refs/heads/untrusted"
    expect(
      validGitHubClaims({ ...claims, ref, workflow_ref: `anomalyco/opencode/.github/workflows/publish.yml@${ref}` }),
    ).toBe(false)
  })
})

test("routes the retired next channel to beta", () => {
  expect(resolveChannel("next")).toBe("beta")
  expect(resolveChannel("dev")).toBe("dev")
})

const artifact = {
  channel: "beta",
  name: "opencode",
  distribution: "darwin-arm64",
  version: "1.0.0",
  metadata: "{}",
  active: 1,
  time_created: 1,
  time_updated: 2,
}

test.each([
  ["/api/next", ["beta"], { channel: "beta", artifacts: [{ ...artifact, metadata: {}, active: true }] }],
  [
    "/api/next/opencode",
    ["beta", "opencode"],
    { channel: "beta", name: "opencode", artifacts: [{ ...artifact, metadata: {}, active: true }] },
  ],
  [
    "/api/next/opencode/darwin-arm64",
    ["beta", "opencode", "darwin-arm64"],
    { ...artifact, metadata: {}, active: true },
  ],
])("routes GET %s", async (path, expectedBindings, expectedBody) => {
  const bindings: unknown[][] = []
  const statement = {
    bind(...values: unknown[]) {
      bindings.push(values)
      return statement
    },
    async all() {
      return { results: [artifact] }
    },
    async first() {
      return artifact
    },
  }
  const db = {
    prepare() {
      return statement
    },
  } as unknown as D1Database

  const response = await worker.fetch(new Request(`https://update.opencode.ai${path}`), { DB: db })

  expect(response.status).toBe(200)
  expect(await response.text()).toBe(JSON.stringify(expectedBody))
  expect(bindings).toEqual([expectedBindings])
})

test.each(["/api", "/v1/dev", "/api/dev/opencode/darwin-arm64/extra", "/api/dev/opencode/darwin$arm64"])(
  "returns 404 for GET %s",
  async (path) => {
    const db = {
      prepare() {
        throw new Error("Invalid routes must not query the database")
      },
    } as unknown as D1Database

    const response = await worker.fetch(new Request(`https://update.opencode.ai${path}`), { DB: db })

    expect(response.status).toBe(404)
    expect(await response.text()).toBe("Not found")
  },
)
