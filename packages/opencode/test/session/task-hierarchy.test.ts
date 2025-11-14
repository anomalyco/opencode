import { describe, expect, test, mock } from "bun:test"

type Orchestration = {
  depth: number
  status: string
  currentAgent?: string
  pausedMode?: string
  rootAgent?: string
  subtaskResults?: Array<{
    sessionID: string
    summary: string
    result: string
    completedAt: number
  }>
}

type SessionRecord = {
  id: string
  parentID?: string
  title: string
  orchestration?: Orchestration
}

const sessions = new Map<string, SessionRecord>()
let counter = 0

const SessionMock = {
  async create(input?: { parentID?: string; title?: string }) {
    const id = `session-${++counter}`
    const record: SessionRecord = {
      id,
      parentID: input?.parentID,
      title: input?.title ?? id,
    }
    sessions.set(id, record)
    return record
  },
  async get(id: string) {
    const record = sessions.get(id)
    if (!record) throw new Error(`Unknown session ${id}`)
    return record
  },
  async update(id: string, editor: (session: SessionRecord) => void) {
    const record = await SessionMock.get(id)
    editor(record)
    return record
  },
  async children(parentID: string) {
    return Array.from(sessions.values()).filter((session) => session.parentID === parentID)
  },
}

mock.module("../../src/session", () => {
  return {
    Session: SessionMock,
  }
})

function resetSessions() {
  sessions.clear()
  counter = 0
}

async function loadTaskHierarchy() {
  const mod = await import("../../src/session/task-hierarchy")
  return mod.TaskHierarchy
}

describe("TaskHierarchy mode preservation", () => {
  test("restores parent mode captured at pause time", async () => {
    resetSessions()
    const TaskHierarchy = await loadTaskHierarchy()

    const parent = await SessionMock.create({ title: "parent" })
    await SessionMock.update(parent.id, (draft) => {
      draft.orchestration = {
        depth: 0,
        status: "active",
        currentAgent: "general",
        pausedMode: "stale-mode",
        rootAgent: "orchestrator",
      }
    })

    const childID = await TaskHierarchy.createSubtask(parent.id, "general", "child run")

    const pausedParent = await SessionMock.get(parent.id)
    expect(pausedParent.orchestration?.pausedMode).toBe("general")
    expect(pausedParent.orchestration?.status).toBe("paused")

    await TaskHierarchy.completeSubtask(childID, "done")

    const resumed = await SessionMock.get(parent.id)
    expect(resumed.orchestration?.currentAgent).toBe("general")
    expect(resumed.orchestration?.pausedMode).toBeUndefined()
    expect(resumed.orchestration?.status).toBe("active")
    expect(resumed.orchestration?.subtaskResults?.[0]?.sessionID).toBe(childID)
  })
})
