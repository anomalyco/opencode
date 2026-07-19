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
