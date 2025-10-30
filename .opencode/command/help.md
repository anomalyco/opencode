---
name: help
description: Get help with using opencode and codeflow development workflows
version: 1.0.0
last_updated: 2025-10-15
command_schema_version: 1.0
inputs:
  - name: topic
    type: string
    required: false
    description: Specific topic to get help with
cache_strategy:
  type: agent_specific
  ttl: 7200
  invalidation: time_based
  scope: global
success_signals:
  - 'Help information provided successfully'
  - 'Relevant documentation referenced'
  - 'Workflow guidance delivered'
failure_modes:
  - 'Topic not found in available documentation'
  - 'Unable to access help resources'
  - 'Incomplete or unclear help request'
---

# CodeFlow Development Guidance

This command provides guidance for working with the CodeFlow system and development workflows.

## Purpose

Provide comprehensive guidance for using CodeFlow development workflows, including architecture overview, command usage, and best practices.

## Inputs

- **topic**: Specific topic to get help with (optional)

## Preconditions

- Access to CodeFlow documentation and resources

## Process Phases

### Phase 1: Topic Analysis

1. Analyze the help request or topic
2. Identify relevant documentation sections
3. Determine appropriate guidance level

### Phase 2: Information Gathering

1. Retrieve relevant documentation
2. Extract key concepts and workflows
3. Organize information by category

### Phase 3: Response Generation

1. Structure response with clear sections
2. Include practical examples
3. Provide actionable next steps

## Error Handling

### Unknown Topic

- Phase: topic_analysis
- Expected: Recognized topic or general help request
- Mitigation: Provide general overview and suggest related topics
- Requires user input: false

### Documentation Unavailable

- Phase: information_gathering
- Expected: Accessible documentation resources
- Mitigation: Provide basic guidance from built-in knowledge
- Requires user input: false

## Structured Output

```help-response
{
  "status": "success|error",
  "topic": "requested_topic",
  "sections": ["overview", "commands", "workflows", "examples"],
  "references": ["doc_links"],
  "next_steps": ["suggested_actions"]
}
```

## Success Criteria

### Automated

- Help information delivered
- Relevant sections included
- Clear structure maintained

### Manual

- User understands the guidance
- Information is actionable
- Appropriate detail level provided

## Edge Cases

### Broad Request

- Provide overview of all major areas
- Include navigation guidance

### Technical Depth

- Balance detail with accessibility
- Reference advanced documentation

## Anti-Patterns

- Information overload
- Unstructured responses
- Missing practical examples

## Caching Guidelines

### Cache Usage

- Store help responses for common topics
- Cache documentation references
- Maintain topic index

### Invalidation

- Manual: When documentation updates
- Time-based: Weekly refresh for dynamic content

This command provides guidance for working with the CodeFlow system and development workflows.

## Development Commands

- **Type checking**: `npm run typecheck` or `bun run typecheck` - Runs TypeScript compiler without emitting files
- **Installation**: `bun install && bun run install` - Installs dependencies and links the CLI globally

## Architecture Overview

This is a **Codeflow Automation Enhancement CLI** built with **Bun** and **TypeScript** that manages agents and commands for AI-assisted development workflows.

### Core Structure

- **CLI Entry Point**: `src/cli/index.ts` - Main CLI with core MVP commands
- **Agent Definitions**: `/agent/` - Specialized subagents for codebase analysis and research
- **Command Prompts**: `/command/` - Complex workflow commands that orchestrate multiple agents
- **Workflow Documentation**: `/README.md` - Contains the full codeflow automation process

### Key Components

**CLI Commands** (MVP):

- `codeflow setup [project-path]` - Sets up codeflow directory structure and copies agents/commands
- `codeflow status [project-path]` - Checks which files are up-to-date or outdated
- `codeflow sync [project-path]` - Synchronizes agents and commands with global configuration
- `codeflow convert` - Converts agents between different formats
- `codeflow watch start` - Starts file watching for automatic synchronization

**Core Workflow Agent Types**:

- `codebase-locator` - Finds WHERE files and components exist
- `codebase-analyzer` - Understands HOW specific code works
- `codebase-pattern-finder` - Discovers similar implementation patterns
- `research-locator` - Discovers existing documentation about topics
- `research-analyzer` - Extracts insights from specific documents
- `web-search-researcher` - Performs targeted web research

**Specialized Domain Agents** (Claude Code format):

- `operations_incident_commander` - Incident response leadership and coordination
- `development_migrations_specialist` - Database schema migrations and data backfills
- `quality-testing_performance_tester` - Performance testing and bottleneck analysis
- `programmatic_seo_engineer` - Large-scale SEO architecture and content generation
- `content_localization_coordinator` - i18n/l10n workflow coordination

**Base Agent Architecture**:

- **Source of Truth**: `codeflow-agents/` - Base agents in hierarchical structure by domain
- **Platform Conversion**: Agents are converted to platform-specific formats on setup
- **OpenCode Format**: Converted to `.opencode/agent/` with proper permissions and configuration

**Agent Categories** (Base Format):

- `agent-architect` - Meta-agent for creating specialized AI agents
- `smart-subagent-orchestrator` - Complex multi-domain project coordination
- `ai-integration-expert`, `api-builder`, `database-expert`, `full-stack-developer`
- `growth-engineer`, `security-scanner`, `ux-optimizer` and others

**Command Workflows**:

- `/research` - Comprehensive codebase and documentation analysis
- `/plan` - Creates detailed implementation plans from tickets and research
- `/execute` - Implements plans with proper verification
- `/test` - Generates comprehensive test suites for implemented features
- `/document` - Creates user guides, API docs, and technical documentation
- `/commit` - Creates commits with structured messages
- `/review` - Validates implementations against original plans
- `/continue` - Resume execution from the last completed step

**Slash Commands Available**:

- **Claude Code**: Commands in `.claude/commands/` (YAML frontmatter format)
- **OpenCode**: Commands in `.opencode/command/` (YAML frontmatter with agent/model specs)
- Use `codeflow commands` to list all available slash commands and their descriptions
- Commands are automatically copied to projects via `codeflow setup [project-path]`

### Workflow Philosophy

The system emphasizes **context compression** and **fresh analysis** over caching. Each phase uses specialized agents to gather only the essential information needed for the next phase, enabling complex workflows within context limits.

**Critical Patterns**:

- Always run locator agents first in parallel, then run analyzer agents only after locators complete. This prevents premature analysis without proper context.
- Use specialized domain agents selectively based on the research or implementation domain (operations, database migrations, performance, SEO, localization)
- Agents have defined handoff targets for complex scenarios - follow escalation paths when needed

### Development Notes

- Uses **Bun runtime** for fast TypeScript execution
- CLI binary linked via `bun link` for global access
- TypeScript configured for ES modules with Bun-specific types
- Comprehensive test framework with unit, integration, and E2E tests
- See `AGENT_REGISTRY.md` for complete agent capabilities and usage guidelines

## Subagent Usage Guidelines

**ALWAYS use the appropriate specialized subagents** for complex tasks instead of attempting to handle everything directly. This ensures thorough, accurate, and efficient execution.

### When to Use Subagents

- **Research Tasks**: Use `codebase-locator` + `research-locator` first, then `codebase-analyzer` + `research-analyzer`
- **Code Analysis**: Use `codebase-analyzer` for understanding implementation details
- **Testing**: Use `test-generator` for creating comprehensive test suites
- **Documentation**: Use `research-analyzer` for synthesizing information into structured docs
- **Complex Multi-step Tasks**: Use `smart-subagent-orchestrator` for coordination
- **Web Research**: Use `web-search-researcher` for external information gathering
- **Architecture Decisions**: Use `system-architect` for design and planning

### Subagent Coordination Best Practices

1. **Start with Locators**: Always run locator agents first to gather comprehensive context
2. **Parallel Execution**: Run same-type agents concurrently when possible
3. **Sequential Analysis**: Run analyzers only after locators complete
4. **Specialized Domains**: Use domain-specific agents (security-scanner, database-expert, etc.) for specialized tasks
5. **Complex Orchestration**: Use `smart-subagent-orchestrator` for multi-domain coordination
6. **Quality Validation**: Use `code-reviewer` for code quality assessment

### Common Subagent Patterns

- **Codebase Research**: `codebase-locator` → `codebase-analyzer` → `codebase-pattern-finder`
- **Documentation Tasks**: `research-locator` → `research-analyzer` → document synthesis
- **Implementation**: `system-architect` → `full-stack-developer` → `code-reviewer`
- **Testing**: `test-generator` → integration testing → `quality-testing-performance-tester`
- **Web Research**: `web-search-researcher` for external information gathering

### Subagent Selection Criteria

- **Task Complexity**: Use specialized agents for complex, multi-step tasks
- **Domain Expertise**: Choose agents with relevant domain knowledge
- **Output Requirements**: Select agents that produce the required output format
- **Context Limits**: Use agents to work within context constraints efficiently

**Remember**: Subagents are designed to handle specific types of work better than general assistance. Always leverage their specialized capabilities for optimal results.

## Argument Handling & Defaults

### Platform-Specific Argument Patterns

#### Claude Code (.claude.ai/code)

Claude Code uses native argument parsing and provides defaults automatically:

```bash
# Arguments are passed directly to commands
/research "Analyze authentication system" --scope=codebase --depth=deep
/plan --files="docs/tickets/auth-ticket.md,docs/research/auth-research.md" --scope=feature
/execute --plan_path="docs/plans/oauth-implementation.md" --start_phase=1
```

**Default Values**:

- `scope`: `"codebase"` (for research), `"feature"` (for plan)
- `depth`: `"medium"` (for research)
- `start_phase`: `1` (for execute)
- `strictness`: `"standard"` (for review)

#### OpenCode (opencode.ai)

OpenCode requires explicit argument specification with YAML frontmatter:

```yaml
---
name: research
mode: command
scope: codebase
depth: deep
model: anthropic/claude-sonnet-4
temperature: 0.1
---
Research query here...
```

**Default Values**:

- `scope`: `"both"` (codebase + thoughts)
- `depth`: `"medium"`
- `model`: `"anthropic/claude-sonnet-4"`
- `temperature`: `0.1`

#### MCP-Compatible Clients (Cursor, VS Code, etc.)

MCP clients use JSON parameter format for structured argument passing:

```json
{
  "tool": "research",
  "parameters": {
    "query": "Analyze authentication system",
    "scope": "codebase",
    "depth": "deep",
    "ticket": "docs/tickets/auth-ticket.md"
  }
}
```

**Default Values**:

- Same as Claude Code defaults
- JSON schema validation
- Structured parameter passing

### Date Formatting

Both platforms use current date for research documents:

- **Format**: `YYYY-MM-DDTHH:MM:SSZ` (ISO 8601)
- **Source**: Current system time when command executes
- **Example**: `2025-09-27T12:00:00Z` (not `2025-01-26T...`)

### OpenCode Documentation Reference

For complete OpenCode command syntax and options, see:

- **Official Docs**: https://opencode.ai/docs/commands
- **Agent Format**: https://opencode.ai/docs/agents
- **YAML Frontmatter**: https://opencode.ai/docs/yaml-format
