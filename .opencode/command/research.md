---
name: research
description: Research codebase using direct query or ticket file
version: 2.1.0-optimized
last_updated: 2025-09-17
command_schema_version: 1.0
inputs:
  - name: current_date
    type: string
    required: false
    description: Current date for research document (auto-generated)
    default: auto
  - name: query
    type: string
    required: false
    description: Direct research question or topic
  - name: ticket
    type: string
    required: false
    description: Path to ticket file (optional if query provided)
  - name: scope
    type: string
    required: false
    description: Research scope hint (codebase|research|both)
  - name: depth
    type: string
    required: false
    description: Research depth (shallow|medium|deep)
outputs:
  - name: research_document
    type: structured
    format: JSON with research findings and document metadata
    description: Comprehensive research findings with document path
cache_strategy:
  type: hierarchical
  ttl: 3600
  invalidation: manual
  scope: command
success_signals:
  - 'Research completed successfully'
  - 'Findings documented in docs/research/'
  - 'All research questions addressed'
failure_modes:
  - 'Ticket file not found or invalid'
  - 'Research agents unable to complete analysis'
  - 'Insufficient findings to answer research question'
validation_rules:
  - rule: require_query_or_ticket
    severity: error
    message: Either query or ticket parameter must be provided
    condition: query || ticket
---

# Research Codebase

Conduct comprehensive research across the codebase using direct queries or ticket files by coordinating specialized agents to explore patterns, context, and insights, then synthesize findings into actionable documentation. Uses intelligent caching for optimization.

## Purpose

Multi-dimensional research via agent coordination for codebase patterns, historical context, and architectural insights, synthesized into documentation.

## Inputs

- **ticket**: Path to ticket file (optional if query provided)
- **scope**: Optional scope (codebase|research|both)
- **depth**: Optional depth (shallow|medium|deep)
- **conversation_context**: Related research history

## Preconditions

- Valid ticket file or clear research query
- Accessible development environment
- Time for comprehensive analysis

## Process Phases

### Phase 1: Context Analysis & Planning

1. Check cache for similar patterns
2. Read ticket/question fully
3. Decompose into investigation areas
4. Create research plan with subtasks
5. Identify agents and strategies

### Phase 2: Parallel Agent Coordination

1. Spawn locators: codebase-locator, research-locator in parallel
2. Pattern analysis: codebase-pattern-finder for examples
3. Deep analysis: codebase-analyzer, research-analyzer on key findings
4. Domain agents: Deploy specialized agents as needed
5. Wait for completion

### Phase 3: Synthesis & Documentation

1. Aggregate agent results
2. Cross-reference findings
3. Generate insights and patterns
4. Create structured research document
5. Update cache with patterns

## Error Handling

### Invalid Ticket

- Phase: context_analysis
- Expected: Valid ticket file/question
- Mitigation: Verify path or clarify question
- Requires user input: true

### Agent Failure

- Phase: agent_execution
- Expected: All agents complete
- Mitigation: Retry or adjust scope
- Requires user input: false

### Insufficient Findings

- Phase: synthesis
- Expected: Adequate findings
- Mitigation: Expand scope/objectives
- Requires user input: true

## Structured Output

```command-output:research_document
{
  "status": "success|in_progress|error",
  "timestamp": "ISO-8601",
  "cache": {"hit": true|false, "key": "pattern:{hash}:{scope}", "ttl_remaining": 3600, "savings": 0.25},
  "research": {"question": "string", "scope": "codebase|research|both", "depth": "shallow|medium|deep"},
  "findings": {"total_files": 23, "codebase": 18, "thoughts": 5, "insights": 7, "patterns": 3},
  "document": {"path": "docs/research/YYYY-MM-DD-topic.md", "sections": ["synopsis", "summary", "findings", "references"], "code_refs": 12, "historical": 3},
  "agents_used": ["codebase-locator", "codebase-analyzer", "research-locator", "research-analyzer"],
  "metadata": {"processing_time": 180, "cache_savings": 0.25, "agent_tasks": 6, "follow_up": 0}
}
```

## Success Criteria

### Automated

- Document created in `docs/research/`
- YAML frontmatter structure
- Agents completed successfully
- File:line references included
- Cache updated

### Manual

- Question fully addressed with evidence
- Cross-component connections
- Actionable development insights
- Historical context integrated
- Open questions addressed

## Agent Coordination

### Execution Order

1. **Discovery**: Locators in parallel (codebase-locator, research-locator)
2. **Pattern Analysis**: codebase-pattern-finder after locators
3. **Deep Analysis**: Analyzers on key findings (codebase-analyzer, research-analyzer)

### Specialized Agents

- operations-incident-commander: Incident response
- development-migrations-specialist: Database migrations
- programmatic-seo-engineer: SEO architecture
- content-localization-coordinator: i18n/l10n
- quality-testing-performance-tester: Performance testing

## Best Practices

### Methodology

- Read primary sources fully before agents
- Run same-type agents in parallel
- Prioritize current codebase over cache
- Identify cross-component relationships

### Documentation

- Consistent YAML frontmatter and sections
- Specific file:line references
- Include temporal context
- Self-contained with necessary context

## Document Template

```markdown
---
date: {{current_date}}
researcher: Assistant
topic: 'Research Topic'
tags: [research, tags]
status: complete
---

## Synopsis

[Brief summary of question/requirements]

## Summary

[High-level findings]

## Detailed Findings

### Component 1

- Finding ([file.ext:line])
- Connections and patterns

## Code References

- `path/file.ext:line` - Description

## Architecture Insights

[Key patterns and decisions]

## Historical Context

[Insights from docs/]

## Open Questions

[Any further investigation needed]
```

## Edge Cases

### Limited Findings

- Expand scope with alternative terms/patterns
- Document what was not found

### Multi-Component Systems

- Break into sub-questions
- Use multiple agents per aspect
- Separate sections per component

### Historical vs Current

- Prioritize current codebase
- Use docs for context/rationale
- Note discrepancies

## Anti-Patterns

- Spawn agents before reading sources
- Run agents sequentially instead of parallel
- Rely solely on cached documentation
- Skip cache checks

## Caching

### Usage

- Store successful strategies for similar topics
- Cache effective agent combinations
- Remember question decomposition

### Invalidation

- Manual: Clear on standards/structure changes
- Content-based: Significant question changes
- Time-based: Refresh hourly for active sessions

### Performance

- Hit rate ≥60%
- Memory <30MB
- Response <150ms

{{ticket}}
