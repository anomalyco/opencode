import { readFile, readdir } from "node:fs/promises"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import path from "path"

function migrationTimestamp(tag: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) {
    return 0
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

async function loadOpencodeMigrations(): Promise<Array<{ sql: string; timestamp: number; name: string }>> {
  const migrationRoot = path.resolve(__dirname, "../opencode/migration")
  const entries = await readdir(migrationRoot, { withFileTypes: true })

  const directories = entries
    .filter((entry) => entry.isDirectory() && /^\d{14}/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  return Promise.all(
    directories.map(async (name) => ({
      name,
      sql: await readFile(path.join(migrationRoot, name, "migration.sql"), "utf8"),
      timestamp: migrationTimestamp(name),
    })),
  )
}

export default defineConfig(async () => {
  const opencodeMigrations = await loadOpencodeMigrations()

  return {
  root: __dirname,
  plugins: [
    nodePolyfills({
      include: [
        "path",
        "util",
        "stream",
        "events",
        "buffer",
        "url",
        "string_decoder",
        "querystring",
        "crypto",
        "assert",
        "http",
        "https",
        "net",
        "tls",
        "zlib",
        "tty",
      ],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  define: {
    OPENCODE_VERSION: JSON.stringify("browser-0.0.1"),
    OPENCODE_CHANNEL: JSON.stringify("browser"),
    OPENCODE_MIGRATIONS: JSON.stringify(opencodeMigrations),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: {
      // OpenCode source imports
      "opencode": path.resolve(__dirname, "../opencode/src"),
      "@": path.resolve(__dirname, "src"),

      // === Native module shims ===

      // Database: bun:sqlite / #db → sql.js shim
      "#db": path.resolve(__dirname, "src/shims/db.browser.ts"),
      "bun:sqlite": path.resolve(__dirname, "src/shims/bun-sqlite.browser.ts"),
      "drizzle-orm/bun-sqlite": path.resolve(__dirname, "src/shims/drizzle-bun-sqlite.browser.ts"),
      "drizzle-orm/bun-sqlite/migrator": path.resolve(__dirname, "src/shims/drizzle-bun-sqlite-migrator.browser.ts"),

      // PTY: bun-pty → stub
      "bun-pty": path.resolve(__dirname, "src/shims/pty.browser.ts"),

      // File watching → stub
      "@parcel/watcher": path.resolve(__dirname, "src/shims/watcher.browser.ts"),
      "chokidar": path.resolve(__dirname, "src/shims/watcher.browser.ts"),

      // XDG paths → browser shim
      "xdg-basedir": path.resolve(__dirname, "src/shims/xdg.browser.ts"),

      // Clipboard → navigator.clipboard
      "clipboardy": path.resolve(__dirname, "src/shims/clipboard.browser.ts"),

      // Open → window.open
      "open": path.resolve(__dirname, "src/shims/open.browser.ts"),

      // Effect platform-node → browser stubs
      "@effect/platform-node": path.resolve(__dirname, "src/shims/effect-platform-node.browser.ts"),

      // Node modules that need browser shims
      "async_hooks": path.resolve(__dirname, "src/shims/async-hooks.browser.ts"),
      "os": path.resolve(__dirname, "src/shims/os.browser.ts"),
      "node:os": path.resolve(__dirname, "src/shims/os.browser.ts"),
      "fs/promises": path.resolve(__dirname, "src/shims/fs.browser.ts"),
      "node:fs/promises": path.resolve(__dirname, "src/shims/fs.browser.ts"),
      "node:fs": path.resolve(__dirname, "src/shims/fs-sync.browser.ts"),
      "fs": path.resolve(__dirname, "src/shims/fs-sync.browser.ts"),
      "node:child_process": path.resolve(__dirname, "src/shims/child-process.browser.ts"),
      "child_process": path.resolve(__dirname, "src/shims/child-process.browser.ts"),

      // Cross-spawn → stub
      "cross-spawn": path.resolve(__dirname, "src/shims/cross-spawn.browser.ts"),

      // Which → stub
      "which": path.resolve(__dirname, "src/shims/which.browser.ts"),

      // Bonjour → stub
      "bonjour-service": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Tree-sitter → stub
      "tree-sitter-bash": path.resolve(__dirname, "src/shims/stubs.ts"),
      "web-tree-sitter": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Yargs → stub (not needed in browser)
      "yargs": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Hono/bun websocket → stub
      "hono/bun": path.resolve(__dirname, "src/shims/hono-bun.browser.ts"),

      // Glob → browser shim
      "glob": path.resolve(__dirname, "src/shims/glob.browser.ts"),

      // Ignore → browser shim
      "ignore": path.resolve(__dirname, "src/shims/ignore.browser.ts"),

      // Gray matter → stub
      "gray-matter": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Mime types
      "mime-types": path.resolve(__dirname, "src/shims/mime-types.browser.ts"),

      // Zip.js → stub
      "@zip.js/zip.js": path.resolve(__dirname, "src/shims/stubs.ts"),

      // JSONRPC → stub
      "vscode-jsonrpc": path.resolve(__dirname, "src/shims/stubs.ts"),

      // LSP types → stub
      "vscode-languageserver-types": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Solid.js → stub (TUI only)
      "solid-js": path.resolve(__dirname, "src/shims/solid.browser.ts"),
      "solid-js/store": path.resolve(__dirname, "src/shims/solid.browser.ts"),
      "@solid-primitives/event-bus": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@solid-primitives/scheduled": path.resolve(__dirname, "src/shims/stubs.ts"),

      // OpenTUI → stub
      "@opentui/core": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@opentui/solid": path.resolve(__dirname, "src/shims/stubs.ts"),
      "opentui-spinner": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Turndown → stub
      "turndown": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Diff → stub (keep minimal)
      "diff": path.resolve(__dirname, "src/shims/diff.browser.ts"),

      // @pierre/diffs → stub
      "@pierre/diffs": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Octokit → stub
      "@octokit/rest": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@octokit/graphql": path.resolve(__dirname, "src/shims/stubs.ts"),

      // MCP SDK → stub
      "@modelcontextprotocol/sdk": path.resolve(__dirname, "src/shims/stubs.ts"),

      // AWS → stub
      "@aws-sdk/credential-providers": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Google auth → stub
      "google-auth-library": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Clack prompts → stub
      "@clack/prompts": path.resolve(__dirname, "src/shims/stubs.ts"),

      // OpenAuth → stub
      "@openauthjs/openauth": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Agent Client Protocol → stub
      "@agentclientprotocol/sdk": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Semver
      "semver": path.resolve(__dirname, "src/shims/semver.browser.ts"),

      // Strip ANSI
      "strip-ansi": path.resolve(__dirname, "src/shims/strip-ansi.browser.ts"),

      // Fuzzysort → stub
      "fuzzysort": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Minimatch
      "minimatch": path.resolve(__dirname, "src/shims/minimatch.browser.ts"),

      // Workspace packages → stubs
      "@opencode-ai/plugin": path.resolve(__dirname, "src/shims/opencode-plugin.browser.ts"),
      "@opencode-ai/util": path.resolve(__dirname, "src/shims/opencode-util.browser.ts"),
      "@opencode-ai/sdk": path.resolve(__dirname, "src/shims/opencode-sdk.browser.ts"),
      "@opencode-ai/script": path.resolve(__dirname, "src/shims/stubs.ts"),

      // Provider SDKs we don't need → stub (only keep anthropic)
      "@ai-sdk/amazon-bedrock": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/azure": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/cerebras": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/cohere": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/deepinfra": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/gateway": path.resolve(__dirname, "src/shims/ai-sdk-gateway.browser.ts"),
      "@ai-sdk/google": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/google-vertex": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/groq": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/mistral": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/openai": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/openai-compatible": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/perplexity": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/togetherai": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/vercel": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@ai-sdk/xai": path.resolve(__dirname, "src/shims/stubs.ts"),
      "@openrouter/ai-sdk-provider": path.resolve(__dirname, "src/shims/stubs.ts"),
      "ai-gateway-provider": path.resolve(__dirname, "src/shims/stubs.ts"),
      "gitlab-ai-provider": path.resolve(__dirname, "src/shims/stubs.ts"),
      "opencode-gitlab-auth": path.resolve(__dirname, "src/shims/stubs.ts"),
    },
  },
  optimizeDeps: {
    include: ["sql.js"],
    exclude: ["bun:sqlite", "os", "node:os"],
  },
  build: {
    target: "esnext",
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5199,
  },
  }
})
