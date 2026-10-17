import { describe, expect, test } from "bun:test"
import path from "path"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/core/schema"
import { Workspace } from "@opencode/core/workspace"

const workspaceID = Workspace.ID.make("wrk_test")

function ref(directory: string) {
  return Location.Ref.make({ directory: AbsolutePath.make(directory), workspaceID })
}

// Build the string by hand: path.join would collapse the `..` before canonical sees it.
const dotDot = `${path.sep}base${path.sep}src${path.sep}..${path.sep}proj`
const clean = `${path.sep}base${path.sep}proj`

describe("LocationServiceMap.canonical", () => {
  test("collapses dot segments so equivalent placements share one key", () => {
    expect(LocationServiceMap.canonical(ref(dotDot))).toEqual(LocationServiceMap.canonical(ref(clean)))
  })

  test("keeps the workspace id and is idempotent", () => {
    const once = LocationServiceMap.canonical(ref(dotDot))
    expect(once.workspaceID).toBe(workspaceID)
    expect(LocationServiceMap.canonical(once)).toEqual(once)
  })
})
