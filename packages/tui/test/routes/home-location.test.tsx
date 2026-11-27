import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import path from "node:path"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { createAppFixture } from "../fixture/app"
import { tmpdir } from "../fixture/fixture"
import { json, worktree } from "../fixture/tui-client"

const alpha = "/tmp/wt-alpha"
const beta = "/tmp/wt-beta"
const project = { id: "proj_test", directory: worktree, canonical: worktree }

test("switching Home between worktrees loads the branch of each", async () => {
  takeDraft(undefined)
  await using state = await tmpdir()
  const vcs: string[] = []
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    fetch: (url, request) => {
      const directory = url.searchParams.get("location[directory]") ?? worktree
      if (url.pathname === "/api/location") return json({ directory, project })
      if (url.pathname === "/api/vcs") {
        vcs.push(directory)
        const branch = path.basename(directory).replace("wt-", "")
        return json({ location: { directory, project }, data: { branch: { current: branch, default: "main" } } })
      }
      if (url.pathname === "/api/worktree" && request.method === "GET")
        return json([
          { directory: worktree },
          { directory: alpha, strategy: "git" },
          { directory: beta, strategy: "git" },
        ])
    },
  })
  await setup.ready

  async function select(filter: string) {
    // Keys go to whatever is focused, so wait for Home's prompt to mount and take focus before typing.
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await setup.mockInput.typeText("/worktrees")
    await setup.waitForFrame((frame) => frame.includes("/worktrees"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes(alpha) && frame.includes(beta))
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
    await setup.mockInput.typeText(filter)
    await setup.waitForFrame((frame) => !frame.includes(filter === "alpha" ? beta : alpha))
    setup.mockInput.pressEnter()
  }

  await select("alpha")
  await setup.waitForFrame((frame) => frame.includes(`${alpha}:alpha`))
  await select("beta")
  const frame = await setup.waitForFrame((frame) => frame.includes(`${beta}:beta`))

  expect(frame).toContain(`${beta}:beta`)
  expect(vcs).toContain(beta)
})
