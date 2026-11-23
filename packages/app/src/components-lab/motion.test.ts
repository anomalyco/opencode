import { expect, test } from "bun:test"
import { motionTuning } from "@opencode/ui/motion-tuning"
import { sameMotion, storyMotion } from "./motion"

test("a remounted story's replay buttons rebuild the inspector, though their ids match", () => {
  const register = () => motionTuning.action({ id: "lab.test.replay", label: "Replay", group: "Lab test", run() {} })
  const unmount = register()
  const first = storyMotion(["Lab test"])

  expect(sameMotion(first, storyMotion(["Lab test"]))).toBe(true)

  unmount()
  const remount = register()

  expect(sameMotion(first, storyMotion(["Lab test"]))).toBe(false)
  remount()
})
