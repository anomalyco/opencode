import { test, expect, describe } from "bun:test"
import { GiteaClient } from "../../src/git-platform/gitea/client"

class TestableGiteaClient extends GiteaClient {
  public testApiUrl(path: string) {
    return this.apiUrl(path)
  }

  public testMapPermission(permission: string) {
    return this.mapPermission(permission)
  }
}

describe("GiteaClient", () => {
  const client = new TestableGiteaClient("https://gitea.example.com", "test-token")

  describe("apiUrl", () => {
    test("adds /api/v1 prefix to paths", () => {
      expect(client.testApiUrl("/repos/owner/repo")).toBe("https://gitea.example.com/api/v1/repos/owner/repo")
    })

    test("handles trailing slash in base URL", () => {
      const clientWithSlash = new TestableGiteaClient("https://gitea.example.com/", "token")
      expect(clientWithSlash.testApiUrl("/repos/owner/repo")).toBe("https://gitea.example.com/api/v1/repos/owner/repo")
    })

    test("does not double-add /api/v1 if already present", () => {
      const clientWithApi = new TestableGiteaClient("https://gitea.example.com/api/v1", "token")
      expect(clientWithApi.testApiUrl("/repos/owner/repo")).toBe("https://gitea.example.com/api/v1/repos/owner/repo")
    })
  })

  describe("mapPermission", () => {
    test("maps admin permission", () => {
      expect(client.testMapPermission("admin")).toBe("admin")
      expect(client.testMapPermission("ADMIN")).toBe("admin")
    })

    test("maps write permission", () => {
      expect(client.testMapPermission("write")).toBe("write")
      expect(client.testMapPermission("WRITE")).toBe("write")
    })

    test("maps read permission", () => {
      expect(client.testMapPermission("read")).toBe("read")
      expect(client.testMapPermission("READ")).toBe("read")
    })

    test("maps owner to admin", () => {
      expect(client.testMapPermission("owner")).toBe("admin")
    })

    test("returns none for unknown permissions", () => {
      expect(client.testMapPermission("unknown")).toBe("none")
      expect(client.testMapPermission("")).toBe("none")
    })
  })
})
