import { expect, it } from "@effect/vitest"
import { Backend } from "../../src/simulation/protocol.js"

it("decodes the canonical dynamic tool lifecycle", () => {
  expect(
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tool.attach",
      params: {
        tools: [
          {
            name: "search",
            description: "Search GitHub",
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            permission: "search",
            options: { namespace: "github.api", codemode: false },
          },
        ],
      },
    }),
  ).toMatchObject({ method: "tool.attach" })
  expect(
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tool.update",
      params: {
        id: "tool_1",
        sequence: 0,
        update: {
          structured: { phase: "searching" },
          content: [{ type: "text", text: "Searching" }],
        },
      },
    }),
  ).toMatchObject({ method: "tool.update" })
})

it("rejects unsafe, colliding, and reserved exposed names", () => {
  const attach = (tools: ReadonlyArray<unknown>) =>
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tool.attach",
      params: { tools },
    })
  const tool = {
    name: "search",
    description: "Search",
    inputSchema: { type: "object" },
  }

  expect(() => attach([{ ...tool, name: "unsafe.name" }])).toThrow()
  expect(() =>
    attach([
      { ...tool, options: { namespace: "a.b" } },
      { ...tool, options: { namespace: "a_b" } },
    ]),
  ).toThrow()
  expect(() =>
    attach([
      {
        ...tool,
        name: "execute",
        options: { codemode: false },
      },
    ]),
  ).toThrow()
})

it("decodes provider-neutral partial tool input chunks", () => {
  expect(
    Backend.Item.make({
      type: "toolInputStart",
      index: 0,
      id: "call_lookup",
      name: "lookup",
    }),
  ).toEqual({
    type: "toolInputStart",
    index: 0,
    id: "call_lookup",
    name: "lookup",
  })
  expect(
    Backend.Item.make({
      type: "toolInputDelta",
      index: 0,
      text: '{"query":"meaning"}',
    }),
  ).toEqual({
    type: "toolInputDelta",
    index: 0,
    text: '{"query":"meaning"}',
  })
})
