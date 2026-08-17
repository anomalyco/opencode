import { describe, expect, test } from "bun:test"
import { channelsForRef, resolveChannel, validGitHubClaims } from "./index"

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
