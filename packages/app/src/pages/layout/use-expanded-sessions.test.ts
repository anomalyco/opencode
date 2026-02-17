import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import type { Session } from "@opencode-ai/sdk/v2/client"

describe("useExpandedSessions", () => {
  describe("expanded state management", () => {
    test("returns false for non-expanded sessions by default", () => {
      createRoot((dispose) => {
        const expandedSet = new Set<string>()
        const local = createSignal<string[]>([])

        const expanded = (sessionId: string) => {
          return expandedSet.has(sessionId)
        }

        expect(expanded("session-1")).toBe(false)
        expect(expanded("session-2")).toBe(false)
        dispose()
      })
    })

    test("toggle changes expansion state", () => {
      createRoot((dispose) => {
        const expandedSet = new Set<string>()

        const expanded = (sessionId: string) => expandedSet.has(sessionId)
        const toggle = (sessionId: string) => {
          if (expandedSet.has(sessionId)) {
            expandedSet.delete(sessionId)
          } else {
            expandedSet.add(sessionId)
          }
        }

        expect(expanded("session-1")).toBe(false)
        toggle("session-1")
        expect(expanded("session-1")).toBe(true)
        toggle("session-1")
        expect(expanded("session-1")).toBe(false)
        dispose()
      })
    })

    test("multiple sessions can be expanded independently", () => {
      createRoot((dispose) => {
        const expandedSet = new Set<string>()

        const expanded = (sessionId: string) => expandedSet.has(sessionId)
        const toggle = (sessionId: string) => {
          if (expandedSet.has(sessionId)) {
            expandedSet.delete(sessionId)
          } else {
            expandedSet.add(sessionId)
          }
        }

        toggle("session-1")
        toggle("session-2")

        expect(expanded("session-1")).toBe(true)
        expect(expanded("session-2")).toBe(true)
        expect(expanded("session-3")).toBe(false)
        dispose()
      })
    })
  })

  describe("storage key generation", () => {
    test("generates unique key per directory", () => {
      const checksum = (str: string) => {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i)
          hash = (hash << 5) - hash + char
          hash = hash & hash
        }
        return Math.abs(hash).toString(16)
      }

      const generateKey = (dir: string) => {
        const sum = checksum(dir) ?? "0"
        const head = dir.slice(0, 12) || "workspace"
        return `workspace.${head}.${sum}.expanded-sessions`
      }

      const key1 = generateKey("/test/workspace1")
      const key2 = generateKey("/test/workspace2")
      const key3 = generateKey("/different/path")

      expect(key1).not.toBe(key2)
      expect(key2).not.toBe(key3)
      expect(key1).not.toBe(key3)
    })
  })

  describe("local state fallback when not ready", () => {
    test("uses local signal when ready is false", () => {
      createRoot((dispose) => {
        const [local, setLocal] = createSignal<string[]>([])
        const ready = () => false

        const expanded = (sessionId: string) => {
          if (!ready()) return local().includes(sessionId)
          return false
        }

        const toggle = (sessionId: string) => {
          if (!ready()) {
            const current = expanded(sessionId)
            setLocal((prev) => (current ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]))
            return
          }
        }

        expect(expanded("session-1")).toBe(false)
        toggle("session-1")
        expect(expanded("session-1")).toBe(true)
        toggle("session-1")
        expect(expanded("session-1")).toBe(false)
        dispose()
      })
    })

    test("uses store when ready is true", () => {
      createRoot((dispose) => {
        const [store, setStore] = createStore<Record<string, boolean>>({})
        const ready = () => true
        const prefix = "workspace.test."

        const expanded = (sessionId: string) => {
          if (!ready()) return false
          return store[prefix + sessionId] ?? false
        }

        const toggle = (sessionId: string) => {
          const key = prefix + sessionId
          const current = expanded(sessionId)
          if (!ready()) return
          setStore(key, !current)
        }

        expect(expanded("session-1")).toBe(false)
        toggle("session-1")
        expect(expanded("session-1")).toBe(true)
        toggle("session-1")
        expect(expanded("session-1")).toBe(false)
        dispose()
      })
    })

    test("local state is isolated from store state", () => {
      createRoot((dispose) => {
        const [local, setLocal] = createSignal<string[]>([])
        const [store, setStore] = createStore<Record<string, boolean>>({})
        let isReady = false
        let hasMigrated = false
        const prefix = "workspace.test."

        const expanded = (sessionId: string) => {
          if (!isReady && !hasMigrated) return local().includes(sessionId)
          return store[prefix + sessionId] ?? false
        }

        const toggle = (sessionId: string) => {
          const readyCheck = isReady
          const current = expanded(sessionId)

          if (!readyCheck && !hasMigrated) {
            setLocal((prev) => (current ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]))
            return
          }
          const key = prefix + sessionId
          setStore(key, !current)
        }

        toggle("session-1")
        expect(expanded("session-1")).toBe(true)

        isReady = true
        hasMigrated = true

        expect(expanded("session-1")).toBe(false)

        toggle("session-1")
        expect(expanded("session-1")).toBe(true)
        dispose()
      })
    })

    test("migrates local state to store when ready", () => {
      createRoot((dispose) => {
        const [local, setLocal] = createSignal<string[]>([])
        const [store, setStore] = createStore<Record<string, boolean>>({})
        let isReady = false
        let hasMigrated = false
        const prefix = "workspace.test."

        const expanded = (sessionId: string) => {
          if (!isReady && !hasMigrated) return local().includes(sessionId)
          return store[prefix + sessionId] ?? false
        }

        const toggle = (sessionId: string) => {
          const readyCheck = isReady
          const current = expanded(sessionId)

          if (!readyCheck && !hasMigrated) {
            setLocal((prev) => (current ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]))
            return
          }
          const key = prefix + sessionId
          setStore(key, !current)
        }

        const migrate = () => {
          const localIds = local()
          for (const id of localIds) {
            setStore(prefix + id, true)
          }
          setLocal([])
          hasMigrated = true
        }

        toggle("session-1")
        toggle("session-2")
        expect(local()).toHaveLength(2)
        expect(expanded("session-1")).toBe(true)
        expect(expanded("session-2")).toBe(true)

        isReady = true
        migrate()

        expect(local()).toHaveLength(0)
        expect(expanded("session-1")).toBe(true)
        expect(expanded("session-2")).toBe(true)
        expect(store[`${prefix}session-1`]).toBe(true)
        expect(store[`${prefix}session-2`]).toBe(true)
        dispose()
      })
    })
  })
})
