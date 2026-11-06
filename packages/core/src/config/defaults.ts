export * as ConfigDefaults from "./defaults.js"

// harpcode's built-in settings, loaded as the lowest config layer so any user,
// project, or managed file overrides them. Written in the V1 shape; ConfigNormalize
// migrates it like any other document.
export const text = JSON.stringify({
  // Upstream releases would replace this fork's binary.
  update: "disable",
  model: "llamacpp/tiel-coder",
  provider: {
    llamacpp: {
      npm: "@ai-sdk/openai-compatible",
      name: "llama.cpp",
      options: {
        baseURL: "http://127.0.0.1:8008/v1",
        apiKey: "local",
        timeout: 900000,
        chunkTimeout: 300000,
      },
      models: {
        "tiel-coder": {
          name: "Tiel Coder 35B-A3B",
          limit: { context: 65536, output: 8192 },
        },
      },
    },
  },
  // Local models handle direct tool calls better than CodeMode, and every hidden
  // tool shortens the prompt they must process first.
  tools: {
    execute: false,
    "artifact_*": false,
    "schedule*": false,
    "worktree_*": false,
    "session_*": false,
  },
  mcp: {
    gh_grep: { type: "remote", url: "https://mcp.grep.app", oauth: false, enabled: true },
    context7: { type: "remote", url: "https://mcp.context7.com/mcp", oauth: false, enabled: true },
    github: {
      type: "remote",
      url: "https://api.githubcopilot.com/mcp/",
      oauth: false,
      headers: {
        Authorization: "Bearer {env:GITHUB_PERSONAL_ACCESS_TOKEN}",
        "X-MCP-Toolsets": "repos,issues,pull_requests",
      },
      enabled: false,
    },
    google: {
      type: "local",
      command: ["workspace-mcp", "--single-user", "--tool-tier", "core", "--tools", "drive", "docs", "sheets", "gmail", "calendar"],
      environment: {
        GOOGLE_OAUTH_CLIENT_ID: "{env:GOOGLE_OAUTH_CLIENT_ID}",
        GOOGLE_OAUTH_CLIENT_SECRET: "{env:GOOGLE_OAUTH_CLIENT_SECRET}",
        OAUTHLIB_INSECURE_TRANSPORT: "1",
      },
      enabled: false,
    },
  },
})
