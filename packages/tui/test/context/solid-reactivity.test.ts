import { expect, test } from "bun:test"
import { createRoot, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"

type QuestionRequest = {
  id: string
  sessionID: string
  questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }> }>
}

type Session = { id: string; parentID?: string }

test("Solid store: memo reading existing key recomputes when key is updated (baseline)", () => {
  const root = createRoot((dispose) => {
    const [store, setStore] = createStore<{
      session: Session[]
      question: Record<string, QuestionRequest[]>
    }>({
      session: [{ id: "session-1" }],
      question: {},
    })

    const children = createMemo(() => {
      const parentID = "session-1"
      return store.session
        .filter((x) => x.parentID === parentID || x.id === parentID)
        .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    })

    let recomputeCount = 0
    // This is the actual memo from index.tsx:237-240 — NO Object.keys subscription
    const questions = createMemo(() => {
      recomputeCount++
      return children().flatMap((x) => store.question[x.id] ?? [])
    })

    // children() includes session-1, so questions() reads store.question["session-1"]
    expect(recomputeCount).toBe(1)
    expect(questions()).toEqual([])

    // Add a question for session-1 — the memo read store.question["session-1"]
    // in the previous run (returned undefined), so Solid tracks the property
    // and recomputes when it's set. This DISPROVES the "Solid reactivity gap"
    // hypothesis (Hypothesis B from the original investigation).
    setStore("question", "session-1", [{ id: "req-1", sessionID: "session-1", questions: [] }])
    expect(recomputeCount).toBe(2)
    expect(questions()).toHaveLength(1)
    expect(questions()[0].id).toBe("req-1")

    dispose()
  })
})

test("Root cause: when question.asked SSE is missed, polling question.list recovers the prompt", () => {
  // This reproduces the actual bug: the `question.asked` event is missed (never
  // arrives via SSE), but the `message.part.updated` event for the question
  // tool DOES arrive. The recovery polls question.list and seeds the store.
  const root = createRoot((dispose) => {
    const [store, setStore] = createStore<{
      session: Session[]
      question: Record<string, QuestionRequest[]>
      part: Record<string, Array<{ id: string; type: string; tool?: string; state?: { status: string } }>>
      message: Record<string, Array<{ id: string }>>
    }>({
      session: [{ id: "session-1" }],
      question: {},
      part: {},
      message: { "session-1": [{ id: "msg-1" }] },
    })

    // Simulate: question.asked event NEVER arrives. Store stays empty.
    expect(store.question["session-1"]).toBeUndefined()

    // Simulate the recovery: poll question.list (returns the pending question)
    const listResult = [{ id: "req-1", sessionID: "session-1", questions: [] }] as QuestionRequest[]
    const existing = store.question["session-1"] ?? []
    const merged = [...existing]
    for (const req of listResult) {
      if (!merged.some((r) => r.id === req.id)) merged.push(req)
    }
    setStore("question", "session-1", merged)

    // Now the store has the question — the memo would recompute and QuestionPrompt would render.
    expect(store.question["session-1"]).toHaveLength(1)
    expect(store.question["session-1"][0].id).toBe("req-1")

    dispose()
  })
})

test("Recovery merge is idempotent and doesn't duplicate on re-poll", () => {
  const root = createRoot((dispose) => {
    const [store, setStore] = createStore<{ question: Record<string, QuestionRequest[]> }>({
      question: { "session-1": [{ id: "req-1", sessionID: "session-1", questions: [] }] },
    })

    // Re-poll returns the same question — merge should be idempotent
    const listResult = [{ id: "req-1", sessionID: "session-1", questions: [] }] as QuestionRequest[]
    const existing = store.question["session-1"] ?? []
    const merged = [...existing]
    for (const req of listResult) {
      if (!merged.some((r) => r.id === req.id)) merged.push(req)
    }
    setStore("question", "session-1", merged)

    expect(store.question["session-1"]).toHaveLength(1)

    // A second, different question would be added
    const listResult2 = [
      { id: "req-1", sessionID: "session-1", questions: [] },
      { id: "req-2", sessionID: "session-1", questions: [] },
    ] as QuestionRequest[]
    const existing2 = store.question["session-1"] ?? []
    const merged2 = [...existing2]
    for (const req of listResult2) {
      if (!merged2.some((r) => r.id === req.id)) merged2.push(req)
    }
    setStore("question", "session-1", merged2)

    expect(store.question["session-1"]).toHaveLength(2)

    dispose()
  })
})

test("Cold-start: session opens with a pre-existing pending question (Fix 2 scenario)", () => {
  const root = createRoot((dispose) => {
    const [store] = createStore<{
      session: Session[]
      question: Record<string, QuestionRequest[]>
    }>({
      session: [{ id: "session-1" }],
      question: { "session-1": [{ id: "req-1", sessionID: "session-1", questions: [] }] },
    })

    const children = createMemo(() => {
      const parentID = "session-1"
      return store.session
        .filter((x) => x.parentID === parentID || x.id === parentID)
        .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    })

    const questions = createMemo(() => children().flatMap((x) => store.question[x.id] ?? []))

    expect(questions()).toHaveLength(1)
    expect(questions()[0].id).toBe("req-1")

    dispose()
  })
})
