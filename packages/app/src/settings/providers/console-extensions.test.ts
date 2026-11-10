import { expect, test } from "bun:test"
import type { ConfigEntry, CredentialEntry } from "@opencode/client/promise"
import { consoleAccount, consoleMcpLinks, consoleMcps, consoleSkillLink } from "./console-extensions"

type ServerConfig = NonNullable<
  NonNullable<Extract<ConfigEntry, { type: "document" }>["info"]["mcp"]>["servers"]
>[string]

const consoleUrl = "https://opencode.ai/console"

const gateway = (slug: string): ServerConfig => ({
  type: "remote",
  url: `${consoleUrl}/api/integration-gateway/${slug}/mcp`,
  oauth: false,
})

const pinned = (slug: string): ServerConfig => ({ ...gateway(slug), protocol: "2026-07-28" })

const document = (servers: Record<string, ServerConfig>): ConfigEntry => ({
  type: "document",
  info: { mcp: { servers } },
})

const credential = (metadata: { server?: string; orgID?: string }, active = true): CredentialEntry => ({
  id: "cred_console",
  integrationID: "opencode",
  label: "Acme",
  active,
  value: { type: "key", key: "fixture-only", metadata },
})

test("console account comes from the active opencode credential, without a trailing slash", () => {
  expect(consoleAccount([credential({ server: `${consoleUrl}//`, orgID: "org_1" })])).toEqual({
    server: consoleUrl,
    orgID: "org_1",
  })
  expect(consoleAccount([credential({})])).toEqual({ server: consoleUrl, orgID: undefined })
  expect(consoleAccount([credential({ orgID: "org_1" }, false)])).toBeUndefined()
  expect(consoleAccount([])).toBeUndefined()
})

test("console MCPs recognize only managed gateway entries and sort by name", () => {
  const entries = [
    document({
      slack: gateway("slack"),
      github: pinned("github"),
      oauth: { type: "remote", url: `${consoleUrl}/api/integration-gateway/oauth/mcp` },
      other: { type: "remote", url: "https://example.com/mcp", oauth: false },
      local: { type: "local", command: ["x"] },
    }),
  ]

  expect(consoleMcps(entries)).toEqual([
    { name: "github", server: consoleUrl, slug: "github", needsConnection: true, overridden: false },
    { name: "slack", server: consoleUrl, slug: "slack", needsConnection: false, overridden: false },
  ])
})

test("a same-named server in the effective config marks Console's as overridden", () => {
  const offered = [document({ slack: gateway("slack"), github: gateway("github") })]

  const active = [document({ slack: { type: "remote", url: "https://example.com/mcp" }, github: gateway("github") })]

  expect(consoleMcps(offered, active).map((item) => [item.name, item.overridden])).toEqual([
    ["github", false],
    ["slack", true],
  ])
})

test("MCP links open the member's org page, or only Console when the account differs", () => {
  const github = consoleMcps([document({ github: gateway("github") })])[0]

  expect(consoleMcpLinks(github, { server: consoleUrl, orgID: "org 1" })).toEqual({
    manage: `${consoleUrl}/org%201/extensions/mcp/github`,
    connect: `${consoleUrl}/org%201/extensions?connect=github`,
  })
  expect(consoleMcpLinks(github, { server: "https://other.example", orgID: "org_1" })).toEqual({ manage: consoleUrl })
  expect(consoleMcpLinks(github, { server: consoleUrl, orgID: undefined })).toEqual({ manage: consoleUrl })
  expect(consoleMcpLinks(github, undefined)).toEqual({ manage: consoleUrl })
})

test("skills link to Console only for virtual skills while signed in, except the built-ins", () => {
  const account = { server: consoleUrl, orgID: "org_1" }

  const deploy = { id: "deploy", path: "skill://deploy/SKILL.md" }

  expect(consoleSkillLink(deploy, account)).toBe(`${consoleUrl}/org_1/extensions?kind=skills&search=deploy`)
  expect(consoleSkillLink(deploy, { server: consoleUrl, orgID: undefined })).toBe(consoleUrl)
  expect(consoleSkillLink(deploy, undefined)).toBeUndefined()
  expect(consoleSkillLink({ id: "deploy", path: "/home/me/.skills/deploy/SKILL.md" }, account)).toBeUndefined()
  expect(consoleSkillLink({ id: "report", path: "skill://report/SKILL.md" }, account)).toBeUndefined()
})
