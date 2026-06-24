import { describe, it, expect } from "bun:test"
import { formatProgress } from "../src/installation/progress"

describe("Installation Progress", () => {
  describe("formatProgress", () => {
    it("should format checking stage", () => {
      const result = formatProgress({ stage: "checking" })
      expect(result).toBe("Checking for updates...")
    })

    it("should format downloading stage with percentage and speed", () => {
      const result = formatProgress({
        stage: "downloading",
        version: "1.17.0",
        downloaded: 1024 * 1024 * 4.5,
        total: 1024 * 1024 * 10,
        speed: 1024 * 1024 * 2.5,
        percentage: 45,
      })
      expect(result).toContain("Downloading 1.17.0")
      expect(result).toContain("45%")
      expect(result).toContain("10.0 MB")
      expect(result).toContain("2.5 MB/s")
    })

    it("should format downloading stage without speed", () => {
      const result = formatProgress({
        stage: "downloading",
        version: "1.17.0",
        downloaded: 1024 * 1024 * 5,
        total: 1024 * 1024 * 10,
        percentage: 50,
      })
      expect(result).toContain("Downloading 1.17.0")
      expect(result).toContain("50%")
      expect(result).toContain("10.0 MB")
      expect(result).not.toContain("MB/s")
    })

    it("should format installing stage", () => {
      const result = formatProgress({ stage: "installing" })
      expect(result).toBe("Installing...")
    })

    it("should format complete stage", () => {
      const result = formatProgress({ stage: "complete" })
      expect(result).toBe("Upgrade complete")
    })

    it("should format failed stage with message", () => {
      const result = formatProgress({
        stage: "failed",
        message: "Network error occurred",
      })
      expect(result).toBe("Network error occurred")
    })

    it("should format failed stage without message", () => {
      const result = formatProgress({ stage: "failed" })
      expect(result).toBe("Upgrade failed")
    })
  })
})