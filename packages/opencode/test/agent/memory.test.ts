import { describe, expect, test } from "bun:test"
import path from "path"
import { AgentMemory } from "../../src/agent/memory"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

describe("AgentMemory", () => {
  test("read returns undefined when no memory exists", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const result = AgentMemory.read("nonexistent-agent")
        expect(result).toBeUndefined()
      },
    })
  })

  test("write creates new memory entry", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        AgentMemory.write("test-writer", "some learned patterns")
        const result = AgentMemory.read("test-writer")

        expect(result).toBeDefined()
        expect(result!.agent).toBe("test-writer")
        expect(result!.content).toBe("some learned patterns")
      },
    })
  })

  test("write updates existing memory", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        AgentMemory.write("updater", "version 1")
        AgentMemory.write("updater", "version 2")

        const result = AgentMemory.read("updater")
        expect(result!.content).toBe("version 2")
      },
    })
  })

  test("write emits Updated event", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        let received: { agent: string; projectID: string } | undefined
        const unsub = Bus.subscribe(AgentMemory.Event.Updated, (e) => {
          received = e.properties
        })
        AgentMemory.write("evt-agent", "data")
        await new Promise((r) => setTimeout(r, 50))
        unsub()

        expect(received).toBeDefined()
        expect(received!.agent).toBe("evt-agent")
      },
    })
  })

  test("append creates memory if none exists", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        AgentMemory.append("appender-new", "first line")
        const result = AgentMemory.read("appender-new")
        expect(result!.content).toBe("first line")
      },
    })
  })

  test("append adds to existing memory", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        AgentMemory.write("appender", "line 1")
        AgentMemory.append("appender", "line 2")

        const result = AgentMemory.read("appender")
        expect(result!.content).toBe("line 1\n\nline 2")
      },
    })
  })

  test("write truncates content exceeding 100KB", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const big = "x".repeat(200_000)
        AgentMemory.write("big-agent", big)

        const result = AgentMemory.read("big-agent")
        expect(result).toBeDefined()
        expect(Buffer.byteLength(result!.content, "utf8")).toBeLessThanOrEqual(102_400)
      },
    })
  })

  test("memory is scoped per agent", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        AgentMemory.write("agent-a", "data for a")
        AgentMemory.write("agent-b", "data for b")

        expect(AgentMemory.read("agent-a")!.content).toBe("data for a")
        expect(AgentMemory.read("agent-b")!.content).toBe("data for b")
      },
    })
  })
})
