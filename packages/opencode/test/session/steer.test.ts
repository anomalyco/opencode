import { describe, expect, test, beforeEach } from "bun:test"
import path from "path"
import { SessionSteer } from "../../src/session/steer"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
const SESSION = "session_test_steer_001"
Log.init({ print: false })

/** Helper to run a test function inside Instance.provide context */
function withInstance(fn: () => void | Promise<void>) {
  return Instance.provide({
    directory: projectRoot,
    fn: async () => {
      await fn()
    },
  })
}

describe("SessionSteer", () => {
  describe("push", () => {
    test("creates a queued message with default mode 'queue'", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        const msg = SessionSteer.push(SESSION, "hello")
        expect(msg.text).toBe("hello")
        expect(msg.mode).toBe("queue")
        expect(msg.id).toBeTruthy()
        expect(msg.time).toBeGreaterThan(0)
      })
    })

    test("accepts explicit mode 'steer'", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        const msg = SessionSteer.push(SESSION, "redirect", "steer")
        expect(msg.text).toBe("redirect")
        expect(msg.mode).toBe("steer")
      })
    })

    test("accepts explicit mode 'queue'", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        const msg = SessionSteer.push(SESSION, "later", "queue")
        expect(msg.mode).toBe("queue")
      })
    })
  })

  describe("take", () => {
    test("drains all messages regardless of mode", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "a", "queue")
        SessionSteer.push(SESSION, "b", "steer")
        SessionSteer.push(SESSION, "c", "queue")

        const taken = SessionSteer.take(SESSION)
        expect(taken).toHaveLength(3)
        expect(taken.map((m) => m.text)).toEqual(["a", "b", "c"])
        expect(SessionSteer.list(SESSION)).toHaveLength(0)
      })
    })

    test("returns empty array when no messages", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        expect(SessionSteer.take(SESSION)).toEqual([])
      })
    })
  })

  describe("takeByMode", () => {
    test("drains only 'steer' messages, leaving 'queue' messages", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "queued-1", "queue")
        SessionSteer.push(SESSION, "steer-1", "steer")
        SessionSteer.push(SESSION, "queued-2", "queue")
        SessionSteer.push(SESSION, "steer-2", "steer")

        const steered = SessionSteer.takeByMode(SESSION, "steer")
        expect(steered).toHaveLength(2)
        expect(steered.map((m) => m.text)).toEqual(["steer-1", "steer-2"])

        const remaining = SessionSteer.list(SESSION)
        expect(remaining).toHaveLength(2)
        expect(remaining.map((m) => m.text)).toEqual(["queued-1", "queued-2"])
      })
    })

    test("drains only 'queue' messages, leaving 'steer' messages", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "queued-1", "queue")
        SessionSteer.push(SESSION, "steer-1", "steer")
        SessionSteer.push(SESSION, "queued-2", "queue")

        const queued = SessionSteer.takeByMode(SESSION, "queue")
        expect(queued).toHaveLength(2)
        expect(queued.map((m) => m.text)).toEqual(["queued-1", "queued-2"])

        const remaining = SessionSteer.list(SESSION)
        expect(remaining).toHaveLength(1)
        expect(remaining[0].text).toBe("steer-1")
      })
    })

    test("returns empty when no messages match mode", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "queued", "queue")
        const steered = SessionSteer.takeByMode(SESSION, "steer")
        expect(steered).toEqual([])
        expect(SessionSteer.list(SESSION)).toHaveLength(1)
      })
    })

    test("returns empty when buffer is empty", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        expect(SessionSteer.takeByMode(SESSION, "steer")).toEqual([])
        expect(SessionSteer.takeByMode(SESSION, "queue")).toEqual([])
      })
    })

    test("sequential takeByMode drains both modes completely", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "s1", "steer")
        SessionSteer.push(SESSION, "q1", "queue")
        SessionSteer.push(SESSION, "s2", "steer")
        SessionSteer.push(SESSION, "q2", "queue")

        const steered = SessionSteer.takeByMode(SESSION, "steer")
        expect(steered).toHaveLength(2)

        const queued = SessionSteer.takeByMode(SESSION, "queue")
        expect(queued).toHaveLength(2)

        expect(SessionSteer.has(SESSION)).toBe(false)
        expect(SessionSteer.list(SESSION)).toHaveLength(0)
      })
    })
  })

  describe("has", () => {
    test("returns false for empty session", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        expect(SessionSteer.has(SESSION)).toBe(false)
      })
    })

    test("returns true after push", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "test")
        expect(SessionSteer.has(SESSION)).toBe(true)
      })
    })

    test("returns false after take drains all", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "test")
        SessionSteer.take(SESSION)
        expect(SessionSteer.has(SESSION)).toBe(false)
      })
    })

    test("returns true when takeByMode leaves remaining", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "q", "queue")
        SessionSteer.takeByMode(SESSION, "steer")
        expect(SessionSteer.has(SESSION)).toBe(true)
      })
    })
  })

  describe("list", () => {
    test("returns current queue without draining", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "a", "queue")
        SessionSteer.push(SESSION, "b", "steer")

        const first = SessionSteer.list(SESSION)
        expect(first).toHaveLength(2)

        const second = SessionSteer.list(SESSION)
        expect(second).toHaveLength(2)
      })
    })
  })

  describe("remove", () => {
    test("removes specific message by id", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        const msg = SessionSteer.push(SESSION, "target", "steer")
        SessionSteer.push(SESSION, "keep", "queue")

        const removed = SessionSteer.remove(SESSION, msg.id)
        expect(removed).toBe(true)
        expect(SessionSteer.list(SESSION)).toHaveLength(1)
        expect(SessionSteer.list(SESSION)[0].text).toBe("keep")
      })
    })

    test("returns false for non-existent id", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "test")
        expect(SessionSteer.remove(SESSION, "nonexistent")).toBe(false)
      })
    })
  })

  describe("clear", () => {
    test("removes all pending messages", async () => {
      await withInstance(() => {
        SessionSteer.clear(SESSION)
        SessionSteer.push(SESSION, "a", "queue")
        SessionSteer.push(SESSION, "b", "steer")
        SessionSteer.clear(SESSION)
        expect(SessionSteer.has(SESSION)).toBe(false)
        expect(SessionSteer.list(SESSION)).toHaveLength(0)
      })
    })
  })
})
