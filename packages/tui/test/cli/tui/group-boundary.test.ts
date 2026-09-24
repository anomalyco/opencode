import { expect, test } from "bun:test"
import { completeGroupBoundary, type SessionRow } from "../../../src/routes/session/rows"

const group: SessionRow = { type: "group", kind: "reasoning", children: [], size: 0, completed: true }
const prompt: SessionRow = { type: "message", messageID: "msg_user" }

// Each page is the number of older messages it adds and whether it reaches the prompt
// preceding the group. Pages inside the group merge into the existing first row.
function history(pages: { messages: number; prompt?: boolean }[], first: SessionRow = group) {
  const rows: SessionRow[] = [first]
  let count = 1
  let loads = 0
  let active = true
  return {
    rows,
    loads: () => loads,
    deactivate: () => (active = false),
    input: (after?: () => void) => ({
      rows,
      messages: () => count,
      more: () => loads < pages.length,
      loadMore: async () => {
        const page = pages[loads++]
        count += page.messages
        if (page.prompt) rows.unshift(prompt)
        after?.()
      },
      active: () => active,
    }),
  }
}

test("keeps loading while the oldest row is a group", async () => {
  const state = history([{ messages: 20 }, { messages: 20 }, { messages: 5, prompt: true }, { messages: 20 }])
  await completeGroupBoundary(state.input())
  expect(state.loads()).toBe(3)
  expect(state.rows[0]).toBe(prompt)
})

test("does not load when the oldest row cannot continue into older history", async () => {
  const state = history([{ messages: 20 }], prompt)
  await completeGroupBoundary(state.input())
  expect(state.loads()).toBe(0)
})

test("stops at the beginning of history", async () => {
  const state = history([{ messages: 20 }, { messages: 3 }])
  await completeGroupBoundary(state.input())
  expect(state.loads()).toBe(2)
  expect(state.rows[0]).toBe(group)
})

test("stops when a page adds no messages", async () => {
  const state = history([{ messages: 0 }, { messages: 20 }])
  await completeGroupBoundary(state.input())
  expect(state.loads()).toBe(1)
})

test("stops when the session is no longer active", async () => {
  const state = history([{ messages: 20 }, { messages: 20 }, { messages: 1, prompt: true }])
  await completeGroupBoundary(state.input(() => state.deactivate()))
  expect(state.loads()).toBe(1)
})
