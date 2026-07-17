import { expect, test } from "bun:test"
import type { PromptRef } from "../../../src/component/prompt"
import type { PromptInfo } from "../../../src/component/prompt/history"
import { createStartupPrompt } from "../../../src/component/prompt/startup"

function promptRef(input: {
  current(): PromptInfo
  set(value: PromptInfo): void
  submit(): void
}): PromptRef {
  return {
    get current() {
      return input.current()
    },
    get focused() {
      return false
    },
    set: input.set,
    submit: input.submit,
    reset() {},
    blur() {},
    focus() {},
  }
}

test("seeds and submits a startup prompt exactly once after readiness", () => {
  const calls = {
    set: 0,
    submit: 0,
  }
  let current: PromptInfo = { input: "", parts: [] }
  const ref = promptRef({
    current: () => current,
    set(value) {
      calls.set++
      current = value
    },
    submit() {
      calls.submit++
    },
  })
  const startup = createStartupPrompt({ input: "continue the work", parts: [] })

  startup.bind(ref)
  startup.bind(ref)
  startup.submitWhenReady(false)
  startup.submitWhenReady(true)
  startup.submitWhenReady(true)

  expect(calls).toEqual({ set: 1, submit: 1 })
})

test("does not submit after the seeded prompt has been edited", () => {
  let current: PromptInfo = { input: "", parts: [] }
  let submits = 0
  const ref = promptRef({
    current: () => current,
    set(value) {
      current = value
    },
    submit() {
      submits++
    },
  })
  const startup = createStartupPrompt({ input: "continue the work", parts: [] })

  startup.bind(ref)
  current = { input: "user edit", parts: [] }
  startup.submitWhenReady(true)

  expect(submits).toBe(0)
})
