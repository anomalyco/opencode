import { describe, expect, test } from "bun:test"
import { sortDialogSelectGroups } from "../../src/ui/dialog-select"

describe("DialogSelect group ordering", () => {
  test("sorts categories without changing the order inside each group", () => {
    const groups: [string, { title: string; value: string }[]][] = [
      [
        "/workspace/zeta",
        [
          { title: "newest", value: "zeta-newest" },
          { title: "oldest", value: "zeta-oldest" },
        ],
      ],
      ["/workspace/alpha", [{ title: "alpha recent", value: "alpha" }]],
    ]

    const sorted = sortDialogSelectGroups(groups, (a, b) => a.localeCompare(b))

    expect(sorted.map(([category]) => category)).toEqual(["/workspace/alpha", "/workspace/zeta"])
    expect(sorted[1]?.[1].map((option) => option.value)).toEqual(["zeta-newest", "zeta-oldest"])
    expect(groups.map(([category]) => category)).toEqual(["/workspace/zeta", "/workspace/alpha"])
  })

  test("keeps the existing group order when no sorter is provided", () => {
    const groups: [string, { title: string; value: string }[]][] = [
      ["/workspace/zeta", [{ title: "zeta recent", value: "zeta" }]],
      ["/workspace/alpha", [{ title: "alpha recent", value: "alpha" }]],
    ]

    expect(sortDialogSelectGroups(groups)).toBe(groups)
  })
})
