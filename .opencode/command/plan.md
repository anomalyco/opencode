---
name: plan
mode: command
description: Create an implementation plan from a ticket and research
version: 2.0.0-internal
last_updated: 2025-09-13
command_schema_version: 1.0
inputs:
  - name: files
    type: array
    required: true
    description: Array of ticket and research files to analyze
  - name: scope
    type: string
    required: false
    description: Scope hint for the implementation (feature|refactor|bugfix)
  - name: complexity
    type: string
    required: false
    description: Complexity estimate (simple|medium|complex)
outputs:
  - name: plan_document
    type: structured
    format: JSON with plan metadata and file path
    description: Generated implementation plan with metadata
cache_strategy:
  type: agent_specific
  ttl: 7200
  invalidation: manual
  scope: command
success_signals:
  - 'Implementation plan created successfully'
  - 'Plan saved to docs/plans/ directory'
  - 'All research questions resolved'
failure_modes:
  - 'Required files not found or invalid'
  - 'Unresolved research questions remain'
  - 'Technical feasibility concerns'
---

# Create Implementation Plan

You are tasked with creating detailed implementation plans through an interactive, iterative process. This command uses intelligent caching to optimize research workflows and maintain consistency across similar planning scenarios.

## Purpose

Create comprehensive, actionable implementation plans by thoroughly researching requirements, analyzing codebase constraints, and producing structured technical specifications.

## Inputs

- **files**: Array of ticket files, research documents, and related materials
- **scope**: Optional scope hint to guide planning approach
- **complexity**: Optional complexity estimate for resource planning
- **conversation_context**: History of planning discussions and decisions

## Preconditions

- All referenced ticket and research files exist and are readable
- Development environment is accessible for research
- User available for clarification on ambiguous requirements
- Sufficient time allocated for thorough analysis

## Process Phases

### Phase 1: Context Analysis & Initial Research

1. **Check Cache First**: Query cache for similar planning patterns using ticket context hash
2. **Read All Input Files**: Completely read all specified ticket and research files
3. **Spawn Parallel Research**: Launch codebase-locator, codebase-analyzer, and research-locator agents
4. **Gather Comprehensive Context**: Read all files identified by research agents
5. **Cross-Reference Analysis**: Verify requirements against actual codebase state

### Phase 2: Interactive Discovery & Clarification

1. **Present Informed Understanding**: Share findings with specific file:line references
2. **Identify Knowledge Gaps**: Ask targeted questions that research couldn't answer
3. **Verify Corrections**: Research any user-provided corrections thoroughly
4. **Create Research Todo List**: Track all exploration and clarification tasks
5. **Iterate Until Aligned**: Continue research until all questions are resolved

### Phase 3: Design Exploration & Decision Making

1. **Spawn Focused Research Tasks**: Use specialized agents for deeper investigation
2. **Present Design Options**: Show multiple approaches with pros/cons analysis
3. **Facilitate Decision Making**: Guide user toward optimal technical choices
4. **Validate Feasibility**: Ensure chosen approach works within codebase constraints
5. **Update Cache**: Store successful research patterns for future planning

### Phase 4: Plan Structure & Documentation

1. **Develop Phase Structure**: Create logical implementation phases with clear boundaries
2. **Get Structure Approval**: Confirm phasing approach before detailed writing
3. **Write Comprehensive Plan**: Document all phases with specific changes and success criteria
4. **Include Testing Strategy**: Define both automated and manual verification approaches
5. **Add References**: Link to original tickets, research, and related implementations

## Error Handling

### Missing Files Error

```error-context
{
  "command": "plan",
  "phase": "context_analysis",
  "error_type": "missing_files",
  "expected": "All specified files exist",
  "found": "File not found: docs/tickets/missing-ticket.md",
  "mitigation": "Verify file paths and ensure all referenced files exist",
  "requires_user_input": true
}
```

### Unresolved Questions Error

```error-context
{
  "command": "plan",
  "phase": "discovery",
  "error_type": "unresolved_questions",
  "expected": "All research questions answered",
  "found": "3 open questions remain about API design",
  "mitigation": "Complete research or request clarification before proceeding",
  "requires_user_input": true
}
```

### Technical Feasibility Error

```error-context
{
  "command": "plan",
  "phase": "design_validation",
  "error_type": "technical_blocker",
  "expected": "Chosen approach is technically feasible",
  "found": "Database schema conflict prevents proposed solution",
  "mitigation": "Re-evaluate design options or adjust technical requirements",
  "requires_user_input": true
}
```

## Structured Output Specification

### Primary Output

```command-output:plan_document
{
  "status": "success|in_progress|clarification_needed|error",
  "timestamp": "ISO-8601",
  "cache": {
    "hit": true|false,
    "key": "plan_pattern:{ticket_hash}:{scope}",
    "ttl_remaining": 7200,
    "savings": 0.30
  },
  "analysis": {
    "input_files": 5,
    "research_tasks": 8,
    "key_discoveries": 12,
    "open_questions": 0
  },
  "plan": {
    "path": "docs/plans/2025-09-13-feature-implementation.md",
    "title": "User Authentication System Implementation Plan",
    "phases": 4,
    "estimated_effort": "medium",
    "risk_level": "low"
  },
  "research_summary": {
    "codebase_locator_findings": 15,
    "codebase_analyzer_insights": 8,
    "thoughts_locator_documents": 3,
    "pattern_finder_matches": 6
  },
  "metadata": {
    "processing_time": 240,
    "cache_savings": 0.30,
    "user_interactions": 3,
    "research_iterations": 2
  }
}
```

## Success Criteria

#### Automated Verification

- [ ] Plan file created in `docs/plans/` directory with correct naming
- [ ] All referenced files exist and are accessible
- [ ] Plan follows required template structure
- [ ] Success criteria include both automated and manual verification
- [ ] Cache updated with successful planning patterns

#### Manual Verification

- [ ] Plan addresses all requirements from original ticket
- [ ] Implementation phases are logically ordered and scoped
- [ ] Success criteria are measurable and comprehensive
- [ ] Edge cases and error conditions are considered
- [ ] Plan is clear and actionable for implementation team

## Planning Best Practices

### Research Strategy

- **Parallel Investigation**: Spawn multiple research agents simultaneously for efficiency
- **Complete Context First**: Read all input files fully before asking questions
- **Verify Everything**: Cross-check user statements against actual code
- **Iterate Thoughtfully**: Use research findings to guide next questions

### Interactive Collaboration

- **Present Findings Clearly**: Share discoveries with specific file:line references
- **Ask Focused Questions**: Only ask what research genuinely cannot answer
- **Guide Decisions**: Present options with clear pros/cons analysis
- **Maintain Momentum**: Keep user engaged through regular progress updates

### Plan Structure Guidelines

- **Logical Phasing**: Break work into testable, incremental phases
- **Clear Success Criteria**: Separate automated and manual verification
- **Scope Definition**: Explicitly state what is NOT included
- **Risk Assessment**: Identify potential blockers and mitigation strategies

## Common Implementation Patterns

### Database Changes Pattern

1. Schema/Migration Definition
2. Data Access Layer Updates
3. Business Logic Integration
4. API Endpoint Creation
5. Client-Side Integration

### New Feature Pattern

1. Requirements Analysis & Design
2. Data Model Definition
3. Backend Implementation
4. API Development
5. Frontend Integration
6. Testing & Validation

### Refactoring Pattern

1. Current Behavior Documentation
2. Incremental Change Planning
3. Backward Compatibility Assurance
4. Migration Strategy Development
5. Rollback Plan Creation

## Research Agent Guidelines

### Agent Selection Strategy

- **codebase-locator**: Find all relevant files and components
- **codebase-analyzer**: Understand current implementation details
- **codebase-pattern-finder**: Discover similar implementations to model after
- **research-locator**: Find existing research and decisions
- **research-analyzer**: Extract insights from documentation

### Task Specification Best Practices

- **Be Specific**: Include exact search terms and directory contexts
- **Request Structure**: Ask for specific file:line references in responses
- **Parallel Execution**: Spawn multiple focused tasks simultaneously
- **Result Verification**: Cross-check agent findings against actual code

## Edge Cases

### Complex Multi-System Changes

- Break into smaller, independent plans when possible
- Identify integration points and coordination requirements
- Plan for phased rollout with feature flags

### Legacy System Integration

- Document current behavior thoroughly before changes
- Plan incremental migration with rollback capabilities
- Include data migration and compatibility testing

### High-Uncertainty Requirements

- Increase research phase duration for unclear requirements
- Create multiple design options with clear trade-offs
- Plan for iterative refinement during implementation

## Anti-Patterns

### Avoid These Practices

- **Assumptions without verification**: Don't proceed without researching user statements
- **Planning without context**: Don't create plans without reading all relevant files
- **Open questions in final plan**: Don't finalize plans with unresolved technical decisions
- **Cache bypass**: Don't skip cache checks for performance reasons

## Caching Guidelines

## Enhanced Subagent Orchestration for Planning

### Comprehensive Planning Workflow

For complex feature planning requiring architectural and technical expertise:

#### Phase 1: Research Integration & Context Building (Parallel)

- **codebase-locator**: Maps existing component locations and architectural boundaries
- **research-locator**: Discovers existing plans, architectural decisions, and technical constraints
- **codebase-pattern-finder**: Identifies established implementation patterns for similar features
- **research-analyzer**: Extracts insights from past planning decisions and outcomes

#### Phase 2: Technical Feasibility Analysis (Sequential)

- **codebase-analyzer**: Validates technical assumptions and identifies integration points
- **system-architect**: Evaluates architectural impact and design trade-offs
- **database-expert**: Assesses data model changes and migration requirements
- **api-builder**: Evaluates API design implications and contract changes
- **performance-engineer**: Analyzes performance impact and optimization needs

#### Phase 3: Risk & Constraint Assessment (Parallel)

- **security-scanner**: Identifies security implications and requirements
- **compliance-expert**: Evaluates regulatory compliance constraints
- **cost-optimizer**: Analyzes operational cost implications
- **infrastructure-builder**: Assesses infrastructure and deployment requirements
- **monitoring-expert**: Evaluates observability and monitoring needs

#### Phase 4: Implementation Strategy Development (Sequential)

- **full-stack-developer**: Validates technical feasibility of proposed approaches
- **test-generator**: Identifies testing strategy and coverage requirements
- **quality-testing-performance-tester**: Defines performance testing approach
- **development-migrations-specialist**: Plans database migration and data transformation strategy
- **code-reviewer**: Establishes code quality and review standards for the implementation

#### Phase 5: Validation & Documentation (Parallel)

- **accessibility-pro**: Ensures accessibility requirements are addressed (if applicable)
- **ux-optimizer**: Validates user experience implications
- **content-localization-coordinator**: Assesses internationalization requirements
- **deployment-wizard**: Plans deployment and rollback strategies

### Planning Orchestration Best Practices

1. **Research-First Approach**: Always begin with comprehensive research before planning
2. **Parallel Assessment**: Use multiple domain experts simultaneously for risk assessment
3. **Architectural Validation**: Engage system-architect early for design validation
4. **Technical Feasibility**: Validate with full-stack-developer before finalizing plans
5. **Risk Mitigation**: Address all identified risks with specific mitigation strategies
6. **Iterative Refinement**: Re-engage subagents as plan details evolve

### Quality Assurance Gates

- **Technical Feasibility**: Validated by domain experts and full-stack-developer
- **Architectural Alignment**: Reviewed by system-architect for consistency
- **Security & Compliance**: Cleared by security-scanner and compliance-expert
- **Performance Impact**: Analyzed by performance-engineer
- **Testing Strategy**: Comprehensive coverage defined by test-generator
- **Operational Readiness**: Infrastructure and deployment plans validated

### Plan Optimization Strategies

- **Modular Planning**: Break complex features into independently plannable components
- **Risk-First Ordering**: Address high-risk elements early in the plan
- **Dependency Management**: Clearly define inter-component dependencies
- **Success Metrics**: Define measurable success criteria for each phase
- **Rollback Planning**: Include rollback strategies for each major change

### Cache Usage Patterns

- **Research patterns**: Store successful investigation approaches for similar features
- **Question sets**: Cache effective clarification questions for common scenarios
- **Plan templates**: Remember successful plan structures by complexity and scope

### Cache Invalidation Triggers

- **Manual**: Clear cache when planning standards or codebase structure change
- **Content-based**: Invalidate when ticket requirements change significantly
- **Time-based**: Refresh cache every 2 hours for active planning sessions

### Performance Optimization

- Cache hit rate target: ≥ 70% for repeated planning patterns
- Memory usage: < 25MB for planning pattern cache
- Response time: < 100ms for cache queries

{{files}}
