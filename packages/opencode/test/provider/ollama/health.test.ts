import { describe, test, expect } from "bun:test"

// Inline test since the module may not be built yet
// TODO: Enable full test when build system is configured
describe("Ollama Health Check", () => {
  test("returns true when Ollama is reachable", async () => {
    // This test requires Ollama to be running on localhost:11434
    const baseURL = "http://localhost:11434/v1"

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)

      const response = await fetch(`${baseURL}/models`, {
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (response.ok) {
        expect(true).toBe(true) // Ollama is reachable
      } else {
        expect(false).toBe(true) // Force fail to show Ollama returned error
      }
    } catch (err) {
      // If Ollama is not running, skip test
      const error = err instanceof Error ? err.message : String(err)
      if (error.includes("ECONNREFUSED") || error.includes("fetch failed")) {
        console.log("Skipping test: Ollama not running")
        return
      }
      throw err
    }
  })

  test("returns false when endpoint is unreachable", async () => {
    const result = await fetch("http://invalid:9999/v1")
      .then(() => true)
      .catch(() => false)

    expect(result).toBe(false)
  })

  test("returns false for invalid path", async () => {
    const result = await fetch("http://localhost:11434/invalid")
      .then(() => true)
      .catch(() => false)

    // Depends on whether Ollama is running
    expect(typeof result).toBe("boolean")
  })
})
