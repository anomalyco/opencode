// P-ORACLE for crates/store/src/target.rs: runs TypeScript's resolveSessionTarget, createWorktreeLocation, and
// parseSessionTargetModel over the cases of packages/cli/test/session-target.test.ts and a few more, against a
// scripted server. Each case records the requests the client sent, what `prepare` saw, and the result or error.
// Writes parity/fixtures/F.8/session-target.json; crates/store/tests/target_oracle.rs serves the same routes to the
// Rust port and compares.
import { OpenCode } from "@opencode/client/promise"
import {
  createWorktreeLocation,
  parseSessionTargetModel,
  resolveSessionTarget,
  SessionTargetMutationError,
} from "../../../cli/src/session-target.ts"

type Reply = { status: number; body?: unknown }
// A route answers requests with its method and path, and with every listed query value. Replies are used in order;
// the last one repeats.
type Route = { method: string; path: string; query?: Record<string, string>; replies: Reply[] }
type Recorded = { method: string; path: string; query: [string, string][]; body: unknown }

function location(directory: string, project = directory) {
  return { directory, project: { id: "project", directory: project, canonical: project } }
}

function session(id: string, directory: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    projectID: "project",
    title: id,
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    ...extra,
  }
}

const notFound = (id: string): Reply => ({
  status: 404,
  body: { _tag: "SessionNotFoundError", sessionID: id, message: `Session not found: ${id}` },
})
const ok = (body: unknown): Reply => ({ status: 200, body })
const getLocation = (directory: string, query?: Record<string, string>): Route => ({
  method: "GET",
  path: "/api/location",
  query,
  replies: [ok(location(directory))],
})

type TargetCase = {
  name: string
  input: {
    directory?: string
    continue?: boolean
    session?: string
    fork?: boolean
    model?: { providerID: string; id: string; variant?: string }
    agent?: string
    environment?: Record<string, string>
  }
  // `prepare` keeps the model and returns this agent, or the one it was given.
  prepare?: { agent?: string }
  routes: Route[]
}

const targets: TargetCase[] = [
  {
    name: "adopts an explicit Session location and model",
    input: { session: "ses_resume" },
    routes: [
      {
        method: "GET",
        path: "/api/session/ses_resume",
        replies: [ok({ data: session("ses_resume", "/session", { model: { providerID: "openai", id: "gpt-5" } }) })],
      },
      getLocation("/session"),
    ],
  },
  {
    name: "creates a missing explicit Session with its ID",
    input: { session: "ses_chosen" },
    routes: [
      { method: "GET", path: "/api/session/ses_chosen", replies: [notFound("ses_chosen")] },
      getLocation("/project"),
      { method: "POST", path: "/api/session", replies: [ok({ data: session("ses_chosen", "/project") })] },
    ],
  },
  {
    name: "does not create a missing explicit Session to fork",
    input: { session: "ses_chosen", fork: true },
    routes: [{ method: "GET", path: "/api/session/ses_chosen", replies: [notFound("ses_chosen")] }],
  },
  {
    name: "forks an explicit Session",
    input: { session: "ses_resume", fork: true, agent: "plan" },
    routes: [
      { method: "GET", path: "/api/session/ses_resume", replies: [ok({ data: session("ses_resume", "/session") })] },
      {
        method: "POST",
        path: "/api/session/ses_resume/fork",
        replies: [ok({ data: session("ses_fork", "/session", { agent: "build" }) })],
      },
      getLocation("/session"),
    ],
  },
  {
    name: "paginates to continue the exact directory",
    input: { directory: "/project", continue: true },
    routes: [
      getLocation("/project"),
      {
        method: "GET",
        path: "/api/session",
        replies: [
          ok({
            data: Array.from({ length: 50 }, (_, index) => session(`ses_${index}`, `/other/${index}`)),
            cursor: { next: "page_2" },
          }),
          ok({ data: [session("ses_implicit", "/project")], cursor: {} }),
        ],
      },
    ],
  },
  {
    name: "continues and forks the latest Session",
    input: { directory: "/project", continue: true, fork: true },
    routes: [
      getLocation("/project"),
      { method: "GET", path: "/api/session", replies: [ok({ data: [session("ses_latest", "/project")], cursor: {} })] },
      { method: "POST", path: "/api/session/ses_latest/fork", replies: [ok({ data: session("ses_fork", "/project") })] },
      getLocation("/project", { "location[directory]": "/project" }),
    ],
  },
  {
    name: "creates a Session when there is none to continue",
    input: { directory: "/empty", continue: true, model: { providerID: "openai", id: "gpt-5", variant: "high" } },
    routes: [
      getLocation("/empty"),
      { method: "GET", path: "/api/session", replies: [ok({ data: [], cursor: { next: "more" } })] },
      { method: "POST", path: "/api/session", replies: [ok({ data: session("ses_new", "/empty") })] },
    ],
  },
  {
    name: "attaches the terminal environment to the resolved local Session",
    input: { session: "ses_resume", environment: { PATH: "/terminal/bin" } },
    routes: [
      { method: "GET", path: "/api/session/ses_resume", replies: [ok({ data: session("ses_resume", "/session") })] },
      getLocation("/session"),
      { method: "PUT", path: "/api/session/ses_resume/environment", replies: [{ status: 204 }] },
    ],
  },
  {
    name: "prepares a fresh Session at the server Location before creation",
    input: { agent: "requested" },
    prepare: { agent: "prepared" },
    routes: [
      getLocation("/server"),
      { method: "POST", path: "/api/session", replies: [ok({ data: session("ses_fresh", "/server") })] },
    ],
  },
  {
    name: "uses the agent resolved by the server for a fresh Session",
    input: {},
    routes: [
      getLocation("/project"),
      {
        method: "POST",
        path: "/api/session",
        replies: [ok({ data: session("ses_fresh", "/project", { agent: "review" }) })],
      },
    ],
  },
  {
    name: "does not retry an ambiguous Session creation",
    input: {},
    routes: [
      getLocation("/project"),
      { method: "POST", path: "/api/session", replies: [{ status: 502, body: "connection closed after create" }] },
    ],
  },
  {
    name: "reports a failed environment upload as a mutation",
    input: { environment: { TERM: "xterm" } },
    routes: [
      getLocation("/project"),
      { method: "POST", path: "/api/session", replies: [ok({ data: session("ses_fresh", "/project") })] },
      { method: "PUT", path: "/api/session/ses_fresh/environment", replies: [{ status: 502, body: "down" }] },
    ],
  },
  {
    name: "reports a failed Session read",
    input: { session: "ses_broken" },
    routes: [{ method: "GET", path: "/api/session/ses_broken", replies: [{ status: 502, body: "down" }] }],
  },
]

type WorktreeCase = { name: string; input: { directory?: string; name?: string }; routes: Route[] }

const worktrees: WorktreeCase[] = [
  {
    name: "creates a worktree from the caller's checkout",
    input: { directory: "/project", name: "pr-12" },
    routes: [
      getLocation("/project"),
      { method: "POST", path: "/api/worktree", replies: [ok({ directory: "/worktrees/pr-12" })] },
    ],
  },
  {
    name: "keeps the caller's subfolder in the new worktree",
    input: { directory: "/project/packages/cli" },
    routes: [
      {
        method: "GET",
        path: "/api/location",
        query: { "location[directory]": "/project/packages/cli" },
        replies: [ok(location("/project/packages/cli", "/project"))],
      },
      {
        method: "GET",
        path: "/api/location",
        query: { "location[directory]": "/worktrees/pr-12/packages/cli" },
        replies: [ok(location("/worktrees/pr-12/packages/cli", "/worktrees/pr-12"))],
      },
      { method: "POST", path: "/api/worktree", replies: [ok({ directory: "/worktrees/pr-12" })] },
    ],
  },
  {
    name: "uses the worktree root when the subfolder is not in the worktree",
    input: { directory: "/project/scratch" },
    routes: [
      {
        method: "GET",
        path: "/api/location",
        query: { "location[directory]": "/project/scratch" },
        replies: [ok(location("/project/scratch", "/project"))],
      },
      {
        method: "GET",
        path: "/api/location",
        query: { "location[directory]": "/worktrees/pr-12/scratch" },
        replies: [{ status: 502, body: "Location folder is missing" }],
      },
      { method: "POST", path: "/api/worktree", replies: [ok({ directory: "/worktrees/pr-12" })] },
    ],
  },
  {
    name: "reports a failed worktree creation as a mutation",
    input: {},
    routes: [getLocation("/project"), { method: "POST", path: "/api/worktree", replies: [{ status: 502, body: "x" }] }],
  },
]

const models = ["openai/gpt-5", "openai/gpt-5#high", "", "gpt-5", "/gpt-5", "openai/", "openai/gpt-5#", "a#b/c", "a/b#c#d", "a/b/c"]

function serve(routes: Route[], recorded: Recorded[]) {
  const used = new Map<Route, number>()
  return OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const text = await request.text()
      recorded.push({
        method: request.method,
        path: url.pathname,
        query: [...url.searchParams.entries()].toSorted(),
        body: text ? JSON.parse(text) : null,
      })
      const route = routes.find(
        (item) =>
          item.method === request.method &&
          item.path === url.pathname &&
          Object.entries(item.query ?? {}).every(([key, value]) => url.searchParams.get(key) === value),
      )
      if (!route) return new Response(`no route for ${request.method} ${url.pathname}`, { status: 599 })
      const index = used.get(route) ?? 0
      used.set(route, index + 1)
      const reply = route.replies[Math.min(index, route.replies.length - 1)]!
      if (reply.body === undefined) return new Response(null, { status: reply.status })
      if (typeof reply.body === "string") return new Response(reply.body, { status: reply.status })
      return Response.json(reply.body, { status: reply.status })
    },
  })
}

function failure(error: unknown) {
  if (error instanceof SessionTargetMutationError) return { kind: "mutation" }
  if (error instanceof Error && error.message === "Session not found") return { kind: "not-found" }
  return { kind: "request" }
}

const targetResults = []
for (const item of targets) {
  const requests: Recorded[] = []
  const client = serve(item.routes, requests)
  let prepared: unknown = null
  const outcome = await resolveSessionTarget({
    client,
    location: item.input.directory === undefined ? undefined : { directory: item.input.directory },
    continue: item.input.continue,
    session: item.input.session,
    fork: item.input.fork,
    model: item.input.model,
    agent: item.input.agent,
    environment: item.input.environment,
    prepare: async (input) => {
      prepared = {
        location: input.location.directory,
        session: input.session?.id ?? null,
        model: input.model ?? null,
        agent: input.agent ?? null,
      }
      return { model: input.model, agent: item.prepare?.agent ?? input.agent }
    },
  }).then(
    (target) => ({
      ok: {
        session: target.session.id,
        location: target.location.directory,
        model: target.model ?? null,
        agent: target.agent ?? null,
        resume: target.resume,
      },
    }),
    (error) => ({ error: failure(error) }),
  )
  targetResults.push({ ...item, expected: { requests, prepared, outcome } })
}

const worktreeResults = []
for (const item of worktrees) {
  const requests: Recorded[] = []
  const client = serve(item.routes, requests)
  const outcome = await createWorktreeLocation({
    client,
    location: item.input.directory === undefined ? undefined : { directory: item.input.directory },
    name: item.input.name,
  }).then(
    (result) => ({ ok: result }),
    (error) => ({ error: failure(error) }),
  )
  worktreeResults.push({ ...item, expected: { requests, outcome } })
}

const modelResults = models.map((value) => {
  try {
    return { value, ok: parseSessionTargetModel(value) ?? null }
  } catch (error) {
    return { value, error: error instanceof Error ? error.message : String(error) }
  }
})

const file = new URL("../fixtures/F.8/session-target.json", import.meta.url).pathname
await Bun.write(
  file,
  JSON.stringify({ targets: targetResults, worktrees: worktreeResults, models: modelResults }, null, 2) + "\n",
)
console.log(`session-target: ${targetResults.length} targets, ${worktreeResults.length} worktrees, ${models.length} models`)
