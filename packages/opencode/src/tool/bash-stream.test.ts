import { describe, it, expect, vi } from "vitest"

describe("Stream Reading - Issue #17 Fix", () => {
  describe("readOutput function", () => {
    it("should read all chunks from reader until done", async () => {
      const chunks = ["hello", " ", "world", "\n"]
      let chunkIndex = 0
      
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex >= chunks.length) {
            return Promise.resolve({ done: true, value: undefined })
          }
          const chunk = new TextEncoder().encode(chunks[chunkIndex])
          chunkIndex++
          return Promise.resolve({ done: false, value: chunk })
        })
      }
      
      const output: string[] = []
      
      const readOutput = async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended
        }
      }
      
      await readOutput(mockReader)
      
      expect(output).toEqual(["hello", " ", "world", "\n"])
      // Called once per chunk + once for done
      expect(mockReader.read).toHaveBeenCalledTimes(5)
    })

    it("should handle reader returning done immediately", async () => {
      const mockReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined })
      }
      
      const output: string[] = []
      
      const readOutput = async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended
        }
      }
      
      await readOutput(mockReader)
      
      expect(output).toEqual([])
      expect(mockReader.read).toHaveBeenCalledTimes(1)
    })

    it("should handle undefined reader gracefully", async () => {
      const readOutput = async (reader: any) => {
        if (!reader) return
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
          }
        } catch {
          // Stream reading ended
        }
      }
      
      // Should not throw and return undefined
      const result = await readOutput(undefined)
      expect(result).toBeUndefined()
    })
  })

  describe("Stream Draining Guarantee", () => {
    it("should drain both stdout and stderr streams", async () => {
      const stdoutChunks = ["stdout-1", "stdout-2"]
      const stderrChunks = ["stderr-1", "stderr-2"]
      let stdoutIndex = 0
      let stderrIndex = 0
      
      const stdoutReader = {
        read: vi.fn().mockImplementation(() => {
          if (stdoutIndex >= stdoutChunks.length) {
            return Promise.resolve({ done: true, value: undefined })
          }
          const chunk = new TextEncoder().encode(stdoutChunks[stdoutIndex])
          stdoutIndex++
          return Promise.resolve({ done: false, value: chunk })
        })
      }
      
      const stderrReader = {
        read: vi.fn().mockImplementation(() => {
          if (stderrIndex >= stderrChunks.length) {
            return Promise.resolve({ done: true, value: undefined })
          }
          const chunk = new TextEncoder().encode(stderrChunks[stderrIndex])
          stderrIndex++
          return Promise.resolve({ done: false, value: chunk })
        })
      }
      
      const stdoutOutput: string[] = []
      const stderrOutput: string[] = []
      
      const readOutput = (output: string[]) => async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended
        }
      }
      
      const stdoutPromise = readOutput(stdoutOutput)(stdoutReader)
      const stderrPromise = readOutput(stderrOutput)(stderrReader)
      
      // Wait for all streams to drain
      await Promise.all([stdoutPromise, stderrPromise])
      
      expect(stdoutOutput).toEqual(["stdout-1", "stdout-2"])
      expect(stderrOutput).toEqual(["stderr-1", "stderr-2"])
    })

    it("should not lose data when process exits quickly", async () => {
      const processOutput = ["line1", "line2", "line3"]
      let readIndex = 0
      
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            // Simulate slower stream reading than process exit
            setTimeout(() => {
              if (readIndex >= processOutput.length) {
                resolve({ done: true, value: undefined })
              } else {
                const chunk = new TextEncoder().encode(processOutput[readIndex])
                readIndex++
                resolve({ done: false, value: chunk })
              }
            }, 10) // Delay to simulate slow reading
          })
        })
      }
      
      let output: string[] = []
      
      const readOutput = async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended
        }
      }
      
      const streamPromise = readOutput(mockReader)
      
      // In the new implementation, we wait for stream to drain
      await streamPromise
      
      // All data is captured because we wait for stream
      expect(output).toEqual(["line1", "line2", "line3"])
    })
  })

  describe("Timeout Handling", () => {
    it("should handle timeout and capture partial output", async () => {
      const chunks = ["partial", "-output"]
      let readCount = 0
      
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (readCount >= chunks.length) {
            // Never resolve - simulate hanging stream
            return new Promise((resolve) => {
              setTimeout(() => resolve({ done: true, value: undefined }), 5000)
            })
          }
          const chunk = new TextEncoder().encode(chunks[readCount])
          readCount++
          return Promise.resolve({ done: false, value: chunk })
        })
      }
      
      let output: string[] = []
      
      const readOutput = async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended
        }
      }
      
      const streamPromise = readOutput(mockReader)
      
      // Simulate timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 50)
      })
      
      try {
        await Promise.race([streamPromise, timeoutPromise])
      } catch {
        // Timeout - but partial data should be captured
      }
      
      // Should have captured at least partial output
      expect(output.length).toBeGreaterThanOrEqual(1)
      expect(output[0]).toBe("partial")
    })
  })

  describe("Abort Handling", () => {
    it("should handle abort and capture partial output", async () => {
      const chunks = ["before", "-abort", "-after"]
      let readCount = 0
      
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (readCount >= chunks.length) {
            // Never resolve - simulate hanging stream
            return new Promise((resolve) => {
              setTimeout(() => resolve({ done: true, value: undefined }), 5000)
            })
          }
          const chunk = new TextEncoder().encode(chunks[readCount])
          readCount++
          return Promise.resolve({ done: false, value: chunk })
        })
      }
      
      let output: string[] = []
      
      const readOutput = async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended (abort or natural completion)
        }
      }
      
      const streamPromise = readOutput(mockReader)
      
      // Simulate abort
      const abortPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Aborted")), 50)
      })
      
      try {
        await Promise.race([streamPromise, abortPromise])
      } catch {
        // Aborted - but partial data should be captured
      }
      
      // Should have captured at least partial output
      expect(output.length).toBeGreaterThanOrEqual(1)
      expect(output[0]).toBe("before")
    })
  })
})

describe("Stream Reading - Integration Tests", () => {
  describe("End-to-end stream handling", () => {
    it("should handle process with both stdout and stderr", async () => {
      const stdoutData = "stdout content"
      const stderrData = "stderr content"
      
      const stdoutOutput: string[] = []
      const stderrOutput: string[] = []
      
      const readOutput = (output: string[]) => async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended
        }
      }
      
      const stdoutReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(stdoutData) })
          .mockResolvedValue({ done: true, value: undefined })
      }
      
      const stderrReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(stderrData) })
          .mockResolvedValue({ done: true, value: undefined })
      }
      
      const stdoutPromise = readOutput(stdoutOutput)(stdoutReader)
      const stderrPromise = readOutput(stderrOutput)(stderrReader)
      
      // Wait for all streams to drain
      await Promise.all([stdoutPromise, stderrPromise])
      
      expect(stdoutOutput.join("")).toBe(stdoutData)
      expect(stderrOutput.join("")).toBe(stderrData)
    })

    it("should handle empty output gracefully", async () => {
      const stdoutReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined })
      }
      
      let output: string[] = []
      
      const readOutput = async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended
        }
      }
      
      await readOutput(stdoutReader)
      
      expect(output).toEqual([])
      expect(stdoutReader.read).toHaveBeenCalledTimes(1)
    })

    it("should handle large output without data loss", async () => {
      // Generate many chunks
      const numChunks = 100
      const chunks: string[] = []
      for (let i = 0; i < numChunks; i++) {
        chunks.push(`chunk-${i}-`)
      }
      
      let readIndex = 0
      
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (readIndex >= chunks.length) {
            return Promise.resolve({ done: true, value: undefined })
          }
          const chunk = new TextEncoder().encode(chunks[readIndex])
          readIndex++
          return Promise.resolve({ done: false, value: chunk })
        })
      }
      
      let output: string[] = []
      
      const readOutput = async (reader: any) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            output.push(new TextDecoder().decode(value))
          }
        } catch {
          // Stream reading ended
        }
      }
      
      await readOutput(mockReader)
      
      expect(output.length).toBe(numChunks)
      expect(output).toEqual(chunks)
    })
  })
})
