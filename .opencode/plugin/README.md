# Modern CLI Tools for OpenCode

This directory contains custom tool integrations for enhanced CLI tools that provide better alternatives to standard Unix commands.

## Installed Tools

### 🔍 File & Code Search

- **fd** - Fast file finder (better than `find`)
  - Simpler syntax, blazing speed
  - Ignores `.gitignore` by default
  - Example: `fd -e ts component` finds TypeScript files matching "component"

- **ripgrep (rg)** - Code searcher (better than `grep`)
  - Much faster than grep/ack/ag
  - Respects `.gitignore`
  - Example: `rg "TODO" -t ts` searches for TODO in TypeScript files

- **ast-grep (sg)** - AST-aware code search
  - Searches syntax, not just text
  - Precise refactoring capabilities
  - Example: `sg -p "if ($A) { $B }"` finds all if statements

### 📄 File Display & Navigation

- **bat** - Cat with syntax highlighting
  - Syntax highlighting
  - Git integration
  - Line numbers
  - Example: `bat file.ts -r 10:20` shows lines 10-20 with highlighting

- **eza** - Modern ls replacement
  - Better defaults
  - Tree view, icons, git info
  - Example: `eza -l --git` shows detailed listing with git status

### 🌐 HTTP & Data

- **httpie** - Human-friendly HTTP client (better than `curl`)
  - Cleaner syntax for JSON APIs
  - Colored output, formatted headers
  - Example: `http GET api.example.com/users`

- **jq** - JSON processor
  - Query and transform JSON
  - Example: `jq '.items[].id'` extracts all IDs from items array

### 🔧 Git Tools

- **git-delta** - Better git diff viewer
  - Side-by-side, syntax-colored diffs
  - Easier code reviews in terminal
  - Example: `delta --cached` shows staged changes

## Usage in OpenCode

These tools are automatically loaded as custom OpenCode tools. They can be used by:

1. Direct invocation through OpenCode's tool system
2. Referenced in agent prompts
3. Used in custom workflows

## Tool Files Structure

Each tool is defined in its own TypeScript file following the OpenCode plugin API:

- `description`: Tool description with examples
- `args`: Zod schema for parameters
- `execute`: Async function that runs the tool

## Installation Commands

All tools were installed via Homebrew:

```bash
brew install fd ripgrep ast-grep bat eza httpie git-delta jq
```

## Tool Paths

- fd: `/opt/homebrew/bin/fd`
- rg: `/opt/homebrew/bin/rg`
- sg: `/opt/homebrew/bin/sg`
- bat: `/opt/homebrew/bin/bat`
- eza: `/opt/homebrew/bin/eza`
- http: `/opt/homebrew/bin/http`
- delta: `/opt/homebrew/bin/delta`
- jq: `/usr/bin/jq`

## Notes

- All tools use `.quiet().nothrow()` for graceful error handling
- Tools return friendly "No matches found" / "No result" messages when appropriate
- Zoxide (smart cd) is installed but not integrated as a tool (it's a shell enhancement)
- FZF (fuzzy finder) is installed but not integrated as a tool (it's an interactive TUI)
