---
name: agent-tuning
description: Configure and optimize AI coding agents (OpenCode/Claude). Use when setting up or improving agent behavior.
---

## Configuration Locations

### OpenCode
```
~/.config/opencode/
├── opencode.json          # Main config
├── agent/                 # Custom agent prompts
│   ├── ammo_team_lead.md
│   ├── researcher.md
│   ├── implementor_cpp.md
│   ├── tester_cpp.md
│   ├── documentation.md
│   └── truth_teller.md
├── skills/                # Reusable skills
│   └── <name>/SKILL.md
└── rules/                 # Always-active rules
    └── RULES.md
```

### Claude Code
```
~/.claude/
├── settings.json          # Main config
├── agents/                # Custom agents
│   └── <name>.md
├── skills/                # Reusable skills
│   └── <name>/SKILL.md
└── CLAUDE.md              # Global instructions
```

## Agent File Structure

### Frontmatter (YAML)
```yaml
---
tools:
  read: true
  write: false
  edit: false
  glob: true
  grep: true
  bash: true
  task: false
  webfetch: true
  todoread: true
  todowrite: true
  question: true    # Ask user questions
  skill: true       # Load skills

permission:
  bash:
    "git *": allow
    "gh *": allow
    "*": deny
---
```

### Tool Reference

| Tool | Purpose | Risk Level |
|------|---------|------------|
| `read` | Read files | Low |
| `write` | Create/overwrite files | High |
| `edit` | Modify files | High |
| `glob` | Find files by pattern | Low |
| `grep` | Search file contents | Low |
| `list` | List directories | Low |
| `bash` | Execute commands | Variable |
| `task` | Delegate to subagents | Low |
| `webfetch` | Fetch web content | Medium |
| `todoread` | Read task list | Low |
| `todowrite` | Update task list | Low |
| `question` | Ask user questions | Low |
| `skill` | Load skill files | Low |

## Permission Patterns

### Restrictive (Read-Only Agent)
```yaml
tools:
  read: true
  write: false
  edit: false
  bash: true

permission:
  bash:
    "ls *": allow
    "cat *": allow
    "git status": allow
    "*": deny
```

### Permissive (Full Access)
```yaml
tools:
  read: true
  write: true
  edit: true
  bash: true

permission:
  bash:
    "*": allow
```

### Balanced (Common Pattern)
```yaml
tools:
  read: true
  write: true
  edit: true
  bash: true

permission:
  bash:
    # Safe commands
    "ls *": allow
    "cat *": allow
    "head *": allow
    "tail *": allow
    
    # Git operations
    "git *": allow
    
    # C++ build/test toolchain
    "cmake *": allow
    "ctest *": allow
    "clang-tidy *": allow
    
    # Deny everything else
    "*": deny
```

## Agent Roles

### AMMO Team Lead Agent
- Has `task: true` to delegate
- Has `question: true` to interact with user
- Limited direct tool access
- Coordinates other agents

### Researcher Agent
- Read-only access
- Has `webfetch: true`
- Full search tools (glob, grep)
- No `task` (can't delegate)

### Implementor C++ Agent
- Full write access for C++ and build files
- Enforces modern C++ and performance/safety constraints
- Coordinates with tester and documentation gates

### Truth-Teller Reviewer
- Read-only access
- Different model for diversity
- Challenges assumptions
- No write access

### Tester C++ Agent
- Read + write access for test files
- Bash access for `cmake`, `ctest`, sanitizer runs
- Focuses on regression protection and risk reporting

### Documentation Agent
- Write access to docs and diagrams
- Maintains PlantUML and ADR/API docs
- Ensures architecture docs match runtime behavior

## C++ Workflow Gates

- Run a testing gate after implementation (`@tester_cpp`)
- Run a documentation gate when architecture/API behavior changes (`@documentation`)
- For risky refactors, include Truth-Teller challenge before implementation
- Prefer CMake presets and target-scoped options over global flags
- Use `ci-cmake-sanitizers` for GitHub Actions sanitizer matrix setup

## Tuning Tips

### 1. Start Restrictive
Begin with minimal permissions, expand as needed.

### 2. Use Specific Bash Patterns
```yaml
# Good - specific
"ctest --test-dir build --output-on-failure": allow

# Bad - too broad
"*test*": allow
```

### 3. Separate Concerns
- AMMO Team Lead: coordinates
- Researcher: investigates
- Implementor C++: changes code
- Reviewer: validates

### 4. Test Permission Changes
After modifying permissions, test that:
- Allowed commands work
- Denied commands are blocked
- Edge cases are handled

### 5. Preserve Legacy Skills Safely
For C++-centric setups, keep non-C++ skills available but mark them as optional in docs:
- `C++ Core` for default workflows
- `Transferable Core` for general engineering methods
- `Legacy Optional` for domain-specific prompts that are preserved but non-default

## Debugging

### Check Active Config
```bash
# OpenCode
cat ~/.config/opencode/opencode.json

# View agent prompt
cat ~/.config/opencode/agent/<name>.md
```

### Common Issues
- **Tool not working**: Check `tools:` section
- **Command denied**: Check `permission.bash` patterns
- **Skill not loading**: Check skill name matches directory
- **Agent not found**: Check `opencode.json` agent definitions
