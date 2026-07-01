import { expect, test } from "bun:test"
import path from "path"
import { testRender } from "@opentui/solid"
import { abbreviateHome } from "../src/runtime"
import { TuiPathsProvider, useTuiPaths } from "../src/context/runtime"

test("abbreviates paths within home boundaries", () => {
  // abbreviateHome joins with the platform separator (path.sep), so build the
  // fixtures and expectations with path.join too — otherwise this only passes on
  // POSIX and fails on Windows (~\project vs ~/project).
  const home = path.join(path.sep, "home", "test")
  const inside = path.join(home, "project")
  const sibling = path.join(path.sep, "home", "tester", "project")
  const outside = path.join(path.sep, "tmp", "project")

  expect(abbreviateHome(home, home)).toBe("~")
  expect(abbreviateHome(inside, home)).toBe("~" + path.sep + "project")
  expect(abbreviateHome(sibling, home)).toBe(sibling)
  expect(abbreviateHome(outside, home)).toBe(outside)
})

test("provides focused immutable runtime inputs", async () => {
  let paths: ReturnType<typeof useTuiPaths>

  function Runtime() {
    paths = useTuiPaths()
    return <text>{paths.cwd}</text>
  }

  const app = await testRender(
    () => (
      <TuiPathsProvider value={{ cwd: "/work", home: "/home/test", state: "/state", worktree: "/worktree" }}>
        <Runtime />
      </TuiPathsProvider>
    ),
    { width: 40, height: 3 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("/work")
    expect(Object.isFrozen(paths!)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
