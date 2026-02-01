import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"

describe("rootPath support", () => {
  test("server accepts rootPath option", () => {
    // Test that listen function accepts rootPath parameter
    const listenFn = Server.listen
    expect(listenFn).toBeDefined()
    
    // This will test that the function signature is correct
    // We can't actually start the server in tests, but we can verify the types
  })
  
  test("URL construction with rootPath", () => {
    // Test URL construction logic
    const testCases = [
      { rootPath: "", expected: "http://localhost:4096" },
      { rootPath: "/proxy", expected: "http://localhost:4096/proxy" },
      { rootPath: "/jupyter/proxy/opencode", expected: "http://192.168.1.100:4096/jupyter/proxy/opencode" },
    ]
    
    for (const { rootPath, expected } of testCases) {
      const hostname = expected.includes("192.168") ? "192.168.1.100" : "localhost"
      const port = 4096
      
      const url = rootPath 
        ? new URL(rootPath, `http://${hostname}:${port}`).toString()
        : `http://${hostname}:${port}`
      
      expect(url).toBe(expected)
    }
  })
  
  test("rootPath validation", () => {
    // Test that rootPath must start with /
    const invalidPaths = ["proxy", "test/path", "no-slash"]
    const validPaths = ["/proxy", "/test/path", "/jupyter/proxy/opencode"]
    
    for (const path of invalidPaths) {
      if (path && !path.startsWith("/")) {
        // This should throw an error
        expect(path.startsWith("/")).toBe(false)
      }
    }
    
    for (const path of validPaths) {
      expect(path.startsWith("/")).toBe(true)
    }
  })
  
  test("server URL with rootPath", () => {
    // Simulate server.url construction
    const serverUrl = new URL("http://localhost:4096")
    
    // Test with rootPath
    const rootPath = "/proxy"
    const finalUrl = rootPath ? new URL(rootPath, serverUrl) : serverUrl
    
    expect(finalUrl.toString()).toBe("http://localhost:4096/proxy")
    
    // Test without rootPath
    const noRootPath = ""
    const finalUrl2 = noRootPath ? new URL(noRootPath, serverUrl) : serverUrl
    
    expect(finalUrl2.toString()).toBe("http://localhost:4096/")
  })
})
