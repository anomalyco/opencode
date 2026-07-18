import path from "path"
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { abbreviateHome, splitDisplayPath } from "../src/runtime"
import { TuiPathsProvider, useTuiPaths } from "../src/context/runtime"

test("abbreviates paths within home boundaries", () => {
  expect(abbreviateHome("/home/test", "/home/test")).toBe("~")
  expect(abbreviateHome("/home/test/project", "/home/test")).toBe("~" + path.sep + "project")
  expect(abbreviateHome("/home/tester/project", "/home/test")).toBe("/home/tester/project")
  expect(abbreviateHome("/tmp/project", "/home/test")).toBe("/tmp/project")
})

test("splits display paths without a leading separator on Windows roots", () => {
  expect(splitDisplayPath("/home/test/project:main")).toEqual({
    parent: "/home/test",
    name: "project:main",
    sep: "/",
  })
  expect(splitDisplayPath("D:\\Projects\\kancode:main")).toEqual({
    parent: "D:\\Projects",
    name: "kancode:main",
    sep: "\\",
  })
  expect(splitDisplayPath("D:\\Projects\\kancode")).toEqual({
    parent: "D:\\Projects",
    name: "kancode",
    sep: "\\",
  })
  expect(splitDisplayPath("kancode:main")).toEqual({
    parent: "",
    name: "kancode:main",
    sep: "/",
  })
  expect(splitDisplayPath("/")).toEqual({
    parent: "",
    name: "/",
    sep: "/",
  })
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
