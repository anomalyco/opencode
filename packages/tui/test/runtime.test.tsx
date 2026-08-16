import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { abbreviateHome } from "../src/runtime"
import { TuiPathsProvider, useTuiPaths } from "../src/context/runtime"

test("abbreviates paths within home boundaries", () => {
  expect(abbreviateHome("/home/test", "/home/test")).toBe("~")
  expect(abbreviateHome("/home/test/project", "/home/test")).toBe("~/project")
  expect(abbreviateHome("/home/tester/project", "/home/test")).toBe("/home/tester/project")
  expect(abbreviateHome("/tmp/project", "/home/test")).toBe("/tmp/project")
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
