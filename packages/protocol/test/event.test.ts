import { expect, test } from "bun:test"
import { Event } from "@opencode-ai/schema/event"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { DateTime, Schema } from "effect"
import { OpenCodeEvent } from "../src/groups/event.js"

test("encodes MCP tool changes emitted by the server", () => {
  expect(
    Schema.encodeSync(OpenCodeEvent)({
      id: Event.ID.make("evt_test"),
      created: DateTime.makeUnsafe(0),
      type: "mcp.tools.changed",
      location: { directory: AbsolutePath.make("/tmp") },
      data: { server: "example" },
    }),
  ).toEqual({
    id: "evt_test",
    created: 0,
    type: "mcp.tools.changed",
    location: { directory: "/tmp" },
    data: { server: "example" },
  })
})
