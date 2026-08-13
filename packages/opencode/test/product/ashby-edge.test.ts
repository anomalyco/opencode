import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import path from "path"
import { DecisionAts } from "../../src/decision/ats"
import { DecisionVerbs } from "../../src/decision/verbs"
import {
  ASHBY_READ_TOOLS,
  ASHBY_WRITE_TOOLS,
  AshbyMockData,
  AshbyMockScript,
  ashbyMockMcpConfig,
  ashbyPermissionDefaults,
  ashbyToolPermissionKey,
  ashbyWriteDeniedMessage,
  isAshbyWriteTool,
} from "../../src/product/ashby-edge"
import { CandidateCard } from "../../src/product/candidate-card"
import {
  AshbyMockTools,
  applyAshbyWrite,
  createAshbyMockServer,
  handleAshbyTool,
  type AshbyState,
} from "../../src/product/fixtures/mcp/ashby-mock"
import { McpCatalog } from "../../src/mcp/catalog"
import { MCP } from "../../src/mcp/index"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

describe("ashby tool permission keys", () => {
  test("McpCatalog.toolName matches ashby_* keys", () => {
    expect(McpCatalog.toolName("ashby", "list_jobs")).toBe("ashby_list_jobs")
    expect(McpCatalog.toolName("ashby", "get_job")).toBe("ashby_get_job")
    expect(McpCatalog.toolName("ashby", "list_candidates")).toBe("ashby_list_candidates")
    expect(McpCatalog.toolName("ashby", "get_candidate")).toBe("ashby_get_candidate")
    expect(McpCatalog.toolName("ashby", "change_stage")).toBe("ashby_change_stage")
    expect(McpCatalog.toolName("ashby", "create_note")).toBe("ashby_create_note")
    for (const tool of [...ASHBY_READ_TOOLS, ...ASHBY_WRITE_TOOLS]) {
      expect(ashbyToolPermissionKey(tool)).toBe(McpCatalog.toolName("ashby", tool))
    }
  })

  test("isAshbyWriteTool matches only write keys", () => {
    expect(isAshbyWriteTool("ashby_change_stage")).toBe(true)
    expect(isAshbyWriteTool("ashby_create_note")).toBe(true)
    expect(isAshbyWriteTool("ashby_list_jobs")).toBe(false)
    expect(ashbyWriteDeniedMessage()).toContain("moks push")
  })

  test("ashbyPermissionDefaults allows reads and denies writes", () => {
    const permission = ashbyPermissionDefaults()
    for (const tool of ASHBY_READ_TOOLS) {
      expect(permission[ashbyToolPermissionKey(tool)]).toBe("allow")
    }
    for (const tool of ASHBY_WRITE_TOOLS) {
      expect(permission[ashbyToolPermissionKey(tool)]).toBe("deny")
    }
  })

  test("ashbyMockMcpConfig builds local entry", () => {
    expect(ashbyMockMcpConfig(["bun", "run", AshbyMockScript])).toEqual({
      type: "local",
      command: ["bun", "run", AshbyMockScript],
      enabled: true,
    })
  })
})

describe("ashby mock handlers", () => {
  test("fixture data is on disk", async () => {
    expect(await Bun.file(AshbyMockData).exists()).toBe(true)
    expect(await Bun.file(AshbyMockScript).exists()).toBe(true)
  })

  test("lists expected tools via MCP server", async () => {
    const server = createAshbyMockServer()
    const client = new Client({ name: "ashby-edge-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...AshbyMockTools].sort())
    } finally {
      await Promise.all([client.close(), server.close()])
    }
  })

  test("list_jobs and get_candidate return fixture data", async () => {
    const server = createAshbyMockServer()
    const client = new Client({ name: "ashby-edge-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const jobs = await client.callTool({ name: "list_jobs", arguments: {} })
      const jobText = JSON.stringify(jobs)
      expect(jobText).toContain("job_senior_backend")
      expect(jobText).toContain("Senior Backend Engineer")
      expect(jobText).not.toContain("job_closed_fe")

      const candidate = await client.callTool({ name: "get_candidate", arguments: { id: "cand_jordan_lee" } })
      const candidateText = JSON.stringify(candidate)
      expect(candidateText).toContain("Jordan Lee")
      expect(candidateText).toContain("job_senior_backend")
    } finally {
      await Promise.all([client.close(), server.close()])
    }
  })

  test("change_stage and create_note return error content", async () => {
    const stage = await handleAshbyTool("change_stage", { candidate_id: "cand_jordan_lee", stage: "offer" })
    expect(stage.isError).toBe(true)
    expect(stage.content[0].text).toContain("writes disabled in mock")
    expect(stage.content[0].text).toContain("moks commit/push")

    const note = await handleAshbyTool("create_note", { candidate_id: "cand_jordan_lee", body: "hi" })
    expect(note.isError).toBe(true)
    expect(note.content[0].text).toContain("writes disabled in mock")
  })

  test("applyAshbyWrite mutates mock state", () => {
    const state: AshbyState = {
      jobs: [],
      candidates: [
        {
          id: "cand_jordan_lee",
          name: "Jordan Lee",
          email: "",
          job_id: "job_senior_backend",
          stage: "technical_screen",
          location: "",
        },
      ],
      notes: [],
    }
    applyAshbyWrite(state, { tool: "change_stage", candidate_id: "cand_jordan_lee", stage: "offer" })
    applyAshbyWrite(state, { tool: "create_note", candidate_id: "cand_jordan_lee", body: "strong" })
    expect(state.candidates[0].stage).toBe("offer")
    expect(state.notes).toEqual([{ candidate_id: "cand_jordan_lee", body: "strong" }])
  })

  test("push --execute writes .moks/ats.json", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
        await CandidateCard.write(dir, {
          id: "cand_jordan_lee",
          stage: "offer",
          ats_id: "cand_jordan_lee",
          extra: { name: "Jordan Lee" },
          body: "# Jordan Lee\n",
        })
      },
    })
    const committed = await DecisionVerbs.commit({
      action: "offer",
      target: { kind: "candidate", id: "cand_jordan_lee" },
      reason: "strong",
      cwd: tmp.path,
    })
    const result = await DecisionVerbs.push({
      commit_id: committed.receipt.id,
      cwd: tmp.path,
      confirm: true,
      dry_run: false,
    })
    expect(result.ok).toBe(true)
    const cache = await DecisionAts.loadCache(tmp.path)
    expect(cache.candidates.find((item) => item.id === "cand_jordan_lee")?.stage).toBe("offer")
    expect(cache.notes.some((item) => item.body === "strong")).toBe(true)
    expect(await Bun.file(path.join(tmp.path, ".moks/ats.json")).exists()).toBe(true)
  })
})

const it = testEffect(LayerNode.compile(MCP.node))

it.instance("MCP.Service connects ashby mock and exposes read tools", () =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    yield* mcp.add(
      "ashby",
      ashbyMockMcpConfig([process.execPath, path.resolve(AshbyMockScript)]),
    )
    const tools = yield* mcp.tools()
    expect(Object.keys(tools).sort()).toEqual(
      [
        "ashby_list_jobs",
        "ashby_get_job",
        "ashby_list_candidates",
        "ashby_get_candidate",
        "ashby_change_stage",
        "ashby_create_note",
      ].sort(),
    )
    const listJobs = tools["ashby_list_jobs"]
    expect(listJobs).toBeDefined()
    if (!listJobs) return
    const result = yield* Effect.promise(() =>
      listJobs.client.callTool({ name: "list_jobs", arguments: {} }, undefined, {
        timeout: listJobs.timeout,
      }),
    )
    expect(JSON.stringify(result)).toContain("Northline Analytics")
  }),
)
