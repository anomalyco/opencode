import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { StartupLoading, startupProgress } from "../../src/component/startup-loading"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

test("reports completed startup stages", () => {
  expect(startupProgress("terminal", 10)).toEqual({
    bar: "[----------]",
    completed: 0,
    total: 5,
    label: "Initializing terminal...",
  })
  expect(startupProgress("workspace", 10)).toEqual({
    bar: "[####------]",
    completed: 2,
    total: 5,
    label: "Loading workspace and providers...",
  })
  expect(startupProgress("ready", 10)).toEqual({
    bar: "[##########]",
    completed: 5,
    total: 5,
    label: "Ready",
  })
})

test("renders progress above startup content", async () => {
  setup = await testRender(
    () => (
      <StartupLoading stage={() => "workspace"} mode={() => "dark"} hidden={false}>
        <text>Application</text>
      </StartupLoading>
    ),
    { width: 40, height: 10 },
  )
  await setup.renderOnce()
  await setup.renderOnce()

  const frame = setup.captureCharFrame()
  expect(frame).toContain("[##########--------------]")
  expect(frame).toContain("2/5 Loading workspace and providers...")
  expect(frame).not.toContain("Application")
})

test("reveals startup content when ready", async () => {
  setup = await testRender(
    () => (
      <StartupLoading stage={() => "ready"} mode={() => "dark"} hidden={false}>
        <text>Application</text>
      </StartupLoading>
    ),
    { width: 40, height: 10 },
  )
  await setup.renderOnce()
  await setup.renderOnce()

  const frame = setup.captureCharFrame()
  expect(frame).toContain("Application")
  expect(frame).not.toContain("5/5 Ready")
})
