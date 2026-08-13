import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import path from "node:path"
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { MCP } from "../../src/mcp/index"
import { testEffect } from "../lib/effect"

// fork(mcp-dual-era-client D1/D2): real end-to-end proof against real fixture
// servers (not mocks) that dual-era negotiation actually works — the mocked
// unit tests in protocol-mode.test.ts prove opencode resolves and passes the
// right versionNegotiation value; these prove the v2 SDK actually behaves as
// that resolution assumes, against both a server that cannot speak the
// modern era and one that can.

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures")

async function roundTrip(fixture: string, mode: "legacy" | "auto") {
  const client = new Client({ name: "fixture-test", version: "1.0.0" }, { versionNegotiation: { mode } })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", path.join(FIXTURES_DIR, fixture, "server.ts")],
  })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    const result = await client.callTool({ name: "echo", arguments: { message: "hello" } })
    return {
      era: client.getDiscoverResult() ? ("modern" as const) : ("legacy" as const),
      protocolVersion: client.getNegotiatedProtocolVersion(),
      toolNames: tools.map((t) => t.name),
      callText: result.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(""),
    }
  } finally {
    await client.close()
  }
}

test("mcp-legacy fixture: tools/list + tools/call round trip", async () => {
  const result = await roundTrip("mcp-legacy", "auto")
  expect(result.toolNames).toEqual(["echo"])
  expect(result.callText).toBe("hello")
})

test("mcp-legacy fixture never negotiates modern, even with auto mode", async () => {
  // It has no server/discover handler at all — auto must fall back.
  const result = await roundTrip("mcp-legacy", "auto")
  expect(result.era).toBe("legacy")
})

test("mcp-dual-era fixture: tools/list + tools/call round trip", async () => {
  const result = await roundTrip("mcp-dual-era", "auto")
  expect(result.toolNames).toEqual(["echo"])
  expect(result.callText).toBe("hello")
})

test("mcp-dual-era fixture negotiates modern under auto mode", async () => {
  const result = await roundTrip("mcp-dual-era", "auto")
  expect(result.era).toBe("modern")
  expect(result.protocolVersion).toBe("2026-07-28")
})

test("mcp-dual-era fixture still serves the legacy handshake when the client pins legacy", async () => {
  // Same factory, same server — proves it's genuinely dual-era, not modern-only.
  const result = await roundTrip("mcp-dual-era", "legacy")
  expect(result.era).toBe("legacy")
  expect(result.toolNames).toEqual(["echo"])
  expect(result.callText).toBe("hello")
})

// fork(mcp-dual-era-client D2): the same round trip, but through the real,
// unmocked MCP.Service (mcp/index.ts) rather than a raw Client — proves the
// full opencode connection path (protocolMode resolution, diagnostics,
// PriorDiscovery caching) against a real server, not just against the
// hand-mocked Client used in protocol-mode.test.ts.
const it = testEffect(AppNodeBuilder.build(MCP.node))

// fork(mcp-dual-era-client D2): each test/file uses a unique server name —
// AppNodeBuilder.build(MCP.node)'s state is not isolated across concurrently-running
// it.instance() fibers by server name, so reusing a name (e.g. "fixture")
// across files caused real cross-test interference when the full test/mcp/
// suite ran together (never reproduced running one file in isolation).
// Matches this codebase's existing convention (see oauth-auto-connect.test.ts's
// distinct "test-oauth"/"test-oauth-connect"/"test-oauth-resources" names).
const dualEraConfig = {
  mcp: {
    dualerasvc: {
      type: "local" as const,
      command: [process.execPath, "run", path.join(FIXTURES_DIR, "mcp-dual-era", "server.ts")],
    },
  },
}

it.instance(
  "MCP.Service negotiates modern era against the real dual-era fixture and caches it for reconnect",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const first = yield* mcp.add("dualerasvc", dualEraConfig.mcp.dualerasvc)
        const firstStatus = first.status as Record<string, MCP.Status>
        expect(firstStatus.dualerasvc).toMatchObject({
          status: "connected",
          era: "modern",
          protocolVersion: "2026-07-28",
        })

        const tools = yield* mcp.tools()
        expect(Object.keys(tools)).toEqual(["dualerasvc_echo"])

        yield* mcp.disconnect("dualerasvc")
        yield* mcp.connect("dualerasvc")

        const afterReconnect = yield* mcp.status()
        expect(afterReconnect.dualerasvc).toMatchObject({ status: "connected", era: "modern" })
      }),
    ),
  { config: dualEraConfig },
)

it.instance(
  "MCP.Service falls back to legacy era against the real legacy fixture even under auto mode",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const result = yield* mcp.add("legacysvc", {
          type: "local",
          command: [process.execPath, "run", path.join(FIXTURES_DIR, "mcp-legacy", "server.ts")],
        })
        const status = result.status as Record<string, MCP.Status>
        expect(status.legacysvc).toMatchObject({ status: "connected", era: "legacy" })
      }),
    ),
  {
    config: {
      mcp: {
        legacysvc: {
          type: "local",
          command: [process.execPath, "run", path.join(FIXTURES_DIR, "mcp-legacy", "server.ts")],
        },
      },
    },
  },
)

// fork(mcp-dual-era-client C1): real integration test against the same
// dual-era fixture — proves mcpToolProfiles filtering actually removes
// tools from MCP.tools() before they'd reach the model. Kept in this file
// rather than its own: an earlier standalone test/mcp/tool-profiles.test.ts
// failed only when bun test ran the full test/mcp/ directory together with
// oauth-auto-connect.test.ts/oauth-browser.test.ts/protocol-mode.test.ts
// specifically (never in isolation, never with this file) — every fix tried
// (mock.restore() in those files' afterAll, explicit re-mocking to the real
// module, static vs. dynamic import, cache-busted import specifiers,
// alphabetical file-name reordering) failed to resolve it, and the actual
// mechanism was never conclusively identified. Co-locating with this
// file's already-proven-safe AppNodeBuilder.build(MCP.node) usage sidesteps it entirely.
//
// tools() resolves per-server config from the static Config.Service (the
// `config:` fixture below), not from what's passed to mcp.add() at runtime
// — toolProfile/mcpToolProfiles must live in the static config to be seen.
const toolProfileCommand = [process.execPath, "run", path.join(FIXTURES_DIR, "mcp-dual-era", "server.ts")]

it.instance(
  "a server with no toolProfile exposes all of its tools",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("noprofile", { type: "local", command: toolProfileCommand })
        expect(Object.keys(yield* mcp.tools())).toEqual(["noprofile_echo"])
      }),
    ),
  { config: { mcp: { noprofile: { type: "local", command: toolProfileCommand } } } },
)

it.instance(
  "a toolProfile allowlisting the tool still exposes it",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("allowedprofile", { type: "local", command: toolProfileCommand, toolProfile: "open" })
        expect(Object.keys(yield* mcp.tools())).toEqual(["allowedprofile_echo"])
      }),
    ),
  {
    config: {
      mcp: { allowedprofile: { type: "local", command: toolProfileCommand, toolProfile: "open" } },
      mcpToolProfiles: { open: ["echo"] },
    },
  },
)

it.instance(
  "a toolProfile that doesn't list the tool filters it out",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("restrictedprofile", { type: "local", command: toolProfileCommand, toolProfile: "restricted" })
        expect(Object.keys(yield* mcp.tools())).toEqual([])
      }),
    ),
  {
    config: {
      mcp: { restrictedprofile: { type: "local", command: toolProfileCommand, toolProfile: "restricted" } },
      mcpToolProfiles: { restricted: [] },
    },
  },
)

it.instance(
  "a toolProfile referencing a missing mcpToolProfiles entry fails closed (no tools, not all tools)",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("typoprofile", { type: "local", command: toolProfileCommand, toolProfile: "typo-d-profile-name" })
        expect(Object.keys(yield* mcp.tools())).toEqual([])
      }),
    ),
  { config: { mcp: { typoprofile: { type: "local", command: toolProfileCommand, toolProfile: "typo-d-profile-name" } } } },
)
