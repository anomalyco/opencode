import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"

type SessionState = {
  sessionId: string | null
  agentName: string | null
  modes: SessionModeState | null
  models: unknown
  client: unknown
  authMethods: unknown[] | null
}

type SessionModeState = {
  currentModeId: string
  availableModes: { id: string; name: string }[]
}

const createReadonlyModes = (id: string): SessionModeState => {
  const modes: SessionModeState = {
    currentModeId: id,
    availableModes: [{ id, name: `Mode ${id}` }],
  }
  Object.defineProperty(modes, "currentModeId", {
    value: id,
    writable: false,
    enumerable: true,
    configurable: true,
  })
  return modes
}

describe("local session store updates", () => {
  test("naive merge throws when replacing readonly session state", () => {
    const initialModes = createReadonlyModes("first")
    const nextModes = createReadonlyModes("second")

    const [, setSessionStore] = createStore<SessionState>({
      sessionId: "1",
      agentName: "first",
      modes: initialModes,
      models: null,
      client: null,
      authMethods: [],
    })

    expect(() => setSessionStore("modes", nextModes)).toThrow(/readonly/i)
  })

  test("replacing the whole tree avoids readonly assignment errors", () => {
    const initialModes = createReadonlyModes("first")
    const nextModes = createReadonlyModes("second")

    const [, setSessionStore] = createStore<SessionState>({
      sessionId: "1",
      agentName: "first",
      modes: initialModes,
      models: null,
      client: null,
      authMethods: [],
    })

    expect(() =>
      setSessionStore({
        sessionId: "2",
        agentName: "second",
        modes: nextModes,
        models: null,
        client: null,
        authMethods: [],
      }),
    ).not.toThrow()
  })
})
