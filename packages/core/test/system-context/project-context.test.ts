import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { Effect } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectContext } from "@opencode-ai/core/system-context/project-context"

const runResult = (stdout: string, exitCode = 0): AppProcess.RunResult => ({
  command: "git log",
  exitCode,
  stdout: Buffer.from(stdout),
  stderr: Buffer.alloc(0),
  stdoutTruncated: false,
  stderrTruncated: false,
})

interface FakeDeps {
  proc: AppProcess.Interface
  directory: AbsolutePath
}

const deps = (proc: AppProcess.Interface): FakeDeps => ({
  proc,
  directory: AbsolutePath.make("/repo"),
})

const proc = (run: AppProcess.Interface["run"]): AppProcess.Interface =>
  ({ run, runStream: () => Effect.die("unreachable") } as unknown as AppProcess.Interface)

describe("ProjectContext.parseCommits", () => {
  test("splits subjects and drops blanks", () => {
    expect(ProjectContext.parseCommits("feat: a\n\nbug: b\n")).toEqual(["feat: a", "bug: b"])
  })
})

describe("ProjectContext.render", () => {
  test("renders a numbered baseline and empties to empty string", () => {
    expect(ProjectContext.render(["feat: a", "bug: b"])).toBe("Recent project history:\n1. feat: a\n2. bug: b")
    expect(ProjectContext.render([])).toBe("")
  })
})

describe("ProjectContext.loadHistory", () => {
  test("parses git log subjects on success", async () => {
    const history = await Effect.runPromise(
      ProjectContext.loadHistory(deps(proc(() => Effect.succeed(runResult("feat: a\nbug: b"))))),
    )
    expect(history).toEqual(["feat: a", "bug: b"])
  })

  test("returns [] on a non-git exit code", async () => {
    const history = await Effect.runPromise(
      ProjectContext.loadHistory(deps(proc(() => Effect.succeed(runResult("", 128))))),
    )
    expect(history).toEqual([])
  })

  test("returns [] when git is unavailable", async () => {
    const history = await Effect.runPromise(
      ProjectContext.loadHistory(
        deps(proc(() => Effect.fail(new AppProcess.AppProcessError({ command: "git log" })))),
      ),
    )
    expect(history).toEqual([])
  })
})
