import { expect, test } from "bun:test"
import { newSessionLocation } from "../src/config/new-session-location"

test("uses the launch directory by default", () => {
  expect(newSessionLocation("launch", "/launch", { directory: "/session", workspaceID: "work-1" })).toEqual({
    directory: "/launch",
  })
})

test("inherits the active session location when configured", () => {
  expect(newSessionLocation("inherit", "/launch", { directory: "/session", workspaceID: "work-1" })).toEqual({
    directory: "/session",
    workspaceID: "work-1",
  })
})

test("falls back to the launch directory without an active session", () => {
  expect(newSessionLocation("inherit", "/launch")).toEqual({ directory: "/launch" })
})
