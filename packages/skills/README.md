# @codesurf/skills

> Progressive skill loading system for LLMs - replicate Claude Code's skill mechanism with 68% token reduction

[![npm version](https://img.shields.io/npm/v/@codesurf/skills.svg)](https://www.npmjs.com/package/@codesurf/skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)

## What is this?

A TypeScript implementation of Claude Code's skill system that uses **progressive disclosure** to minimize LLM token usage. Instead of loading all skill content upfront, skills are discovered lightweight and only fully loaded when activated.

**Key Benefits:**
- 🚀 **68% token reduction** compared to loading everything upfront
- 📊 **Complete visibility** into skill activation and token usage
- 🎯 **LLM-agnostic** - works with any LLM (GPT-4, Claude, Gemini, etc.)
- 🧪 **Fully testable** with comprehensive unit tests
- ⚙️ **Customizable** matching algorithms and confidence thresholds

## Quick Start

### Installation

\`\`\`bash
npm install @codesurf/skills
# or
pnpm add @codesurf/skills
# or
yarn add @codesurf/skills
\`\`\`

### Basic Usage

\`\`\`typescript
import { SkillSystem } from '@codesurf/skills'

// Initialize the system
const system = new SkillSystem({
  projectSkillsPath: '.claude/skills',
  userSkillsPath: '~/.claude/skills',
})

await system.initialize()

// Process a user request
const result = await system.processRequest(
  'Create a React component with TypeScript'
)

// Generate LLM context
const skillContext = system.generatePrompt()

// Inject into your LLM prompt
const response = await llm.chat({
  messages: [
    { role: 'system', content: skillContext },
    { role: 'user', content: userMessage }
  ]
})
\`\`\`

## How It Works

### Progressive Disclosure in Action

\`\`\`
Step 1: Discovery (Load frontmatter only)
  ├─ react-components: ~50 tokens
  ├─ api-testing: ~50 tokens
  └─ Total: ~100 tokens

Step 2: Matching (Calculate relevance)
  ├─ User: "Create React component"
  ├─ react-components: 84.7% confidence
  └─ api-testing: 23.4% confidence

Step 3: Loading (Only activated skills)
  └─ react-components: +1917 tokens

Result: 2017 tokens vs 6315 tokens (68% reduction)
\`\`\`

## Skill Structure

Skills follow a simple directory structure:

\`\`\`
.claude/skills/
└── react-components/
    ├── SKILL.md          # Required: frontmatter + content
    ├── reference.md      # Optional: detailed docs
    └── examples.md       # Optional: code examples
\`\`\`

### SKILL.md Format

\`\`\`yaml
---
name: react-components
description: Use when creating React components. Activate for React development, component creation, or JSX work.
allowed-tools: [Read, Write, Edit, Grep, Glob]
---

# React Components Skill

Guidelines for creating high-quality React components...
\`\`\`

## API Reference

### SkillSystem

Main class for managing skills.

\`\`\`typescript
class SkillSystem {
  // Initialize and discover skills
  async initialize(): Promise<void>

  // Process user request and auto-activate skills
  async processRequest(
    request: string,
    options?: SkillMatchOptions
  ): Promise<{
    matches: SkillMatch[]
    activated: LoadedSkill[]
    context: string
  }>

  // Generate LLM context from active skills
  generatePrompt(): string

  // Get statistics
  getStats(): SkillSystemStats

  // Event emitter for monitoring
  on(event: string, handler: Function): this
}
\`\`\`

### Configuration

\`\`\`typescript
interface SkillSystemConfig {
  // Skill directory paths
  projectSkillsPath?: string        // default: '.claude/skills'
  userSkillsPath?: string           // default: '~/.claude/skills'

  // Matching configuration
  minConfidenceThreshold?: number   // default: 0.6
  maxActiveSkills?: number          // default: 3

  // Optional features
  loadPluginSkills?: boolean
  pluginSkillsPaths?: string[]
  debug?: boolean
}
\`\`\`

## Examples

### With Context Hints

Improve matching accuracy by providing context:

\`\`\`typescript
await system.processRequest('Fix authentication', {
  context: {
    currentFile: 'src/auth/login.tsx',
    projectType: 'react',
    recentTools: ['Read', 'Edit']
  }
})
\`\`\`

### Event Monitoring

Listen to skill activation events:

\`\`\`typescript
system.on('skill:activated', ({ skill, context }) => {
  console.log(\`✅ Activated: \${skill.frontmatter.name}\`)
  console.log(\`   Tokens: \${skill.estimatedTokens}\`)
})

system.on('skill:matched', ({ match }) => {
  console.log(\`🎯 Matched: \${match.skill.frontmatter.name}\`)
  console.log(\`   Confidence: \${match.confidence}\`)
})
\`\`\`

### Manual Control

Explicit skill activation:

\`\`\`typescript
// Activate a specific skill
const skill = await system.activateSkill('react-components', 'user request')

// Deactivate when done
system.deactivateSkill('react-components')

// Check if active
if (system.isSkillActive('react-components')) {
  console.log('Skill is active')
}
\`\`\`

### Token Management

Monitor and control token usage:

\`\`\`typescript
const stats = system.getStats()

console.log(\`Total skills: \${stats.totalSkills}\`)
console.log(\`Active skills: \${stats.activeSkills}\`)
console.log(\`Active tokens: \${stats.activeTokens}\`)
console.log(\`Discovery tokens: \${stats.discoveryTokens}\`)

// Limit concurrent skills
const system = new SkillSystem({
  maxActiveSkills: 2  // Only 2 skills active at once
})
\`\`\`

## Performance

Based on comprehensive benchmarks (see [BENCHMARKS.md](./BENCHMARKS.md)):

| Metric | @codesurf/skills | Claude Code | Difference |
|--------|------------------|-------------|------------|
| **Token Usage** | 2,017 tokens | 6,315 tokens | **-68%** |
| **Discovery** | 10-15ms | 0ms | +15ms |
| **Matching** | 5-8ms | 0ms | +8ms |
| **Accuracy** | 74.6% | ~96.5% | -21.9% |

**When @codesurf/skills wins:**
- High-volume API usage
- Token costs significant
- Need visibility and control
- Using non-Claude LLMs

**When native wins:**
- Using Claude Code CLI
- Need zero latency
- Semantic accuracy critical

## Use Cases

### ✅ Perfect For

- Custom LLM applications
- High-volume API usage (1000+ requests/min)
- Token-constrained environments
- Development and testing
- Non-Claude LLMs (GPT-4, Gemini, etc.)

### ⚠️ Consider Native Instead

- Using Claude Code CLI already
- Need zero latency overhead
- Ambiguous user requests common
- Simple workflows, few requests

## Advanced Features

### Custom Matching

\`\`\`typescript
import { SkillMatcher } from '@codesurf/skills'

class CustomMatcher extends SkillMatcher {
  async matchSkills(skills, options) {
    // Your custom matching logic
    return super.matchSkills(skills, options)
  }
}
\`\`\`

### Selective Loading

\`\`\`typescript
await system.loadSkill('react-components', {
  loadReference: false,  // Skip reference.md
  loadExamples: false,   // Skip examples.md
  maxTokens: 1000       // Token limit
})
\`\`\`

### Caching

\`\`\`typescript
// Cache discovered skills
const skills = await loadFromCache() || await system.initialize()
saveToCache(skills)
\`\`\`

## TypeScript Support

Fully typed with comprehensive TypeScript definitions:

\`\`\`typescript
import type {
  SkillMetadata,
  LoadedSkill,
  SkillMatch,
  SkillSystemConfig,
  SkillSystemStats
} from '@codesurf/skills'
\`\`\`

## Testing

\`\`\`bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Type checking
npm run typecheck
\`\`\`

## Documentation

- **[BENCHMARKS.md](./BENCHMARKS.md)** - Comprehensive performance benchmarks
- **[LIVE_COMPARISON.md](./LIVE_COMPARISON.md)** - Comparison with Claude Code
- **[REAL_OUTPUT_COMPARISON.md](./REAL_OUTPUT_COMPARISON.md)** - Real output samples

## Contributing

Contributions welcome! Please see our contributing guidelines.

## License

MIT © CodeSurf

## Related Projects

- [Claude Code](https://claude.com/claude-code) - The original inspiration
- [OpenAI GPT](https://openai.com/gpt-4) - Compatible LLM
- [Google Gemini](https://deepmind.google/technologies/gemini/) - Compatible LLM

## Support

- 📖 [Documentation](https://github.com/codesurf/skills)
- 🐛 [Issue Tracker](https://github.com/codesurf/skills/issues)
- 💬 [Discussions](https://github.com/codesurf/skills/discussions)

---

**Made with ❤️ by the CodeSurf team**
