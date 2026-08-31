import { expect, test } from "bun:test"
import { permissionSemanticLabel } from "../../../src/routes/session/permission"

test("uses the permission action when a surface has no display title", () => {
  expect(permissionSemanticLabel("shell")).toBe("Permission required: shell")
  expect(permissionSemanticLabel("edit", "Edit fixture.txt")).toBe("Permission required: Edit fixture.txt")
  expect(permissionSemanticLabel("shell", "Run git status", "Explore · Inspect permissions")).toBe(
    "Permission required from Explore · Inspect permissions: Run git status",
  )
})
