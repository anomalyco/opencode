import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Effect } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Git } from "@opencode/core/git"
import { OpencodeMemoryVerify } from "@opencode/core/plugin/provider/opencode-memory-verify"
import { AbsolutePath } from "@opencode/core/schema"
import { ShellSelect } from "@opencode/core/shell/select"
import { initRepo } from "../fixture/git"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Git.node, AppProcess.node, ShellSelect.node])))

const TEST = "bun test test/value.test.ts"
const SPEC =
  'import { expect, test } from "bun:test"\nimport fs from "fs"\ntest("value", () => expect(fs.readFileSync("src/value.txt", "utf8").trim()).toBe("fixed"))\n'

/** A repository whose last commit fixes src/value.txt and adds the test that shows it; `before` is what it had. */
const repository = (before: string) =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const sha = yield* Effect.promise(async () => {
      await initRepo(root.path)
      await fs.mkdir(path.join(root.path, "src"), { recursive: true })
      await fs.writeFile(path.join(root.path, "src/value.txt"), `${before}\n`)
      await $`git add -A && git commit -qm broken`.cwd(root.path).quiet()
      await fs.mkdir(path.join(root.path, "test"), { recursive: true })
      await fs.writeFile(path.join(root.path, "test/value.test.ts"), SPEC)
      await fs.writeFile(path.join(root.path, "src/value.txt"), "fixed\n")
      await $`git add -A && git commit -qm fix`.cwd(root.path).quiet()
      return (await $`git rev-parse HEAD`.cwd(root.path).text()).trim()
    })
    const git = yield* Git.Service
    const found = yield* git.repo.discover(AbsolutePath.make(yield* Effect.promise(() => fs.realpath(root.path))))
    const shells = yield* ShellSelect.Service
    const verify = OpencodeMemoryVerify.make({
      git,
      processes: yield* AppProcess.Service,
      shell: shells.resolve({ priority: "config" }),
    })
    const turn = {
      commits: [sha],
      tests: [
        { command: TEST, failed: true },
        { command: TEST, failed: false },
      ],
    }
    return { git, repository: found!, sha, verify, turn }
  })

describe("OpencodeMemoryVerify", () => {
  it.live(
    "verifies a fix whose test fails twice before the commit and passes twice at it, in a worktree it removes",
    () =>
      Effect.gen(function* () {
        const fixture = yield* repository("broken")
        const verify = (paths: ReadonlyArray<string>, turn = fixture.turn) =>
          fixture.verify({ repository: fixture.repository, turn, paths, env: process.env })
        expect(yield* verify(["src/value.txt"])).toBe(fixture.sha)
        // Only an entry about what the commit changed, and only with a test that failed, then passed.
        expect(yield* verify(["src/other.txt"])).toBeUndefined()
        expect(yield* verify(["src/*.txt"])).toBeUndefined()
        expect(yield* verify(["src/value.txt"], { ...fixture.turn, tests: [{ command: TEST, failed: false }] })).toBe(
          undefined,
        )
        expect((yield* fixture.git.worktree.list(fixture.repository)).map((item) => item.directory)).toEqual([
          fixture.repository.worktree,
        ])
      }),
  )

  it.live("refuses a fix whose test already passed before the commit", () =>
    Effect.gen(function* () {
      // The value was already right, only padded: the commit changes the file, but the test passes at the parent too,
      // so it shows nothing the commit fixed.
      const fixture = yield* repository("fixed  ")
      expect(
        yield* fixture.verify({
          repository: fixture.repository,
          turn: fixture.turn,
          paths: ["src/value.txt"],
          env: process.env,
        }),
      ).toBe(false)
      expect((yield* fixture.git.worktree.list(fixture.repository)).map((item) => item.directory)).toEqual([
        fixture.repository.worktree,
      ])
    }),
  )
})
