import { describe, expect, test } from "bun:test"
import {
  parseHeadlessWorkflowArgs,
  workflowExitCode,
  WORKFLOW_PARKED_EXIT_CODE,
  formatParkedQuestion,
  detectUltracodeKeyword,
  stripUltracodeKeyword,
  RUN_ULTRACODE_DIRECTIVE,
} from "../../../src/cli/cmd/run/workflow.shared"

describe("parseHeadlessWorkflowArgs", () => {
  test("parses key=value tokens, keeping quoted values and bare flags", () => {
    expect(parseHeadlessWorkflowArgs(["target=src/", 'msg="a b"', "--verbose"])).toEqual({
      target: "src/",
      msg: "a b",
      verbose: "true",
    })
  })
  test("keeps numeric-looking values as strings (no meta declaration headless)", () => {
    expect(parseHeadlessWorkflowArgs(["version=1.0", "zip=01234"])).toEqual({ version: "1.0", zip: "01234" })
  })
})

describe("workflowExitCode", () => {
  test("completed => 0; failed/cancelled/interrupted => 1; paused => parked code", () => {
    expect(workflowExitCode("completed")).toBe(0)
    expect(workflowExitCode("failed")).toBe(1)
    expect(workflowExitCode("cancelled")).toBe(1)
    expect(workflowExitCode("interrupted")).toBe(1)
    // A run that parked awaiting an answer is its own non-zero outcome, distinct
    // from a plain failure so a caller/script can detect "needs an answer".
    expect(workflowExitCode("paused")).toBe(WORKFLOW_PARKED_EXIT_CODE)
    expect(WORKFLOW_PARKED_EXIT_CODE).not.toBe(0)
    expect(WORKFLOW_PARKED_EXIT_CODE).not.toBe(1)
  })
})

describe("formatParkedQuestion", () => {
  test("includes the question text and a resumable answer command for the run id", () => {
    const message = formatParkedQuestion({
      id: "job_abc123",
      question: "Which environment should I deploy to?",
      options: ["staging", "production"],
    })
    expect(message).toContain("Which environment should I deploy to?")
    expect(message).toContain("job_abc123")
    // The exact resume mechanism: the run stays resumable; answer via the HTTP
    // answer route (no interactive answerer exists in headless mode).
    expect(message).toContain("/workflow/run/job_abc123/answer")
    // Lists the offered options so the operator knows the accepted answers.
    expect(message).toContain("staging")
    expect(message).toContain("production")
  })

  test("omits the options line when none were offered (free-text question)", () => {
    const message = formatParkedQuestion({ id: "job_xyz", question: "Describe the change." })
    expect(message).toContain("Describe the change.")
    expect(message).toContain("job_xyz")
    expect(message.toLowerCase()).not.toContain("options:")
  })
})

// Parity lock against the TUI ultracode module (Delta 6a): same boundary +
// same directive wording, asserted here so drift between the two copies fails.
describe("ultracode parity in the run path", () => {
  test("detects + strips the standalone keyword exactly like the TUI", () => {
    expect(detectUltracodeKeyword("ultracode: audit src/")?.index).toBe(0)
    expect(detectUltracodeKeyword("xultracode")).toBeUndefined()
    expect(stripUltracodeKeyword("ultracode: audit src/")).toBe("audit src/")
  })
  test("the directive opts the turn into workflow orchestration", () => {
    expect(RUN_ULTRACODE_DIRECTIVE).toContain("workflow")
    expect(RUN_ULTRACODE_DIRECTIVE).toContain("create")
  })
})
