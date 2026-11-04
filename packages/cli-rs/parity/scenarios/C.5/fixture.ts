// Integrations, credentials, and routes the C.5 (`auth`) and C.6 (`mcp`) scenarios share. Nothing here
// is a real account: the fake server answers every request, and URL opens go to a sink (`sink`).
import path from "node:path"
import type { Route } from "../../lib/fake-server"

export const location = { directory: "/srv/project/app" }

const time = { created: 1_762_268_645_123, expires: 1_762_269_245_123 }

export const integrations = [
  {
    id: "openai",
    name: "OpenAI",
    methods: [
      { id: "chatgpt", type: "oauth", label: "ChatGPT Pro/Plus" },
      { type: "key", label: "Manually enter API Key" },
      { type: "env", names: ["OPENAI_API_KEY"] },
    ],
    connections: [
      { type: "credential", id: "cred_aaaaaaaa0001", label: "Work", method: "oauth" },
      { type: "credential", id: "cred_bbbbbbbb0002", label: "Personal", method: "key" },
      { type: "env", name: "OPENAI_API_KEY" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    methods: [{ type: "key" }, { type: "env", names: ["ANTHROPIC_API_KEY"] }],
    connections: [{ type: "env", name: "ANTHROPIC_API_KEY" }],
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    methods: [{ type: "key", label: "OpenCode Go key" }],
    connections: [],
  },
  {
    id: "acme",
    name: "Acme Search",
    methods: [
      {
        id: "token",
        type: "external",
        label: "Acme token",
        form: [
          {
            key: "region",
            type: "string",
            title: "Region",
            options: [
              { value: "us", label: "United States" },
              { value: "eu", label: "Europe", description: "Frankfurt" },
            ],
            required: true,
          },
          { key: "team", type: "string", title: "Team", placeholder: "my-team", minLength: 3 },
          { key: "seats", type: "integer", title: "Seats", minimum: 1, maximum: 50 },
          { key: "beta", type: "boolean", title: "Beta features" },
          {
            key: "scopes",
            type: "multiselect",
            title: "Scopes",
            options: [
              { value: "read", label: "Read" },
              { value: "write", label: "Write" },
            ],
            default: ["read"],
          },
          { key: "plan", type: "string", hidden: true, default: "pro" },
          { key: "eu-only", type: "string", title: "Data residency", when: [{ key: "region", op: "eq", value: "eu" }] },
        ],
      },
    ],
    connections: [],
  },
  {
    id: "mcp-github",
    name: "github",
    metadata: { source: "mcp" },
    methods: [{ id: "oauth", type: "oauth", label: "OAuth" }],
    connections: [{ type: "credential", id: "cred_cccccccc0003", label: "octocat", method: "oauth" }],
  },
  {
    id: "mcp-linear",
    name: "linear",
    metadata: { source: "mcp" },
    methods: [{ id: "oauth", type: "oauth", label: "OAuth" }],
    connections: [],
  },
  {
    id: "zed",
    name: "Zed Cloud",
    methods: [{ id: "cli", type: "command", label: "Zed CLI", command: ["zed", "auth"] }],
    connections: [],
  },
]

export const credentials = [
  {
    id: "cred_aaaaaaaa0001",
    integrationID: "openai",
    label: "Work",
    active: true,
    value: { type: "oauth", methodID: "chatgpt", refresh: "r-1", access: "a-1", expires: 1_762_269_245_123 },
  },
  {
    id: "cred_bbbbbbbb0002",
    integrationID: "openai",
    label: "Personal",
    active: false,
    value: { type: "key", key: "sk-test-personal" },
  },
  {
    id: "cred_cccccccc0003",
    integrationID: "mcp-github",
    label: "octocat",
    active: true,
    value: { type: "oauth", methodID: "oauth", refresh: "r-3", access: "a-3", expires: 0, metadata: { scope: "repo" } },
  },
]

export function integrationRoutes(data: unknown[] = integrations): Route[] {
  return [
    // `loadIntegrations` waits for the default model first.
    { path: "/api/model/default", json: { location, data: null } },
    { path: "/api/integration", json: { location, data } },
  ]
}

export function credentialRoute(data: unknown[] = credentials): Route {
  return { path: "/api/credential", json: { data } }
}

export const oauthRoutes = (integrationID: string, mode: "auto" | "code" = "auto"): Route[] => [
  {
    method: "POST",
    path: `/api/integration/${integrationID}/connect/oauth`,
    json: {
      location,
      data: {
        attemptID: "att_test0001",
        url: "https://auth.example.test/authorize?client=opencode",
        instructions: "Sign in with your browser",
        mode,
        time,
      },
    },
  },
  {
    path: `/api/integration/${integrationID}/connect/oauth/att_test0001`,
    json: { location, data: { status: "complete", time } },
  },
  { method: "POST", path: `/api/integration/${integrationID}/connect/oauth/att_test0001/complete`, status: 204 },
  { method: "DELETE", path: `/api/integration/${integrationID}/connect/oauth/att_test0001`, status: 204 },
]

export const commandRoutes = (integrationID: string): Route[] => [
  {
    method: "POST",
    path: `/api/integration/${integrationID}/connect/command`,
    json: { location, data: { attemptID: "att_test0002", time } },
  },
  {
    path: `/api/integration/${integrationID}/connect/command/att_test0002`,
    json: { location, data: { status: "complete", time } },
  },
  { method: "DELETE", path: `/api/integration/${integrationID}/connect/command/att_test0002`, status: 204 },
]

export const credentialWrites: Route[] = [
  { method: "DELETE", path: "/api/credential/:id", status: 204 },
  { method: "POST", path: "/api/credential/:id/activate", status: 204 },
]

// The URL-opener sink: `xdg-open` for Rust and `BROWSER` for the TS `open` package's bundled `xdg-open`.
// Neither client reaches a real browser.
const sinkDir = path.join(import.meta.dir, "sink")
export const sink = {
  PATH: `${sinkDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  BROWSER: path.join(sinkDir, "browser"),
}

export const exportFile = path.join(import.meta.dir, "credentials.json")
