import { createMemo, createSignal, For } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "@tui/context/theme"

const themeCount = Object.keys(DEFAULT_THEMES).length
const themeTip = `Use {highlight}/theme{/highlight} or {highlight}Ctrl+X T{/highlight} to switch between ${themeCount} built-in themes`

type TipPart = { text: string; highlight: boolean }

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

export function Tips() {
  const theme = useTheme().theme
  const parts = parse(TIPS[Math.floor(Math.random() * TIPS.length)])

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● Tip{" "}
      </text>
      <text flexShrink={1}>
        <For each={parts}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

const TIPS = [
  "Type {highlight}@{/highlight} followed by a filename to fuzzy search and attach files",
  "Start a message with {highlight}!{/highlight} to run shell commands directly (e.g., {highlight}!ls -la{/highlight})",
  "Press {highlight}Tab{/highlight} to cycle between Build and Plan agents",
  "Use {highlight}/undo{/highlight} to revert the last message and file changes",
  "Use {highlight}/redo{/highlight} to restore previously undone messages and file changes",
  "Run {highlight}/share{/highlight} to create a public link to your conversation at opencode.ai",
  "Drag and drop images into the terminal to add them as context",
  "Press {highlight}Ctrl+V{/highlight} to paste images from your clipboard into the prompt",
  "Press {highlight}Ctrl+X E{/highlight} or {highlight}/editor{/highlight} to compose messages in your external editor",
  "Run {highlight}/init{/highlight} to auto-generate project rules based on your codebase",
  "Run {highlight}/models{/highlight} or {highlight}Ctrl+X M{/highlight} to see and switch between available AI models",
  themeTip,
  "Press {highlight}Ctrl+X N{/highlight} or {highlight}/new{/highlight} to start a fresh conversation session",
  "Use {highlight}/sessions{/highlight} or {highlight}Ctrl+X L{/highlight} to list and continue previous conversations",
  "Run {highlight}/compact{/highlight} to summarize long sessions near context limits",
  "Press {highlight}Ctrl+X X{/highlight} or {highlight}/export{/highlight} to save the conversation as Markdown",
  "Press {highlight}Ctrl+X Y{/highlight} to copy the assistant's last message to clipboard",
  "Press {highlight}Ctrl+P{/highlight} to see all available actions and commands",
  "Run {highlight}/connect{/highlight} to add API keys for 75+ supported LLM providers",
  "The leader key is {highlight}Ctrl+X{/highlight}; combine with other keys for quick actions",
  "Press {highlight}F2{/highlight} to quickly switch between recently used models",
  "Press {highlight}Ctrl+X B{/highlight} to show/hide the sidebar panel",
  "Use {highlight}PageUp{/highlight}/{highlight}PageDown{/highlight} to navigate through conversation history",
  "Press {highlight}Ctrl+G{/highlight} or {highlight}Home{/highlight} to jump to the beginning of the conversation",
  "Press {highlight}Ctrl+Alt+G{/highlight} or {highlight}End{/highlight} to jump to the most recent message",
  "Press {highlight}Shift+Enter{/highlight} or {highlight}Ctrl+J{/highlight} to add newlines in your prompt",
  "Press {highlight}Ctrl+C{/highlight} when typing to clear the input field",
  "Press {highlight}Escape{/highlight} to stop the AI mid-response",
  "Switch to {highlight}Plan{/highlight} agent to get suggestions without making actual changes",
  "Use {highlight}@agent-name{/highlight} in prompts to invoke specialized subagents",
  "Press {highlight}Ctrl+X Right/Left{/highlight} to cycle through parent and child sessions",
  "Create {highlight}opencode.json{/highlight} in project root for project-specific settings",
  "Place settings in {highlight}~/.config/opencode/opencode.json{/highlight} for global config",
  "Add {highlight}$schema{/highlight} to your config for autocomplete in your editor",
  "Configure {highlight}model{/highlight} in config to set your default model",
  "Override any keybind in config via the {highlight}keybinds{/highlight} section",
  "Set any keybind to {highlight}none{/highlight} to disable it completely",
  "Configure local or remote MCP servers in the {highlight}mcp{/highlight} config section",
  "OpenCode auto-handles OAuth for remote MCP servers requiring auth",
  "Add {highlight}.md{/highlight} files to {highlight}.opencode/command/{/highlight} to define reusable custom prompts",
  "Use {highlight}$ARGUMENTS{/highlight}, {highlight}$1{/highlight}, {highlight}$2{/highlight} in custom commands for dynamic input",
  "Use backticks in commands to inject shell output (e.g., {highlight}`git status`{/highlight})",
  "Add {highlight}.md{/highlight} files to {highlight}.opencode/agent/{/highlight} for specialized AI personas",
  "Configure per-agent permissions for {highlight}edit{/highlight}, {highlight}bash{/highlight}, and {highlight}webfetch{/highlight} tools",
  'Use patterns like {highlight}"git *": "allow"{/highlight} for granular bash permissions',
  'Set {highlight}"rm -rf *": "deny"{/highlight} to block destructive commands',
  'Configure {highlight}"git push": "ask"{/highlight} to require approval before pushing',
  "OpenCode auto-formats files using prettier, gofmt, ruff, and more",
  'Set {highlight}"formatter": false{/highlight} in config to disable all auto-formatting',
  "Define custom formatter commands with file extensions in config",
  "OpenCode uses LSP servers for intelligent code analysis",
  "Create {highlight}.ts{/highlight} files in {highlight}.opencode/tool/{/highlight} to define new LLM tools",
  "Tool definitions can invoke scripts written in Python, Go, etc",
  "Add {highlight}.ts{/highlight} files to {highlight}.opencode/plugin/{/highlight} for event hooks",
  "Use plugins to send OS notifications when sessions complete",
  "Create a plugin to prevent OpenCode from reading sensitive files",
  "Use {highlight}opencode run{/highlight} for non-interactive scripting",
  "Use {highlight}opencode run --continue{/highlight} to resume the last session",
  "Use {highlight}opencode run -f file.ts{/highlight} to attach files via CLI",
  "Use {highlight}--format json{/highlight} for machine-readable output in scripts",
  "Run {highlight}opencode serve{/highlight} for headless API access to OpenCode",
  "Use {highlight}opencode run --attach{/highlight} to connect to a running server",
  "Run {highlight}opencode upgrade{/highlight} to update to the latest version",
  "Run {highlight}opencode auth list{/highlight} to see all configured providers",
  "Run {highlight}opencode agent create{/highlight} for guided agent creation",
  "Use {highlight}/opencode{/highlight} in GitHub issues/PRs to trigger AI actions",
  "Run {highlight}opencode github install{/highlight} to set up the GitHub workflow",
  "Comment {highlight}/opencode fix this{/highlight} on issues to auto-create PRs",
  "Comment {highlight}/oc{/highlight} on PR code lines for targeted code reviews",
  'Use {highlight}"theme": "system"{/highlight} to match your terminal\'s colors',
  "Create JSON theme files in {highlight}.opencode/themes/{/highlight} directory",
  "Themes support dark/light variants for both modes",
  "Reference ANSI colors 0-255 in custom themes",
  "Use {highlight}{env:VAR_NAME}{/highlight} syntax to reference environment variables in config",
  "Use {highlight}{file:path}{/highlight} to include file contents in config values",
  "Use {highlight}instructions{/highlight} in config to load additional rules files",
  "Set agent {highlight}temperature{/highlight} from 0.0 (focused) to 1.0 (creative)",
  "Configure {highlight}maxSteps{/highlight} to limit agentic iterations per request",
  'Set {highlight}"tools": {"bash": false}{/highlight} to disable specific tools',
  'Set {highlight}"mcp_*": false{/highlight} to disable all tools from an MCP server',
  "Override global tool settings per agent configuration",
  'Set {highlight}"share": "auto"{/highlight} to automatically share all sessions',
  'Set {highlight}"share": "disabled"{/highlight} to prevent any session sharing',
  "Run {highlight}/unshare{/highlight} to remove a session from public access",
  "Permission {highlight}doom_loop{/highlight} prevents infinite tool call loops",
  "Permission {highlight}external_directory{/highlight} protects files outside project",
  "Run {highlight}opencode debug config{/highlight} to troubleshoot configuration",
  "Use {highlight}--print-logs{/highlight} flag to see detailed logs in stderr",
  "Press {highlight}Ctrl+X G{/highlight} or {highlight}/timeline{/highlight} to jump to specific messages",
  "Press {highlight}Ctrl+X H{/highlight} to toggle code block visibility in messages",
  "Press {highlight}Ctrl+X S{/highlight} or {highlight}/status{/highlight} to see system status info",
  "Enable {highlight}tui.scroll_acceleration{/highlight} for smooth macOS-style scrolling",
  "Toggle username display in chat via command palette ({highlight}Ctrl+P{/highlight})",
  "Run {highlight}docker run -it --rm ghcr.io/anomalyco/opencode{/highlight} for containerized use",
  "Use {highlight}/connect{/highlight} with OpenCode Zen for curated, tested models",
  "Commit your project's {highlight}AGENTS.md{/highlight} file to Git for team sharing",
  "Use {highlight}/review{/highlight} to review uncommitted changes, branches, or PRs",
  "Run {highlight}/help{/highlight} or {highlight}Ctrl+X H{/highlight} to show the help dialog",
  "Use {highlight}/details{/highlight} to toggle tool execution details visibility",
  "Use {highlight}/rename{/highlight} to rename the current session",
  "Press {highlight}Ctrl+Z{/highlight} to suspend the terminal and return to your shell",
]
