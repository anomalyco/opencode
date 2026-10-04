import { describe, expect, test } from "bun:test"
import path from "node:path"
import type { Permission } from "@opencode/schema/permission"
import { makeSession, rpcError, startWire, type Wire } from "./wire-fixture"

const key = "opencode.acp.additionalDirectories"

const grant = (directory: string): Permission.Rule => ({
  action: "external_directory",
  resource: path.join(directory, "*"),
  effect: "allow",
})

const sharedLib = path.resolve("/shared/lib")
const productDocs = path.resolve("/product-docs")
const old = path.resolve("/old")

const userGrant: Permission.Rule = { action: "external_directory", resource: "/x/**", effect: "allow" }

const other: Permission.Rule[] = [
  { action: "read", resource: "*.secret", effect: "deny" },
  { action: "external_directory", resource: "/shared/lib/private/*", effect: "deny" },
]

const updates = (acp: Wire) =>
  acp.server.requests.filter((request) => request.method === "PATCH" && request.path.startsWith("/api/session/"))

describe("acp additional directories over the wire", () => {
  test.each(["shared/lib", "", "/shared/*", "/shared/lib?"])(
    "rejects %p before creating a session",
    async (directory) => {
      await using acp = await startWire()
      await acp.initialize()

      expect(
        await rpcError(
          acp.request("session/new", {
            cwd: "/workspace",
            additionalDirectories: ["/shared/ok", directory],
            mcpServers: [],
          }),
        ),
      ).toMatchObject({ code: -32602, data: { additionalDirectory: directory } })
      expect(acp.server.sessions.size).toBe(0)
    },
  )

  test("load and resume replace ACP grants and keep other session rules and metadata", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_saved", {
      ...makeSession("ses_saved"),
      metadata: { host: "tui", [key]: [old] },
      permissions: [grant(old), userGrant, ...other],
    })
    await acp.initialize()

    await acp.request("session/load", {
      cwd: "/workspace",
      sessionId: "ses_saved",
      additionalDirectories: ["/shared/lib", "/product-docs"],
      mcpServers: [],
    })
    expect(acp.server.sessions.get("ses_saved")).toMatchObject({
      metadata: { host: "tui", [key]: [sharedLib, productDocs] },
      permissions: [grant(sharedLib), grant(productDocs), userGrant, ...other],
    })

    await acp.request("session/resume", {
      cwd: "/workspace",
      sessionId: "ses_saved",
      additionalDirectories: ["/shared/lib", "/product-docs"],
    })
    expect(updates(acp)).toHaveLength(1)

    await acp.request("session/resume", { cwd: "/workspace", sessionId: "ses_saved" })
    expect(acp.server.sessions.get("ses_saved")?.metadata).toEqual({ host: "tui" })
    expect(acp.server.sessions.get("ses_saved")?.permissions).toEqual([userGrant, ...other])
    expect((await acp.request("session/list", { cwd: "/workspace" })).sessions[0]).not.toHaveProperty(
      "additionalDirectories",
    )
  })

  test("forks replace inherited grants with the requested list", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_source", {
      ...makeSession("ses_source"),
      metadata: { [key]: [old] },
      permissions: [grant(old), ...other],
    })
    await acp.initialize()

    const plain = await acp.request("session/fork", { cwd: "/workspace", sessionId: "ses_source" })
    const granted = await acp.request("session/fork", {
      cwd: "/workspace",
      sessionId: "ses_source",
      additionalDirectories: ["/shared/lib"],
    })

    expect(acp.server.sessions.get(plain.sessionId)).toMatchObject({ metadata: {}, permissions: other })
    expect(acp.server.sessions.get(granted.sessionId)).toMatchObject({
      metadata: { [key]: [sharedLib] },
      permissions: [grant(sharedLib), ...other],
    })
    expect(acp.server.sessions.get("ses_source")?.permissions).toEqual([grant(old), ...other])
  })
})
