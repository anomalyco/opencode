import { describe, test, expect } from "bun:test"
import { VCSManager } from "../../src/vcs/manager"

describe("VCS Integration Tests", () => {
  // These tests require a real GitLab instance
  // Run with: OPENSACIA_GITLAB_TOKEN=your-token bun test --cwd packages/opencode test/vcs/integration.test.ts

  test("connects to GitLab and lists MRs", async () => {
    const baseUrl = process.env.OPENSACIA_GITLAB_BASE_URL
    const token = process.env.OPENSACIA_GITLAB_TOKEN
    const projectId = process.env.OPENSACIA_GITLAB_PROJECT_ID || "61"

    if (!token) {
      console.log("Skipping: OPENSACIA_GITLAB_TOKEN not set")
      return
    }

    const manager = new VCSManager({
      provider: "gitlab",
      gitlab: {
        baseUrl: baseUrl || "https://hera.tics.inta/api/v4",
        token
      },
    })
    await manager.initialize()

    const mrs = await manager.listMRs(projectId)
    expect(Array.isArray(mrs)).toBe(true)
  })

  test("gets MR details", async () => {
    const token = process.env.OPENSACIA_GITLAB_TOKEN
    const projectId = process.env.OPENSACIA_GITLAB_PROJECT_ID || "61"

    if (!token) {
      console.log("Skipping: OPENSACIA_GITLAB_TOKEN not set")
      return
    }

    const manager = new VCSManager({
      provider: "gitlab",
      gitlab: {
        baseUrl: "https://hera.tics.inta/api/v4",
        token
      },
    })
    await manager.initialize()

    // First list MRs to get a valid IID
    const mrs = await manager.listMRs(projectId, { state: "opened" })
    if (mrs.length === 0) {
      console.log("Skipping: No open MRs found")
      return
    }

    const mr = await manager.getMR(projectId, mrs[0].iid)
    expect(mr.iid).toBe(mrs[0].iid)
    expect(mr.title).toBeTruthy()
  })
})
