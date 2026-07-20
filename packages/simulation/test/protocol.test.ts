import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Backend, Frontend, Handshake } from "../src/protocol"

test("decodes ui.matches text params", () => {
  expect(
    Frontend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ui.matches",
      params: { text: "OpenCode [ready].*" },
    }),
  ).toMatchObject({ method: "ui.matches", params: { text: "OpenCode [ready].*" } })
  expect(() =>
    Frontend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ui.matches",
      params: { pattern: "OpenCode.*" },
    }),
  ).toThrow()
})

test("decodes semantic click identity", () => {
  expect(
    Frontend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ui.click",
      params: {
        target: 12,
        x: 4,
        y: 0,
        semantic: {
          id: "session.permission.action.once",
          instance: "permission-1",
          element: 12,
        },
      },
    }),
  ).toMatchObject({
    method: "ui.click",
    params: {
      semantic: {
        id: "session.permission.action.once",
        instance: "permission-1",
        element: 12,
      },
    },
  })
})

test("decodes semantic UI snapshots", () => {
  expect(
    Frontend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ui.snapshot",
    }),
  ).toMatchObject({ method: "ui.snapshot" })
  const decode = Schema.decodeUnknownSync(Frontend.SemanticSnapshot)
  expect(
    decode({
      format: "opencode-ui-snapshot-v1",
      nodes: [
        {
          id: "session.permission",
          role: "dialog",
          label: "Permission required",
          element: 1,
          expanded: false,
        },
      ],
    }),
  ).toMatchObject({ nodes: [{ role: "dialog", expanded: false }] })
  expect(() =>
    decode({
      format: "opencode-ui-snapshot-v1",
      nodes: [{ id: "", role: "dialog", element: 0 }],
    }),
  ).toThrow()
  for (const nodes of [
    [
      { id: "duplicate", role: "dialog", element: 1 },
      { id: "duplicate", role: "option", element: 2 },
    ],
    [
      { id: "first", role: "dialog", element: 1 },
      { id: "second", role: "option", element: 1 },
    ],
    [{ id: "orphan", parent: "missing", role: "option", element: 1 }],
    [
      { id: "first", parent: "second", role: "dialog", element: 1 },
      { id: "second", parent: "first", role: "option", element: 2 },
    ],
  ])
    expect(() => decode({ format: "opencode-ui-snapshot-v1", nodes })).toThrow()
})

test("decodes the simulated tool lifecycle", () => {
  const registration = {
    name: "lookup",
    description: "Look up a value",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    permission: "lookup",
    options: { codemode: false },
  }
  expect(
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tool.attach",
      params: { tools: [registration] },
    }),
  ).toMatchObject({ method: "tool.attach", params: { tools: [registration] } })
  expect(
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tool.update",
      params: {
        id: "tool_1",
        sequence: 0,
        update: { structured: { phase: "searching" }, content: [{ type: "text", text: "Searching" }] },
      },
    }),
  ).toMatchObject({ method: "tool.update" })
  expect(
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tool.finish",
      params: {
        id: "tool_1",
        output: { structured: { answer: 42 }, content: [{ type: "text", text: "42" }] },
      },
    }),
  ).toMatchObject({ method: "tool.finish" })
  expect(
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tool.fail",
      params: { id: "tool_2", message: "lookup failed" },
    }),
  ).toMatchObject({ method: "tool.fail" })
  expect(() =>
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tool.attach",
      params: { tools: [registration, registration] },
    }),
  ).toThrow()
  for (const invalid of [
    { ...registration, name: "1lookup" },
    { ...registration, options: { namespace: "bad group", codemode: false } },
    { ...registration, name: "execute", options: { codemode: false } },
    { ...registration, options: { namespace: "a".repeat(64), codemode: false } },
  ])
    expect(() =>
      Backend.decodeRequest({
        jsonrpc: "2.0",
        id: 6,
        method: "tool.attach",
        params: { tools: [invalid] },
      }),
    ).toThrow()
  expect(() =>
    Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tool.attach",
      params: {
        tools: [
          { ...registration, name: "b_c", options: { namespace: "a", codemode: false } },
          { ...registration, name: "c", options: { namespace: "a.b", codemode: false } },
        ],
      },
    }),
  ).toThrow()
})

const params: Handshake.Params = {
  client: { name: "opencode-drive", version: "test" },
  expectedRole: "ui",
  offeredVersions: [1],
  requiredCapabilities: ["ui.state"],
  optionalCapabilities: ["ui.capture", "future.capability"],
}

const ui: Handshake.DispatchAction = {
  role: "ui",
  server: { name: "opencode", version: "test" },
  capabilities: Frontend.Capabilities,
}

describe("simulation.handshake", () => {
  test("decodes through both endpoint request protocols", () => {
    const request = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "simulation.handshake" as const,
      params,
    }
    expect(Frontend.decodeRequest(request)).toEqual(request)
    expect(Backend.decodeRequest({ ...request, params: { ...params, expectedRole: "backend" } })).toMatchObject({
      method: "simulation.handshake",
      params: { expectedRole: "backend" },
    })
  })

  test("rejects invalid version and capability declarations", () => {
    const request = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "simulation.handshake" as const,
      params,
    }
    expect(() =>
      Frontend.decodeRequest({
        ...request,
        params: { ...params, offeredVersions: [] },
      }),
    ).toThrow()
    expect(() =>
      Frontend.decodeRequest({
        ...request,
        params: { ...params, requiredCapabilities: ["ui.state", "ui.state"] },
      }),
    ).toThrow()
    expect(() =>
      Frontend.decodeRequest({
        ...request,
        params: { ...params, optionalCapabilities: [""] },
      }),
    ).toThrow()
  })

  test("selects the protocol and advertises only installed capabilities", async () => {
    await expect(Effect.runPromise(Handshake.dispatch(ui, params))).resolves.toEqual({
      protocolVersion: 1,
      role: "ui",
      server: { name: "opencode", version: "test" },
      capabilities: [...Frontend.Capabilities],
    })
  })

  test("rejects a role mismatch", async () => {
    await expect(
      Effect.runPromise(Handshake.dispatch(ui, { ...params, expectedRole: "backend" })),
    ).rejects.toMatchObject({ _tag: "SimulationHandshake.RoleMismatchError", expected: "backend", actual: "ui" })
  })

  test("rejects unsupported protocol versions", async () => {
    await expect(Effect.runPromise(Handshake.dispatch(ui, { ...params, offeredVersions: [2] }))).rejects.toMatchObject({
      _tag: "SimulationHandshake.UnsupportedProtocolError",
      offered: [2],
      supported: [1],
    })
  })

  test("rejects a missing required capability but ignores missing optional capabilities", async () => {
    await expect(
      Effect.runPromise(
        Handshake.dispatch(ui, {
          ...params,
          requiredCapabilities: ["ui.state", "ui.future"],
        }),
      ),
    ).rejects.toMatchObject({ _tag: "SimulationHandshake.MissingCapabilityError", missing: ["ui.future"] })

    await expect(
      Effect.runPromise(
        Handshake.dispatch(ui, {
          ...params,
          requiredCapabilities: [],
          optionalCapabilities: ["ui.future"],
        }),
      ),
    ).resolves.toMatchObject({ capabilities: Frontend.Capabilities })
  })
})
