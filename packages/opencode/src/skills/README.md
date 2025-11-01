# Claude Code Skill System

A complete TypeScript implementation of Claude Code's skill system with progressive disclosure for optimal token efficiency.

## Overview

This module replicates Claude Code's skill loading and execution system, which allows you to:

- **Discover skills** from multiple locations (project, user, plugins)
- **Match skills** intelligently to user requests using keyword analysis
- **Load skills progressively** - only reading full content when activated
- **Execute skills** with tool restrictions and context management
- **Optimize tokens** by loading only what's needed

## Architecture

### Progressive Disclosure

The system operates in two phases:

**Phase 1: Discovery (Lightweight)**
- Scans skill directories
- Loads only YAML frontmatter (~50-100 tokens per skill)
- Identifies available skills without consuming context

**Phase 2: Activation (On-Demand)**
- Matches skills to user requests
- Loads full content only for activated skills
- Includes SKILL.md, reference.md, examples.md as needed

This allows you to have dozens of skills without paying the token cost unless they're actually used.

## Installation

```bash
npm install yaml
# or
pnpm add yaml
```

## Quick Start

```typescript
import { SkillSystem } from './skills'

// Create and initialize the system
const system = new SkillSystem({
  projectSkillsPath: '.claude/skills',
  userSkillsPath: '~/.claude/skills',
  debug: true,
})

await system.initialize()

// Process a user request - skills auto-activate
const result = await system.processRequest(
  'Create a React component with TypeScript'
)

// Generate context to inject into LLM prompt
const llmContext = system.generatePrompt()

console.log('Activated skills:', result.activated.map(s => s.frontmatter.name))
console.log('Token usage:', result.activated.reduce((sum, s) => sum + s.estimatedTokens, 0))
```

## Skill Structure

### Directory Layout

```
skill-name/
├── SKILL.md          # Required: frontmatter + instructions
├── reference.md      # Optional: detailed docs
├── examples.md       # Optional: code examples
├── scripts/          # Optional: helper scripts
│   └── helper.py
└── templates/        # Optional: reusable templates
    └── template.txt
```

### SKILL.md Format

```yaml
---
name: skill-identifier
description: What this does and when to use it. Include both functionality and activation triggers.
allowed-tools: [Read, Grep, Glob]  # Optional: restrict tools
---

# Skill Content

Instructions and guidelines that load when skill activates...

## When to Use

- Scenario 1
- Scenario 2

See reference.md for detailed API docs.
See examples.md for code samples.
```

## API Reference

### SkillSystem

Main orchestrator class combining loader, matcher, and executor.

```typescript
class SkillSystem {
  // Initialize system (discover all skills)
  async initialize(): Promise<void>

  // Process user request (auto-match and activate)
  async processRequest(request: string, options?: SkillMatchOptions): Promise<{
    matches: SkillMatch[]
    activated: LoadedSkill[]
    context: string
  }>

  // Explicitly activate a skill by name
  async activateSkill(skillName: string, request: string): Promise<LoadedSkill | null>

  // Deactivate a skill
  deactivateSkill(skillName: string): boolean

  // Generate LLM context from active skills
  generatePrompt(): string

  // Get statistics
  getStats(): SkillSystemStats

  // Get all/active skills
  getAllSkills(): SkillMetadata[]
  getActiveSkills(): LoadedSkill[]
}
```

### SkillLoader

Handles skill discovery and progressive loading.

```typescript
class SkillLoader {
  // Discover all skills (load frontmatter only)
  async discoverSkills(): Promise<SkillMetadata[]>

  // Fully load a skill (content + supporting files)
  async loadSkill(skillName: string, options?: SkillLoadOptions): Promise<LoadedSkill | null>

  // Get skill metadata
  getSkillMetadata(skillName: string): SkillMetadata | undefined

  // Unload skill to free tokens
  unloadSkill(skillName: string): boolean
}
```

### SkillMatcher

Intelligently matches skills to user requests.

```typescript
class SkillMatcher {
  // Find matching skills
  async matchSkills(
    skills: SkillMetadata[],
    options: SkillMatchOptions
  ): Promise<SkillMatch[]>

  // Match specific skill by name
  async matchSkillByName(
    skills: SkillMetadata[],
    skillName: string
  ): Promise<SkillMatch | null>
}
```

### SkillExecutor

Manages skill execution and tool restrictions.

```typescript
class SkillExecutor {
  // Activate a skill
  activateSkill(skill: LoadedSkill, request: string): SkillExecutionContext

  // Deactivate a skill
  deactivateSkill(skillName: string): boolean

  // Check if tool is allowed
  isToolAllowed(tool: ToolName): boolean

  // Generate LLM context
  generateLLMContext(): string

  // Get active skills
  getActiveSkills(): LoadedSkill[]
}
```

## Configuration

```typescript
interface SkillSystemConfig {
  // Path to project skills (default: .claude/skills)
  projectSkillsPath?: string

  // Path to user skills (default: ~/.claude/skills)
  userSkillsPath?: string

  // Load plugin skills
  loadPluginSkills?: boolean
  pluginSkillsPaths?: string[]

  // Matching threshold (default: 0.6)
  minConfidenceThreshold?: number

  // Max concurrent skills (default: 3)
  maxActiveSkills?: number

  // Debug logging
  debug?: boolean
}
```

## Examples

### Basic Usage

```typescript
const system = new SkillSystem()
await system.initialize()

const { activated } = await system.processRequest('Create a React component')

console.log(`Activated ${activated.length} skills`)
```

### Event Listening

```typescript
system.on('skill:activated', ({ skill, context }) => {
  console.log(`✅ Activated: ${skill.frontmatter.name}`)
  console.log(`   Tokens: ${skill.estimatedTokens}`)
})

system.on('skill:matched', ({ match }) => {
  console.log(`🎯 Matched: ${match.skill.frontmatter.name} (${match.confidence})`)
})
```

### Context Hints

```typescript
await system.processRequest('Add authentication', {
  context: {
    currentFile: 'src/auth/login.tsx',
    recentTools: ['Read', 'Edit'],
    projectType: 'react',
  },
})
```

### Token Management

```typescript
const system = new SkillSystem({ maxActiveSkills: 2 })

await system.initialize()
await system.processRequest('Create React component')

// Check token usage
const stats = system.getStats()
console.log(`Active tokens: ${stats.activeTokens}`)

// Deactivate to free tokens
system.deactivateSkill('react-components')
```

### LLM Integration

```typescript
const { activated } = await system.processRequest(userMessage)

if (activated.length > 0) {
  const skillContext = system.generatePrompt()

  const fullPrompt = `
${skillContext}

---

User Request: ${userMessage}
`

  const response = await llm.complete(fullPrompt)
}
```

## Testing

```bash
npm run test
# or
npx vitest run src/skills/__tests__/skill-system.test.ts
```

## How It Works

### 1. Discovery Phase

```typescript
await system.initialize()
// Scans .claude/skills/ and ~/.claude/skills/
// Loads only YAML frontmatter from each SKILL.md
// Cost: ~50 tokens per skill
```

### 2. Matching Phase

```typescript
const matches = await system.processRequest('Create a React component')
// Analyzes user request
// Extracts keywords: ["create", "react", "component"]
// Matches against skill descriptions
// Scores based on keyword overlap, phrase matching, trigger words
```

### 3. Loading Phase

```typescript
// For each matched skill:
// - Load full SKILL.md content
// - Load reference.md if exists
// - Load examples.md if exists
// - Calculate token estimate
```

### 4. Execution Phase

```typescript
executor.activateSkill(skill, request)
// Add to active skills
// Apply tool restrictions
// Generate LLM context
```

## Matching Algorithm

The matcher uses multiple heuristics:

1. **Keyword Overlap** (40%) - Jaccard similarity
2. **Phrase Matching** (30%) - Exact phrase detection
3. **Context Hints** (20%) - File type, recent tools, project type
4. **Trigger Words** (30%) - "activate when", "use for" patterns

Total confidence score determines if skill activates.

## Tool Restrictions

Skills can restrict which tools are available:

```yaml
allowed-tools: [Read, Grep, Glob]
```

When active, other tools (Write, Edit, Bash) are restricted. This is useful for:
- Read-only analysis skills
- Security-sensitive operations
- Preventing accidental modifications

## Token Optimization

**Without Progressive Disclosure:**
- 10 skills × 5000 tokens each = 50,000 tokens
- All loaded upfront

**With Progressive Disclosure:**
- 10 skills × 50 tokens (frontmatter) = 500 tokens
- 2 activated skills × 5000 tokens = 10,000 tokens
- **Total: 10,500 tokens (79% reduction)**

## Directory Structure

```
src/skills/
├── types.ts              # TypeScript type definitions
├── skill-loader.ts       # Discovery and loading
├── skill-matcher.ts      # Intelligent matching
├── skill-executor.ts     # Execution and tool restrictions
├── skill-system.ts       # Main orchestrator
├── index.ts              # Public exports
├── README.md             # This file
├── __tests__/
│   └── skill-system.test.ts
└── examples/
    ├── usage.ts          # Usage examples
    └── example-skills/   # Sample skill structures
        ├── react-components/
        │   ├── SKILL.md
        │   ├── reference.md
        │   └── examples.md
        └── api-testing/
            └── SKILL.md
```

## Best Practices

### Writing Good Skill Descriptions

✅ **Good:**
```yaml
description: Use for React component development. Activate when user mentions React, components, hooks, JSX, or functional components. Helpful for creating new components or refactoring class components.
```

❌ **Bad:**
```yaml
description: React helper
```

### Keeping Skills Focused

- One skill = one clear purpose
- Split large skills into focused sub-skills
- Use reference.md for extensive documentation

### Token Efficiency

- Keep SKILL.md content concise
- Move detailed docs to reference.md
- Use examples.md for code samples
- Only load what's needed via SkillLoadOptions

## License

MIT

## Contributing

See example skills in `examples/example-skills/` for reference structures.
