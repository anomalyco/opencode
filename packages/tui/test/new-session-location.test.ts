import { WorkspaceID } from "@opencode/schema/workspace-id"
import { expect, test } from "bun:test"
import { newSessionLocation } from "../src/config/new-session-location"

test("uses the launch directory by default", () => {
  expect(
    newSessionLocation("launch", "/launch", {
      directory: "/session",
      workspaceID: WorkspaceID.make("work-1", { disableChecks: true }),
    }),
  ).toEqual({
    directory: "/launch",
  })
})

test("inherits the active session location when configured", () => {
  expect(
    newSessionLocation("inherit", "/launch", {
      directory: "/session",
      workspaceID: WorkspaceID.make("work-1", { disableChecks: true }),
    }),
  ).toEqual({
    directory: "/session",
    workspaceID: WorkspaceID.make("work-1", { disableChecks: true }),
  })
})

test("falls back to the launch directory without an active session", () => {
  expect(newSessionLocation("inherit", "/launch")).toEqual({ directory: "/launch" })
})

test("does not inherit an unavailable active location", () => {
  expect(
    newSessionLocation(
      "inherit",
      "/launch",
      { directory: "/deleted", workspaceID: WorkspaceID.make("work-1", { disableChecks: true }) },
      { directory: "/deleted", workspaceID: WorkspaceID.make("work-1", { disableChecks: true }) },
    ),
  ).toEqual({ directory: "/launch" })
})
