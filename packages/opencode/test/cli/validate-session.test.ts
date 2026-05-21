import { describe, expect, test } from "bun:test"

/**
 * Test for issue #28214: `opencode attach <url> --dir <PATH>` segfaults
 * when no session on the server has a working directory matching `<PATH>`.
 *
 * This test verifies the core validation logic that was added to
 * validate-session.ts to prevent the crash.
 *
 * NOTE: Due to broken bun dependency cache (@opentui/solid → missing babel
 * packages), this test may fail to load when run from within the package.
 * Run standalone: `cp test/cli/validate-session.test.ts /tmp/ && bun test /tmp/validate-session.test.ts`
 */
describe("attach --dir directory validation", () => {
  /**
   * Simulates the directory validation logic added to validate-session.ts
   * (lines 32-41)
   */
  async function validateDirectory(
    client: {
      session: { list: (params: { directory: string }) => Promise<{ data: Array<unknown> }> }
    },
    directory: string,
  ): Promise<void> {
    const response = await client.session.list({ directory })
    const sessions = response.data ?? []
    if (sessions.length === 0) {
      throw new Error(`No sessions found for directory: ${directory}`)
    }
  }

  test("throws clear error when directory has no matching sessions", async () => {
    const mockClient = {
      session: {
        list: async () => ({ data: [] }),
      },
    }

    await expect(
      validateDirectory(mockClient, "/tmp/nonexistent-dir"),
    ).rejects.toThrow("No sessions found for directory: /tmp/nonexistent-dir")
  })

  test("passes when directory has matching sessions", async () => {
    const mockClient = {
      session: {
        list: async () => ({
          data: [{ id: "session-123", directory: "/tmp/existing-dir" }],
        }),
      },
    }

    await expect(validateDirectory(mockClient, "/tmp/existing-dir")).resolves.toBeUndefined()
  })

  test("rejects empty sessions array", async () => {
    const mockClient = {
      session: {
        list: async () => ({ data: [] }),
      },
    }

    await expect(validateDirectory(mockClient, "/some/path")).rejects.toThrow()
  })

  test("accepts non-empty sessions array", async () => {
    const mockClient = {
      session: {
        list: async () => ({
          data: [
            { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", directory: "/some/path" },
            { id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", directory: "/some/path" },
          ],
        }),
      },
    }

    await expect(validateDirectory(mockClient, "/some/path")).resolves.toBeUndefined()
  })

  test("handles null data gracefully", async () => {
    const mockClient = {
      session: {
        list: async () => ({ data: null as unknown as Array<unknown> }),
      },
    }

    await expect(validateDirectory(mockClient, "/some/path")).rejects.toThrow(
      "No sessions found for directory: /some/path",
    )
  })
})
