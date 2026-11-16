import { expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client/promise"
import { consoleMcpLinks, consoleMcps, consoleSkillLink, consoleWorkspace } from "./console-extensions"

type ServerConfig = NonNullable<
  NonNullable<Extract<ConfigEntry, { type: "document" }>["info"]["mcp"]>["servers"]
>[string]

const consoleUrl = "https://opencode.ai/console"

const token = (claims: { u: string; w?: string; d?: number }) =>
  `Bearer ocgw_${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`

const gateway = (slug: string, authorization = token({ u: "user_1", w: "org_1", d: 1 })): ServerConfig => ({
  type: "remote",
  url: `${consoleUrl}/api/integration-gateway/${slug}/mcp`,
  oauth: false,
  headers: { authorization },
})

const document = (servers: Record<string, ServerConfig>): ConfigEntry => ({
  type: "document",
  info: { mcp: { servers } },
})

test("console MCPs recognize only managed gateway entries and sort by name", () => {
  const entries = [
    document({
      slack: gateway("slack"),
      github: { ...gateway("github"), protocol: "2026-07-28" },
      oauth: { type: "remote", url: `${consoleUrl}/api/integration-gateway/oauth/mcp` },
      other: { type: "remote", url: "https://example.com/mcp", oauth: false },
      local: { type: "local", command: ["x"] },
    }),
  ]

  expect(consoleMcps(entries)).toEqual([
    {
      name: "github",
      server: consoleUrl,
      slug: "github",
      workspace: "org_1",
      needsConnection: true,
      overridden: false,
    },
    {
      name: "slack",
      server: consoleUrl,
      slug: "slack",
      workspace: "org_1",
      needsConnection: false,
      overridden: false,
    },
  ])
})

test("the workspace comes from the gateway token's claims, and a token it can't read names none", () => {
  const workspace = (config: ServerConfig) => consoleMcps([document({ slack: config })])[0].workspace

  expect(workspace(gateway("slack", token({ u: "user_1", w: "wrk_2", d: 1 })))).toBe("wrk_2")
  expect(workspace({ type: "remote", url: `${consoleUrl}/api/integration-gateway/slack/mcp`, oauth: false })).toBe(
    undefined,
  )
  expect(workspace(gateway("slack", "Bearer oc_sk_key"))).toBeUndefined()
  expect(workspace(gateway("slack", "Bearer ocgw_!!!.signature"))).toBeUndefined()
  expect(workspace(gateway("slack", token({ u: "user_1" })))).toBeUndefined()
})

test("a same-named server in the effective config marks Console's as overridden", () => {
  const offered = [document({ slack: gateway("slack"), github: gateway("github") })]

  const active = [document({ slack: { type: "remote", url: "https://example.com/mcp" }, github: gateway("github") })]

  expect(consoleMcps(offered, active).map((item) => [item.name, item.overridden])).toEqual([
    ["github", false],
    ["slack", true],
  ])
})

test("MCP links open the workspace's pages, or Console's home without a workspace", () => {
  const [github] = consoleMcps([document({ github: gateway("github", token({ u: "user_1", w: "org 1", d: 1 })) })])

  expect(consoleMcpLinks(github)).toEqual({
    manage: `${consoleUrl}/org%201/extensions/mcp/github`,
    connect: `${consoleUrl}/org%201/extensions?connect=github`,
  })

  const [unnamed] = consoleMcps([document({ github: gateway("github", "Bearer oc_sk_key") })])

  expect(consoleMcpLinks(unnamed)).toEqual({ manage: consoleUrl, connect: consoleUrl })
})

test("skills link to Console only for virtual skills while signed in, except the built-ins", () => {
  const workspace = consoleWorkspace(consoleMcps([document({ slack: gateway("slack") })]))

  const deploy = { id: "deploy", path: "skill://deploy/SKILL.md" }

  expect(consoleSkillLink(deploy, workspace, true)).toBe(`${consoleUrl}/org_1/extensions?kind=skills&search=deploy`)
  expect(consoleSkillLink(deploy, undefined, true)).toBe(consoleUrl)
  expect(consoleSkillLink(deploy, workspace, false)).toBeUndefined()
  expect(consoleSkillLink({ id: "deploy", path: "/home/me/.skills/deploy/SKILL.md" }, workspace, true)).toBeUndefined()
  expect(consoleSkillLink({ id: "report", path: "skill://report/SKILL.md" }, workspace, true)).toBeUndefined()
})
