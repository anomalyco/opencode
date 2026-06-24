import { describe, it, expect, afterEach } from "bun:test"
import { NeuralLink } from "@/terminal/bridge/NeuralLink"
import { GlobalBus } from "@/bus/global"

describe("NeuralLink", () => {
  let capturedWrites: string[] = []

  const makeLink = (): NeuralLink => {
    capturedWrites = []
    const channel = new (class {
      write(data: Uint8Array | string): boolean {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data)
        capturedWrites.push(text)
        return true
      }
    })()
    // Use constructor injection via the output parameter
    const link = new NeuralLink(40, 10, channel as any)
    return link
  }

  afterEach(() => {
    capturedWrites = []
  })

  describe("forward path", () => {
    it("writeAIText captures summary", () => {
      const link = makeLink()
      link.writeAIText("Hello World")
      const summary = link.getScreenSummary()
      expect(summary).toContain("Hello World")
    })

    it("writeAI with bytes captures summary", () => {
      const link = makeLink()
      const bytes = new TextEncoder().encode("Test Content")
      link.writeAI(bytes)
      const summary = link.getScreenSummary()
      expect(summary).toContain("Test Content")
    })

    it("multiple writes produce multiple summaries", () => {
      const link = makeLink()
      link.writeAIText("First")
      link.writeAIText("Second")
      link.writeAIText("Third")
      const summaries = link.getRecentSummaries(3)
      expect(summaries).toHaveLength(3)
    })

    it("empty text produces no dirty lines", () => {
      const link = makeLink()
      link.writeAIText("")
      const summary = link.getScreenSummary()
      expect(summary).toContain("no recent changes")
    })
  })

  describe("backward path", () => {
    it("getScreenSummary returns descriptive text for no output", () => {
      const link = makeLink()
      const summary = link.getScreenSummary()
      expect(summary).toContain("no output yet")
    })

    it("getRecentSummaries returns array of summaries", () => {
      const link = makeLink()
      link.writeAIText("Test")
      const summaries = link.getRecentSummaries(1)
      expect(summaries).toHaveLength(1)
      expect(summaries[0].lines[0]).toContain("L1:")
    })
  })

  describe("GlobalBus integration", () => {
    it("startListening and stopListening do not throw", () => {
      const link = makeLink()
      expect(() => link.startListening()).not.toThrow()
      expect(() => link.stopListening()).not.toThrow()
    })

    it("handles session.next.text.ended events", () => {
      const link = makeLink()
      link.startListening()

      GlobalBus.emit("event", {
        payload: {
          type: "session.next.text.ended",
          properties: { text: "GlobalBus content test" },
        },
      })

      // Wait for async processing
      const summary = link.getScreenSummary()
      expect(summary).toContain("GlobalBus")

      link.stopListening()
    })

    it("stopListening prevents further events", () => {
      const link = makeLink()
      link.startListening()
      link.stopListening()

      GlobalBus.emit("event", {
        payload: {
          type: "session.next.text.ended",
          properties: { text: "Should not appear" },
        },
      })

      const events = link.getRecentSummaries(10)
      // Should only have events from before stopListening
      expect(events.length).toBe(0)
    })

    it("ignores non-text events", () => {
      const link = makeLink()
      link.startListening()

      GlobalBus.emit("event", {
        payload: {
          type: "session.step.started",
          properties: { step: 1 },
        },
      })

      // Should still show "no output" since no text events were received
      const summary = link.getScreenSummary()
      expect(summary).toContain("no output")

      link.stopListening()
    })
  })

  describe("resize", () => {
    it("resize does not throw", () => {
      const link = makeLink()
      expect(() => link.resize(120, 40)).not.toThrow()
    })
  })
})
