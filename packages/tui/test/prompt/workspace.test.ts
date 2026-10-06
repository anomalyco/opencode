import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createTimedNotice } from "../../src/component/prompt/workspace"

test("a later notice is not cleared by an earlier timer", () => {
  const timers = new Map<number, () => void>()
  let id = 0
  const result = createRoot((dispose) => {
    const notice = createTimedNotice(4000, {
      setTimeout(callback) {
        id += 1
        timers.set(id, callback)
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout(timer) {
        timers.delete(timer as unknown as number)
      },
    })
    return { notice, dispose }
  })

  result.notice.show("Warped to first")
  const first = id
  result.notice.show("Warped to second")
  const second = id

  expect(timers.has(first)).toBe(false)
  timers.get(first)?.()
  expect(result.notice.notice()).toBe("Warped to second")

  timers.get(second)?.()
  expect(result.notice.notice()).toBeUndefined()
  result.dispose()
})
