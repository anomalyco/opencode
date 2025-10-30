---
name: 'research'
mode: command
display_name: 'Deep Research & Analysis'
category: 'workflow'
subcategory: 'discovery'
description: 'Comprehensive codebase and documentation analysis using specialized agents to gather context and insights'
short_description: 'Research codebase, docs, and external sources'

# HumanLayer-inspired workflow metadata
complexity: intermediate
estimated_time: '10-20 minutes'
workflow_type: 'parallel-then-sequential'
confidence_level: high
success_metrics:
  - 'Comprehensive codebase understanding'
  - 'Relevant documentation discovered'
  - 'External research completed'
  - 'Actionable insights generated'

# Agent orchestration
agent_sequence:
  phase_1:
    name: 'Discovery Phase'
    type: 'parallel'
    agents:
      - name: 'codebase-locator'
        purpose: 'Find relevant files and components'
        timeout: '5 minutes'
      - name: 'thoughts-locator'
        purpose: 'Discover existing documentation'
        timeout: '3 minutes'
  phase_2:
    name: 'Analysis Phase'
    type: 'sequential'
    agents:
      - name: 'codebase-analyzer'
        purpose: 'Understand implementation details'
        depends_on: ['codebase-locator']
        timeout: '8 minutes'
      - name: 'thoughts-analyzer'
        purpose: 'Extract insights from documentation'
        depends_on: ['thoughts-locator']
        timeout: '5 minutes'
  phase_3:
    name: 'External Research'
    type: 'optional'
    agents:
      - name: 'web-search-researcher'
        purpose: 'Gather external context and best practices'
        timeout: '10 minutes'

# Usage guidance
best_for:
  - 'Understanding new codebases'
  - 'Feature research and planning'
  - 'Architecture decision making'
  - 'Debugging complex issues'
  - 'Onboarding new team members'

use_cases:
  - 'Research how authentication is implemented'
  - 'Understand the database schema and relationships'
  - 'Find examples of similar features'
  - 'Analyze performance bottlenecks'
  - 'Research external APIs and integrations'

prerequisites:
  - 'Access to codebase'
  - 'Clear research question or objective'

outputs:
  - 'Comprehensive research report'
  - 'Code analysis with file locations'
  - 'Documentation insights'
  - 'External research findings'
  - 'Recommended next steps'

follow_up_commands:
  - '/plan - Create implementation plan from research'
  - '/execute - Begin implementation'
  - '/review - Validate research findings'

examples:
  - prompt: 'Research user authentication system'
    expected_outcome: 'Complete understanding of auth flow, security measures, and integration points'
  - prompt: 'Research payment processing implementation'
    expected_outcome: 'Analysis of payment flows, security compliance, and error handling'

# Technical configuration
temperature: 0.1
max_tokens: 8192
timeout: '20 minutes'

tags:
  - workflow
  - research
  - analysis
  - discovery
  - codebase
  - documentation
---

# Deep Research & Analysis Command

Conducts comprehensive research across your codebase, documentation, and external sources to provide deep understanding and actionable insights.

## How It Works

This command orchestrates multiple specialized agents in a carefully designed workflow:

### Phase 1: Discovery (Parallel)

- 🔍 **codebase-locator** finds relevant files and components
- 📚 **thoughts-locator** discovers existing documentation and notes

### Phase 2: Analysis (Sequential)

- 🧠 **codebase-analyzer** understands implementation details
- 💡 **thoughts-analyzer** extracts insights from documentation

### Phase 3: External Research (Optional)

- 🌐 **web-search-researcher** gathers external context and best practices

## When to Use

**Perfect for:**

- Starting work on unfamiliar parts of the codebase
- Planning new features or major changes
- Understanding complex systems or architectures
- Debugging issues that span multiple components
- Creating onboarding documentation

**Example Research Questions:**

- "How does the user authentication system work?"
- "What's the current state of our API rate limiting?"
- "How should we implement real-time notifications?"
- "What are the performance bottlenecks in our data processing pipeline?"

## What You'll Get

### Research Report Includes:

- **Code Analysis**: File locations, key functions, and implementation patterns
- **Documentation Insights**: Existing docs, decisions, and context
- **Architecture Overview**: How components interact and data flows
- **External Research**: Best practices, alternatives, and recommendations
- **Action Items**: Specific next steps based on findings

### Sample Output Structure:

```
## Research Summary
- Objective: [Your research question]
- Key Findings: [3-5 major insights]
- Confidence Level: [High/Medium/Low]

## Codebase Analysis
- Core Files: [List with explanations]
- Key Functions: [Important methods and their purposes]
- Data Flow: [How information moves through the system]

## Documentation Insights
- Existing Docs: [Relevant documentation found]
- Past Decisions: [Architecture decisions and reasoning]
- Known Issues: [Documented problems or limitations]

## Recommendations
- Immediate Actions: [What to do first]
- Long-term Considerations: [Strategic recommendations]
- Potential Risks: [Things to watch out for]
```

## Platform-Specific Usage

### Claude Code (.claude.ai/code)

Use direct command arguments with native parsing:

```bash
# Basic research with defaults
/research "How does the authentication system work?"

# Advanced research with explicit parameters
/research "Analyze user session management" --scope=codebase --depth=deep

# Research from ticket file
/research --ticket="docs/tickets/auth-ticket.md" --scope=both --depth=medium
```

**Default Values:**

- `scope`: `"codebase"`
- `depth`: `"medium"`

### OpenCode (opencode.ai)

Use YAML frontmatter format for argument specification:

```yaml
---
name: research
mode: command
scope: codebase
depth: deep
model: anthropic/claude-sonnet-4
temperature: 0.1
---
Analyze the authentication system including user models, session handling, middleware, and security patterns.
```

**Default Values:**

- `scope`: `"both"` (codebase + thoughts)
- `depth`: `"medium"`
- `model`: `"anthropic/claude-sonnet-4"`
- `temperature`: `0.1`

### MCP-Compatible Clients (Cursor, VS Code, etc.)

Use JSON parameter format for structured arguments:

```json
{
  "tool": "research",
  "parameters": {
    "query": "How does the authentication system work?",
    "scope": "codebase",
    "depth": "deep",
    "ticket": "docs/tickets/auth-ticket.md"
  }
}
```

**Default Values:**

- Same as Claude Code defaults
- JSON schema validation
- Structured parameter passing

## Pro Tips

1. **Be Specific**: "Research authentication" vs "Research OAuth2 implementation and session management"
2. **Set Context**: Include any constraints, requirements, or specific areas of focus
3. **Follow Up**: Use results to inform `/plan` and `/execute` commands
4. **Iterate**: Research findings often lead to more specific research questions
5. **Platform Awareness**: Use platform-specific syntax (direct args vs YAML vs JSON) for optimal results

## Enhanced Subagent Orchestration

### Advanced Research Workflow

For complex research requiring deep analysis across multiple domains:

#### Phase 1: Comprehensive Discovery (Parallel Execution)

- **codebase-locator**: Maps all relevant files, components, and directory structures
- **thoughts-locator**: Discovers existing documentation, past decisions, and technical notes
- **codebase-pattern-finder**: Identifies recurring implementation patterns and architectural approaches
- **web-search-researcher**: Gathers external best practices and industry standards (when applicable)

#### Phase 2: Deep Analysis (Sequential Processing)

- **codebase-analyzer**: Provides detailed implementation understanding with file:line evidence
- **thoughts-analyzer**: Extracts actionable insights from documentation and historical context
- **system-architect**: Analyzes architectural implications and design patterns
- **performance-engineer**: Evaluates performance characteristics and optimization opportunities

#### Phase 3: Domain-Specific Assessment (Conditional)

- **database-expert**: Analyzes data architecture and persistence patterns
- **api-builder**: Evaluates API design and integration approaches
- **security-scanner**: Assesses security architecture and potential vulnerabilities
- **compliance-expert**: Reviews regulatory compliance requirements
- **infrastructure-builder**: Analyzes deployment and infrastructure implications

#### Phase 4: Synthesis & Validation (Parallel)

- **code-reviewer**: Validates research findings against code quality standards
- **test-generator**: Identifies testing gaps and coverage requirements
- **quality-testing-performance-tester**: Provides performance benchmarking insights

### Orchestration Best Practices

1. **Parallel Discovery**: Always start with multiple locators running simultaneously for comprehensive coverage
2. **Sequential Analysis**: Process analyzers sequentially to build upon locator findings
3. **Domain Escalation**: Engage domain specialists when research reveals specialized concerns
4. **Validation Gates**: Use reviewer agents to validate findings before synthesis
5. **Iterative Refinement**: Re-engage subagents as new questions emerge from initial findings

### Research Quality Indicators

- **Comprehensive Coverage**: Multiple agents provide overlapping validation
- **Evidence-Based**: All findings include specific file:line references
- **Contextual Depth**: Historical decisions and architectural rationale included
- **Actionable Insights**: Clear next steps and implementation guidance provided
- **Risk Assessment**: Potential issues and constraints identified

### Performance Optimization

- **Agent Sequencing**: Optimized order minimizes redundant analysis
- **Context Sharing**: Agents share findings to avoid duplicate work
- **Early Termination**: Stop analysis when sufficient understanding is achieved
- **Caching Strategy**: Leverage cached results for similar research topics

## Integration with Other Commands

- **→ /plan**: Use research findings to create detailed implementation plans
- **→ /execute**: Begin implementation with full context
- **→ /document**: Create documentation based on research insights
- **→ /review**: Validate that implementation matches research findings

---

_Ready to dive deep? Ask me anything about your codebase and I'll provide comprehensive insights to guide your next steps._
