import { describe, expect, test } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("launcher", () => {
  describe("/launcher route", () => {
    test("should serve launcher HTML page", async () => {
      const app = Server.App()
      const response = await app.request("/launcher")

      expect(response.status).toBe(200)
      const contentType = response.headers.get("content-type")
      expect(contentType).toContain("text/html")

      const html = await response.text()
      expect(html).toContain("OpenCode Launcher")
      expect(html).toContain("Browse and select a project folder")
      expect(html).toContain('id="explorer"')
      expect(html).toContain('id="pathInput"')
    })
  })

  describe("/launcher/browse API", () => {
    test("should return directory contents for valid path", async () => {
      const app = Server.App()
      const response = await app.request(`/launcher/browse?path=${encodeURIComponent(projectRoot)}`)

      expect(response.status).toBe(200)
      const items = await response.json()
      expect(Array.isArray(items)).toBe(true)

      // Should contain typical project files/directories
      const names = items.map((i: { name: string }) => i.name)
      expect(names).toContain("src")
      expect(names).toContain("package.json")
    })

    test("should return items with correct structure", async () => {
      const app = Server.App()
      const response = await app.request(`/launcher/browse?path=${encodeURIComponent(projectRoot)}`)

      expect(response.status).toBe(200)
      const items = await response.json()

      // Each item should have name, path, and type
      for (const item of items) {
        expect(typeof item.name).toBe("string")
        expect(typeof item.path).toBe("string")
        expect(["directory", "file"]).toContain(item.type)
      }
    })

    test("should filter out hidden files (starting with .)", async () => {
      const app = Server.App()
      const response = await app.request(`/launcher/browse?path=${encodeURIComponent(projectRoot)}`)

      expect(response.status).toBe(200)
      const items = await response.json()

      // No items should start with .
      for (const item of items) {
        expect(item.name.startsWith(".")).toBe(false)
      }
    })

    test("should sort directories before files", async () => {
      const app = Server.App()
      const response = await app.request(`/launcher/browse?path=${encodeURIComponent(projectRoot)}`)

      expect(response.status).toBe(200)
      const items = await response.json()

      // Find first file index
      const firstFileIndex = items.findIndex((i: { type: string }) => i.type === "file")
      if (firstFileIndex > 0) {
        // All items before first file should be directories
        for (let i = 0; i < firstFileIndex; i++) {
          expect(items[i].type).toBe("directory")
        }
      }
    })

    test("should return error for invalid path", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse?path=/nonexistent/path/that/does/not/exist")

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe("Cannot read directory")
    })

    test("should default to root when no path provided", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse")

      expect(response.status).toBe(200)
      const items = await response.json()
      expect(Array.isArray(items)).toBe(true)
    })
  })

  describe("CORS headers", () => {
    test("should allow requests from localhost:3000", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse?path=/", {
        headers: {
          Origin: "http://localhost:3000",
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000")
    })

    test("should allow requests from 127.0.0.1:3000", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse?path=/", {
        headers: {
          Origin: "http://127.0.0.1:3000",
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:3000")
    })

    test("should allow requests from 0.0.0.0:3000", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse?path=/", {
        headers: {
          Origin: "http://0.0.0.0:3000",
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://0.0.0.0:3000")
    })

    test("should allow requests from any IP on port 3000", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse?path=/", {
        headers: {
          Origin: "http://192.168.1.100:3000",
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://192.168.1.100:3000")
    })

    test("should allow requests from any IP on port 5173 (Vite default)", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse?path=/", {
        headers: {
          Origin: "http://10.0.0.50:5173",
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://10.0.0.50:5173")
    })

    test("should handle OPTIONS preflight requests", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse?path=/", {
        method: "OPTIONS",
        headers: {
          Origin: "http://192.168.1.100:3000",
          "Access-Control-Request-Method": "GET",
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://192.168.1.100:3000")
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET")
    })

    test("should not allow requests from non-dev ports", async () => {
      const app = Server.App()
      const response = await app.request("/launcher/browse?path=/", {
        headers: {
          Origin: "http://192.168.1.100:8080",
        },
      })

      expect(response.status).toBe(200)
      // Should not have CORS header for non-allowed origin
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    })
  })
})
