import { describe, expect, test } from "bun:test"
import type { WorkflowRun } from "@opencode-ai/sdk/v2"
import {
  questionOptions,
  selectedAnswer,
  isResumeAnswer,
  shouldEnableNav,
} from "../../../../src/component/dialog-workflow-question-helpers"

function run(id: string): WorkflowRun {
  return { id, workflow: "demo", status: "running", started_at: 1, logs: [], agents: [] }
}

describe("questionOptions", () => {
  test("declared options plus a free-text sentinel", () => {
    const opts = questionOptions({ question: "Pick", options: ["a", "b"], asked_at: 1 })
    expect(opts.map((o) => o.kind)).toEqual(["option", "option", "freetext"])
    expect(opts[0].label).toBe("a")
  })
  test("no declared options yields only the free-text entry", () => {
    expect(questionOptions({ question: "Q", asked_at: 1 }).map((o) => o.kind)).toEqual(["freetext"])
  })
})

describe("selectedAnswer", () => {
  test("an option selection returns the option text, ignoring the free-text field", () => {
    const opts = questionOptions({ question: "Q", options: ["yes", "no"], asked_at: 1 })
    expect(selectedAnswer(opts, 1, "typed but unused")).toBe("no")
  })
  test("the free-text entry returns the typed text trimmed", () => {
    const opts = questionOptions({ question: "Q", options: ["yes"], asked_at: 1 })
    expect(selectedAnswer(opts, 1, "  custom  ")).toBe("custom")
  })
  test("empty free-text returns undefined (nothing to submit)", () => {
    const opts = questionOptions({ question: "Q", asked_at: 1 })
    expect(selectedAnswer(opts, 0, "   ")).toBeUndefined()
  })
})

describe("shouldEnableNav (scope the option-list nav keys)", () => {
  test("nav is enabled when there is a declared option besides the free-text entry", () => {
    expect(shouldEnableNav(questionOptions({ question: "Q", options: ["yes", "no"], asked_at: 1 }))).toBe(true)
  })
  test("nav is disabled for a free-text-only question (the lone entry — arrows belong to the textarea)", () => {
    expect(shouldEnableNav(questionOptions({ question: "Q", asked_at: 1 }))).toBe(false)
  })
  test("an empty option list disables nav", () => {
    expect(shouldEnableNav([])).toBe(false)
  })
})

describe("isResumeAnswer", () => {
  test("answering a parked (paused) run yields a NEW run id => resume to follow", () => {
    expect(isResumeAnswer("job_src", run("job_new"))).toBe(true)
  })
  test("answering a live run resolves in place (same id) => not a resume", () => {
    expect(isResumeAnswer("job_src", run("job_src"))).toBe(false)
  })
})
