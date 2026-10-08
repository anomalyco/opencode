import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { Effect } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectStructure } from "@opencode-ai/core/system-context/structure-context"

const runResult = (stdout: string, exitCode = 0): AppProcess.RunResult => ({
  command: "git ls-files",
  exitCode,
  stdout: Buffer.from(stdout),
  stderr: Buffer.alloc(0),
  outputTruncated: false,
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

const stdout = (paths: string[]): string => paths.join("\n") + "\n"

describe("ProjectStructure.parseFiles", () => {
  test("splits on newlines and drops blanks", () => {
    expect(ProjectStructure.parseFiles("a.ts\n\nb.ts\n")).toEqual(["a.ts", "b.ts"])
  })
})

describe("ProjectStructure.filterFiles", () => {
  test("keeps relevant extensions and drops .git metadata", () => {
    expect(
      ProjectStructure.filterFiles(["package.json", "src/a.ts", ".git/HEAD", "notes.txt", "README.md"]),
    ).toEqual(["package.json", "src/a.ts", "README.md"])
  })
})

describe("ProjectStructure.orderFiles", () => {
  test("ranks shallow + important entry points first (stable)", () => {
    const out = ProjectStructure.orderFiles(["src/a.ts", "package.json", "src/index.ts", "README.md"])
    expect(out[0]).toBe("package.json")
    expect(out).toContain("src/index.ts")
    expect(out).toContain("src/a.ts")
  })
})

describe("ProjectStructure.render", () => {
  test("renders a budgeted summary and empties to empty string", () => {
    const rendered = ProjectStructure.render(["package.json", "src/a.ts"])
    expect(rendered).toContain("Project structure")
    expect(rendered).toContain("package.json")
    expect(rendered).toContain("src/a.ts")
    expect(ProjectStructure.render([])).toBe("")
  })

  test("truncates to the token budget and annotates the tail", () => {
    const files = Array.from({ length: 200 }, (_, i) => `src/module${i}.ts`)
    const rendered = ProjectStructure.render(files)
    expect(rendered).toContain("files shown")
  })
})

describe("ProjectStructure.loadFiles", () => {
  test("filters+truncates git ls-files output on success", async () => {
    const files = await Effect.runPromise(
      ProjectStructure.loadFiles(
        deps(proc(() => Effect.succeed(runResult(stdout(["package.json", "src/a.ts", "src/b.ts", "README.md"]))))),
      ),
    )
    expect(files).toEqual(["package.json", "src/a.ts", "src/b.ts", "README.md"])
  })

  test("returns [] on a non-git exit code", async () => {
    const files = await Effect.runPromise(
      ProjectStructure.loadFiles(deps(proc(() => Effect.succeed(runResult("", 128))))),
    )
    expect(files).toEqual([])
  })

  test("returns [] when git is unavailable", async () => {
    const files = await Effect.runPromise(
      ProjectStructure.loadFiles(
        deps(proc(() => Effect.fail(new AppProcess.AppProcessError({ command: "git ls-files" })))),
      ),
    )
    expect(files).toEqual([])
  })
})
