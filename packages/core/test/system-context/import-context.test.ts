import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { Effect } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectImports } from "@opencode-ai/core/system-context/import-context"

const runResult = (stdout: string, exitCode = 0): AppProcess.RunResult => ({
  command: "git grep",
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

describe("ProjectImports.extractSpecifiers", () => {
  test("extracts from/export specifiers plus side-effect imports", () => {
    const lines = [
      "import { foo } from '@/foo'",
      "import 'side-effect'",
      "export * from '@/lib'",
      "export const x = 1",
      "import { bar } from './bar'",
    ]
    expect(ProjectImports.extractSpecifiers(lines)).toEqual(["@/foo", "side-effect", "@/lib", "./bar"])
  })
})

describe("ProjectImports.rankByFrequency", () => {
  test("dedupes and orders by frequency desc (stable on ties)", () => {
    expect(ProjectImports.rankByFrequency(["a", "b", "a", "c", "a", "b"])).toEqual(["a", "b", "c"])
  })
})

describe("ProjectImports.render", () => {
  test("renders a budgeted summary and empties to empty string", () => {
    const rendered = ProjectImports.render(["@effect/effect", "./utils"])
    expect(rendered).toContain("Project imports")
    expect(rendered).toContain("@effect/effect")
    expect(rendered).toContain("./utils")
    expect(ProjectImports.render([])).toBe("")
  })

  test("annotates truncation when the token budget trims the list", () => {
    const files = Array.from({ length: 200 }, (_, i) => `@scope/pkg-${i}`)
    const rendered = ProjectImports.render(files)
    expect(rendered).toContain("shown")
  })
})

describe("ProjectImports.loadImports", () => {
  test("ranks specifiers by frequency on success", async () => {
    const specifiers = await Effect.runPromise(
      ProjectImports.loadImports(
        deps(proc(() => Effect.succeed(runResult("import 'a'\nimport 'a'\nexport { x } from 'b'\n")))),
      ),
    )
    expect(specifiers).toEqual(["a", "b"])
  })

  test("returns [] on a non-git exit code", async () => {
    const specifiers = await Effect.runPromise(
      ProjectImports.loadImports(deps(proc(() => Effect.succeed(runResult("", 128))))),
    )
    expect(specifiers).toEqual([])
  })

  test("returns [] when git is unavailable", async () => {
    const specifiers = await Effect.runPromise(
      ProjectImports.loadImports(
        deps(proc(() => Effect.fail(new AppProcess.AppProcessError({ command: "git grep" })))),
      ),
    )
    expect(specifiers).toEqual([])
  })
})
