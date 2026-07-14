import { expect, test } from "bun:test"
import { reconnectingCopy } from "../../../src/component/reconnecting"

test("describes service status without transport diagnostics", () => {
  expect(reconnectingCopy({ type: "starting", version: "2.0.0" })).toEqual({
    loading: true,
    message: "Starting OpenCode 2.0.0...",
  })
  expect(reconnectingCopy({ type: "stopping", targetVersion: "2.0.0" })).toEqual({
    loading: true,
    message: "Updating to 2.0.0...",
  })
  expect(
    reconnectingCopy({
      type: "failed",
      message: "Could not open the database.",
      action: "Check the service logs.",
    }),
  ).toEqual({
    loading: false,
    message: "Background service failed",
    detail: "Could not open the database.",
    action: "Check the service logs.",
  })
  expect(reconnectingCopy({ type: "unresponsive" })).toEqual({
    loading: false,
    message: "Background service is not responding",
    action: "Run `opencode service restart` to recover it.",
  })
  expect(JSON.stringify(reconnectingCopy())).not.toMatch(/Attempt|ECONNREFUSED|Event stream disconnected/)
})
