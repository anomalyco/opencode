/**
 * Recommended MCP and tool extensions for CoBuilder.
 *
 * Adding a new recommendation: append an entry to RECOMMENDED_TOOLS.
 * It will automatically appear in `cobuilder onboard` on the user's next run.
 */

export type McpEntry = {
  /** Key written to opencode.json mcp object */
  id: string
  label: string
  hint: string
  source: string
  /** Category shown in onboarding */
  type: "mcp" | "cli"
  /**
   * For type "mcp": the config block written directly into opencode.json under mcp[id].
   * For type "cli": not used.
   */
  mcpConfig?: {
    type: "local"
    command: string[]
    environment?: Record<string, string>
  }
  /**
   * For type "cli": sequential shell commands to run during install.
   * Each command is run in order; failure halts the sequence.
   */
  installCommands?: string[]
  /** Shown to user when install fails, so they can do it manually. */
  manualInstall: string
}

export const RECOMMENDED_TOOLS: McpEntry[] = [
  {
    id: "context-mode",
    label: "context-mode",
    hint: "Sandboxes tool output to protect context window — prevents token floods from large files, logs, and API responses",
    source: "https://github.com/mksglu/context-mode",
    type: "mcp",
    mcpConfig: {
      type: "local",
      command: ["npx", "-y", "context-mode"],
    },
    manualInstall: "npm install -g context-mode\nThen add to opencode.json: { \"mcp\": { \"context-mode\": { \"type\": \"local\", \"command\": [\"context-mode\"] } } }",
  },
  {
    id: "agent-browser",
    label: "agent-browser",
    hint: "Headless browser automation CLI for AI agents — lets CoBuilder navigate, click, and extract from web pages",
    source: "https://github.com/vercel-labs/agent-browser",
    type: "cli",
    installCommands: [
      "npm install -g agent-browser",
      "agent-browser install",
    ],
    manualInstall: "npm install -g agent-browser && agent-browser install",
  },
]
