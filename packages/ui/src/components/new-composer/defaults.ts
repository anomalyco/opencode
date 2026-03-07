import type { AtOption, SlashCommand } from "./types"

export const DEFAULT_AT_OPTIONS: AtOption[] = [
  { type: "file", path: "src/auth.ts", display: "src/auth.ts" },
  { type: "file", path: "src/middleware.ts", display: "src/middleware.ts" },
  { type: "file", path: "src/routes/login.ts", display: "src/routes/login.ts" },
  { type: "file", path: "src/utils/token.ts", display: "src/utils/token.ts" },
  { type: "file", path: "src/config/database.ts", display: "src/config/database.ts" },
  { type: "agent", name: "coder", display: "coder" },
  { type: "agent", name: "reviewer", display: "reviewer" },
  { type: "agent", name: "planner", display: "planner" },
]

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "help",
    trigger: "help",
    title: "Help",
    description: "Show available commands",
    type: "builtin",
    keybind: "?",
    source: "command",
  },
  {
    id: "clear",
    trigger: "clear",
    title: "Clear",
    description: "Clear conversation",
    type: "builtin",
    source: "command",
  },
  {
    id: "compact",
    trigger: "compact",
    title: "Compact",
    description: "Compact conversation history",
    type: "builtin",
    source: "command",
  },
  {
    id: "init",
    trigger: "init",
    title: "Init",
    description: "Initialize CLAUDE.md",
    type: "builtin",
    source: "command",
  },
  {
    id: "review",
    trigger: "review",
    title: "Review",
    description: "Review code changes",
    type: "custom",
    source: "skill",
  },
  {
    id: "test",
    trigger: "test",
    title: "Test",
    description: "Run tests",
    type: "custom",
    source: "mcp",
  },
]
