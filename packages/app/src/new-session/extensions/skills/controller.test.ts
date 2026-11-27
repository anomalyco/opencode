import { expect, test } from "bun:test"
import { createNewSessionSkills } from "./controller"

test("disabling and re-enabling a skill updates the disabled list and the count", () => {
  let disabled: string[] = ["old"]
  const skills = createNewSessionSkills({
    skills: () => ["old", "new"].map((id) => ({ id, name: id })),
    disabled: () => disabled,
    setDisabled: (ids) => (disabled = ids),
  })

  expect(skills.count()).toBe(1)

  skills.toggle("new", false)
  expect(disabled).toEqual(["old", "new"])
  expect(skills.count()).toBe(0)

  skills.toggle("old", true)
  expect(disabled).toEqual(["new"])
  expect(skills.count()).toBe(1)
})
