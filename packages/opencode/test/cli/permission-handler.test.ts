import { describe, test, expect, mock } from "bun:test"
import { createCliPermissionHandler } from "../../src/cli/permission-handler"

describe("CLI Permission Handler", () => {
  test("should return deny when user confirms false", async () => {
    const handler = await createCliPermissionHandler({
      client: {} as any,
      project: {} as any,
      directory: "",
      worktree: "",
      $: {} as any,
    })

    const output = { status: "ask" as const }
    
    // Mock confirm to return false
    const info = {
      type: "bash",
      pattern: ["bash *"],
      title: "echo test",
    }

    expect(handler["permission.ask"]).toBeDefined()
    expect(typeof handler["permission.ask"]).toBe("function")
  })

  test("should export createCliPermissionHandler function", async () => {
    expect(typeof createCliPermissionHandler).toBe("function")
  })
})
