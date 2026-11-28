import { expect, test } from "bun:test"
import type { ProgramResume } from "@opentui/core"
import { createProgramResume } from "../../src/context/program-resume"

const token = "dummy-token-replace-me"

test("reports the session on screen and clears when none is", () => {
  const resume = setup()
  resume.report(undefined)
  resume.report("ses_a")
  resume.report("ses_a")
  resume.report("ses_b")
  resume.report(undefined)
  resume.report(undefined)
  expect(resume.reports).toEqual([command("ses_a"), command("ses_b"), { token, clear: true }])
})

test("reports the same session again after a suspend", () => {
  const resume = setup()
  resume.again()
  resume.report("ses_a")
  resume.again()
  expect(resume.reports).toEqual([command("ses_a"), command("ses_a")])
})

test("clears once when the user quits, and only if something was reported", () => {
  const empty = setup()
  empty.clear()
  expect(empty.reports).toEqual([])

  const resume = setup()
  resume.report("ses_a")
  resume.clear()
  resume.clear()
  resume.again()
  expect(resume.reports).toEqual([command("ses_a"), { token, clear: true }])
})

test("retries a report that didn't reach the output queue", () => {
  const resume = setup()
  resume.accept = false
  resume.report("ses_a")
  resume.accept = true
  resume.report("ses_a")
  expect(resume.reports).toEqual([command("ses_a")])
})

function setup() {
  const state = { accept: true, reports: [] as ProgramResume[] }
  const resume = createProgramResume({
    token,
    command: "opencode2-node",
    flags: ["--auto"],
    cwd: "/home/user/project",
    renderer: {
      setProgramResume(report) {
        if (state.accept) state.reports.push(report)
        return state.accept
      },
    },
  })
  return Object.assign(state, resume)
}

function command(sessionID: string) {
  return { token, argv: ["opencode2-node", "--session", sessionID, "--auto"], cwd: "/home/user/project" }
}
