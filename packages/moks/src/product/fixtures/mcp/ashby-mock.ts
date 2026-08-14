import path from "path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const WRITE_DISABLED = "writes disabled in mock; use moks commit/push"

type Job = {
  id: string
  title: string
  company: string
  status: string
  team: string
  location: string
  level: string
}

type Candidate = {
  id: string
  name: string
  email: string
  job_id: string
  stage: string
  location: string
}

export type AshbyNote = {
  candidate_id: string
  body: string
}

export type AshbyState = {
  jobs: Job[]
  candidates: Candidate[]
  notes: AshbyNote[]
}

export type AshbyWrite =
  | { tool: "change_stage"; candidate_id: string; stage: string }
  | { tool: "create_note"; candidate_id: string; body: string }

type FixtureData = {
  jobs: Job[]
  candidates: Candidate[]
}

const dataPath = path.join(import.meta.dir, "ashby-data.json")
const data = (await Bun.file(dataPath).json()) as FixtureData

const tools = [
  {
    name: "list_jobs",
    description: "List open jobs from Ashby (mock fixture)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_job",
    description: "Get a job by id (mock fixture)",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_candidates",
    description: "List candidates, optionally filtered by job_id (mock fixture)",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
    },
  },
  {
    name: "get_candidate",
    description: "Get a candidate by id (mock fixture)",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "change_stage",
    description: "Change candidate stage (write — denied in mock)",
    inputSchema: {
      type: "object",
      properties: {
        candidate_id: { type: "string" },
        stage: { type: "string" },
      },
      required: ["candidate_id", "stage"],
    },
  },
  {
    name: "create_note",
    description: "Create a candidate note (write — denied in mock)",
    inputSchema: {
      type: "object",
      properties: {
        candidate_id: { type: "string" },
        body: { type: "string" },
      },
      required: ["candidate_id", "body"],
    },
  },
] as const

function text(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    isError,
  }
}

export function applyAshbyWrite(state: AshbyState, write: AshbyWrite) {
  if (!state.notes) state.notes = []
  if (write.tool === "change_stage") {
    const candidate = state.candidates.find((item) => item.id === write.candidate_id)
    if (candidate) {
      candidate.stage = write.stage
      return state
    }
    state.candidates.push({
      id: write.candidate_id,
      name: write.candidate_id,
      email: "",
      job_id: "",
      stage: write.stage,
      location: "",
    })
    return state
  }
  if (write.tool === "create_note") {
    state.notes.push({ candidate_id: write.candidate_id, body: write.body })
  }
  return state
}

async function liveState(cwd = process.cwd()): Promise<AshbyState> {
  const overlay = Bun.file(path.join(cwd, ".moks", "ats.json"))
  if (await overlay.exists()) {
    const loaded = (await overlay.json()) as Partial<AshbyState>
    if (Array.isArray(loaded.jobs) && Array.isArray(loaded.candidates)) {
      return {
        jobs: loaded.jobs,
        candidates: loaded.candidates,
        notes: Array.isArray(loaded.notes) ? loaded.notes : [],
      }
    }
  }
  return { jobs: data.jobs, candidates: data.candidates, notes: [] }
}

export async function handleAshbyTool(name: string, args: Record<string, unknown>, cwd = process.cwd()) {
  if (name === "change_stage" || name === "create_note") {
    return text(WRITE_DISABLED, true)
  }
  const state = await liveState(cwd)
  if (name === "list_jobs") {
    return text(state.jobs.filter((job) => job.status === "open"))
  }
  if (name === "get_job") {
    const id = String(args.id ?? "")
    const job = state.jobs.find((item) => item.id === id)
    if (!job) return text({ error: `job not found: ${id}` }, true)
    return text(job)
  }
  if (name === "list_candidates") {
    const jobId = args.job_id === undefined ? undefined : String(args.job_id)
    const list = jobId ? state.candidates.filter((c) => c.job_id === jobId) : state.candidates
    return text(list)
  }
  if (name === "get_candidate") {
    const id = String(args.id ?? "")
    const candidate = state.candidates.find((item) => item.id === id)
    if (!candidate) return text({ error: `candidate not found: ${id}` }, true)
    return text(candidate)
  }
  return text(`unknown tool: ${name}`, true)
}

export function createAshbyMockServer() {
  const server = new Server({ name: "ashby-mock", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [...tools] }))
  server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
    handleAshbyTool(params.name, (params.arguments ?? {}) as Record<string, unknown>),
  )
  return server
}

export const AshbyMockTools = tools.map((tool) => tool.name)

if (import.meta.main) {
  await createAshbyMockServer().connect(new StdioServerTransport())
}
