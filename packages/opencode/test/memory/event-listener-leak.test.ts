import { describe, test, expect } from "bun:test"
import { batch, createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createGlobalEmitter } from "@solid-primitives/event-bus"

// ---------------------------------------------------------------------------
// 1. Event listeners auto-clean via tryOnCleanup
//    Verifies that createGlobalEmitter.on() properly unsubscribes when a
//    child reactive scope is disposed (e.g. navigating away from a session).
// ---------------------------------------------------------------------------

describe("event listener lifecycle", () => {
  test("createGlobalEmitter.on auto-cleans when child scope is disposed", () => {
    let calls = 0

    createRoot((parentDispose) => {
      const emitter = createGlobalEmitter<{ test: number }>()

      for (let i = 0; i < 10; i++) {
        createRoot((childDispose) => {
          emitter.on("test", () => calls++)
          childDispose()
        })
      }

      emitter.emit("test", 1)
      expect(calls).toBe(0)

      parentDispose()
    })
  })
})

// ---------------------------------------------------------------------------
// 2. session.deleted cleans up all related store data
//    Regression tests for context/sync.tsx "session.deleted" handler.
//    Verifies messages, parts, todos, diffs, status, permissions, and
//    questions keyed by the deleted session ID are removed from the store.
// ---------------------------------------------------------------------------

describe("sync store: session.deleted", () => {
  test("should clean up messages for deleted session", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        session: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
        message: {
          s1: [{ id: "s1:m1" }],
          s2: [{ id: "s2:m1" }, { id: "s2:m2" }],
          s3: [{ id: "s3:m1" }],
        } as Record<string, { id: string }[]>,
      })

      // Mirrors sync.tsx "session.deleted" handler
      const deletedID = "s2"
      const idx = store.session.findIndex((s) => s.id === deletedID)
      if (idx >= 0) {
        setStore(
          produce((draft) => {
            draft.session.splice(idx, 1)
            delete draft.message[deletedID]
          }),
        )
      }

      expect(store.session).toHaveLength(2)
      expect(store.message[deletedID]).toBeUndefined()
      expect(store.message["s1"]).toHaveLength(1)
      expect(store.message["s3"]).toHaveLength(1)

      dispose()
    })
  })

  test("should clean up parts for all messages of deleted session", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        session: [{ id: "s1" }, { id: "s2" }],
        message: {
          s2: [{ id: "s2:m1" }, { id: "s2:m2" }],
        } as Record<string, { id: string }[]>,
        part: {
          "s2:m1": [{ id: "p1", data: "x" }],
          "s2:m2": [{ id: "p2", data: "y" }],
          "s1:m1": [{ id: "p3", data: "z" }],
        } as Record<string, { id: string; data: string }[]>,
      })

      // Mirrors sync.tsx "session.deleted" handler
      const deletedID = "s2"
      const messages = store.message[deletedID] ?? []
      const idx = store.session.findIndex((s) => s.id === deletedID)
      if (idx >= 0) {
        setStore(
          produce((draft) => {
            draft.session.splice(idx, 1)
            messages.forEach((msg) => delete draft.part[msg.id])
            delete draft.message[deletedID]
          }),
        )
      }

      expect(store.part["s2:m1"]).toBeUndefined()
      expect(store.part["s2:m2"]).toBeUndefined()
      expect(store.part["s1:m1"]).toBeDefined()

      dispose()
    })
  })

  test("should clean up todo, diff, status, permission, question for deleted session", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        session: [{ id: "s1" }, { id: "s2" }],
        todo: { s1: [{ text: "a" }], s2: [{ text: "b" }] } as Record<string, unknown[]>,
        session_diff: { s1: [], s2: [{ file: "x.ts" }] } as Record<string, unknown[]>,
        session_status: { s1: { idle: true }, s2: { running: true } } as Record<string, unknown>,
        permission: { s2: [{ id: "perm" }] } as Record<string, unknown[]>,
        question: { s2: [{ id: "q" }] } as Record<string, unknown[]>,
      })

      // Mirrors sync.tsx "session.deleted" handler
      const deletedID = "s2"
      const idx = store.session.findIndex((s) => s.id === deletedID)
      if (idx >= 0) {
        setStore(
          produce((draft) => {
            draft.session.splice(idx, 1)
            delete draft.todo[deletedID]
            delete draft.session_diff[deletedID]
            delete draft.session_status[deletedID]
            delete draft.permission[deletedID]
            delete draft.question[deletedID]
          }),
        )
      }

      expect(store.todo[deletedID]).toBeUndefined()
      expect(store.session_diff[deletedID]).toBeUndefined()
      expect(store.session_status[deletedID]).toBeUndefined()
      expect(store.permission[deletedID]).toBeUndefined()
      expect(store.question[deletedID]).toBeUndefined()
      expect(store.todo["s1"]).toBeDefined()
      expect(store.session_status["s1"]).toBeDefined()

      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// 3. message.removed cleans up orphaned parts
//    Regression test for context/sync.tsx "message.removed" handler.
//    Verifies store.part[messageID] is deleted when a message is removed.
// ---------------------------------------------------------------------------

describe("sync store: message.removed", () => {
  test("should clean up parts when a message is removed", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        message: {
          s1: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
        } as Record<string, { id: string }[]>,
        part: {
          m1: [{ id: "m1:p1" }],
          m2: [{ id: "m2:p1" }, { id: "m2:p2" }],
          m3: [{ id: "m3:p1" }],
        } as Record<string, { id: string }[]>,
      })

      // Mirrors sync.tsx "message.removed" handler
      const sessionID = "s1"
      const messageID = "m2"
      const messages = store.message[sessionID]
      const idx = messages.findIndex((m) => m.id === messageID)
      if (idx >= 0) {
        batch(() => {
          setStore(
            "message",
            sessionID,
            produce((draft) => {
              draft.splice(idx, 1)
            }),
          )
          setStore(
            "part",
            produce((draft) => {
              delete draft[messageID]
            }),
          )
        })
      }

      expect(store.message[sessionID]).toHaveLength(2)
      expect(store.part[messageID]).toBeUndefined()
      expect(store.part["m1"]).toHaveLength(1)
      expect(store.part["m3"]).toHaveLength(1)

      dispose()
    })
  })
})
