---
name: execute
mode: command
description: Execute a specific implementation plan from docs/plans/
version: 2.0.0-internal
last_updated: 2025-09-13
command_schema_version: 1.0
inputs:
  - name: plan_path
    type: string
    required: true
    description: Path to the implementation plan in docs/plans/
  - name: ticket_reference
    type: string
    required: false
    description: Reference to original ticket or issue
  - name: start_phase
    type: number
    required: false
    description: 'Phase number to start execution from (default: first unchecked)'
outputs:
  - name: execution_status
    type: structured
    format: JSON with phase completion and issues
    description: Detailed execution status and progress tracking
cache_strategy:
  type: agent_specific
  ttl: 1800
  invalidation: manual
  scope: command
success_signals:
  - 'Plan execution completed successfully'
  - 'All phases implemented and verified'
  - 'Plan file updated with completion status'
failure_modes:
  - 'Plan file not found or invalid'
  - 'Implementation blocked by technical issues'
  - 'Verification checks failing'
---

# Execute Implementation Plan

You are tasked with implementing an approved technical plan from `docs/plans/`. This command uses intelligent caching to optimize implementation workflows and maintain consistency across similar execution patterns.

## Purpose

Execute technical implementation plans by following structured phases, adapting to real-world constraints, and ensuring all success criteria are met.

## Inputs

- **plan_path**: Path to the implementation plan file in `docs/plans/`
- **ticket_reference**: Optional reference to the original ticket or issue
- **start_phase**: Optional phase number to begin execution from
- **conversation_context**: History of planning and preparation work

## Preconditions

- Implementation plan exists and is readable
- All referenced files in the plan are accessible
- Development environment is properly configured
- Plan has been reviewed and approved for execution

## Process Phases

### Phase 1: Context Analysis & Cache Check

1. **Check Cache First**: Query cache for similar implementation patterns using plan context hash
2. **Read Complete Plan**: Read the entire plan file and check existing progress markers
3. **Gather Context**: Read original ticket and all files mentioned in the plan
4. **Validate Environment**: Ensure all required tools and dependencies are available
5. **Create Execution Plan**: Set up todo list and determine starting point

### Phase 2: Phased Implementation

1. **Execute Current Phase**: Implement the current unchecked phase completely
2. **Adapt to Reality**: Adjust implementation based on actual codebase state
3. **Verify Phase Completion**: Run success criteria checks for the phase
4. **Update Progress**: Mark phase as complete in plan file and todo list
5. **Handle Blockers**: Identify and resolve any implementation obstacles

### Phase 3: Verification & Completion

1. **Run Final Verification**: Execute all success criteria checks
2. **Update Documentation**: Ensure plan reflects final implementation state
3. **Clean Up**: Remove temporary files and reset development environment
4. **Update Cache**: Store successful implementation patterns for future reference

## Error Handling

### Plan Not Found Error

```error-context
{
  "command": "execute",
  "phase": "context_analysis",
  "error_type": "plan_not_found",
  "expected": "Valid plan file in docs/plans/",
  "found": "File does not exist: docs/plans/missing-plan.md",
  "mitigation": "Verify plan path and ensure file exists",
  "requires_user_input": true
}
```

### Implementation Blocker Error

```error-context
{
  "command": "execute",
  "phase": "implementation",
  "error_type": "implementation_blocker",
  "expected": "Phase can be implemented as planned",
  "found": "Dependency conflict in phase 3",
  "mitigation": "Present issue details and request guidance",
  "requires_user_input": true
}
```

### Verification Failure Error

```error-context
{
  "command": "execute",
  "phase": "verification",
  "error_type": "verification_failed",
  "expected": "All success criteria pass",
  "found": "Test suite failing with 3 errors",
  "mitigation": "Fix verification issues before proceeding",
  "requires_user_input": false
}
```

## Structured Output Specification

### Primary Output

```command-output:execution_status
{
  "status": "success|in_progress|blocked|error",
  "timestamp": "ISO-8601",
  "cache": {
    "hit": true|false,
    "key": "execution_pattern:{plan_hash}:{phase}",
    "ttl_remaining": 1800,
    "savings": 0.20
  },
  "plan": {
    "path": "docs/plans/2025-09-13-feature-implementation.md",
    "total_phases": 5,
    "completed_phases": 3,
    "current_phase": 4
  },
  "progress": [
    {
      "phase": 1,
      "status": "completed",
      "description": "Set up project structure",
      "duration": 45,
      "issues": []
    },
    {
      "phase": 2,
      "status": "completed",
      "description": "Implement core functionality",
      "duration": 120,
      "issues": ["Minor API adjustment needed"]
    },
    {
      "phase": 3,
      "status": "completed",
      "description": "Add error handling",
      "duration": 30,
      "issues": []
    },
    {
      "phase": 4,
      "status": "in_progress",
      "description": "Create tests",
      "duration": null,
      "issues": []
    }
  ],
  "blockers": [
    {
      "phase": 4,
      "type": "dependency_conflict",
      "description": "Test framework version mismatch",
      "severity": "high",
      "requires_guidance": true
    }
  ],
  "metadata": {
    "processing_time": 195,
    "cache_savings": 0.20,
    "files_modified": 12,
    "tests_run": 45
  }
}
```

## Success Criteria

#### Automated Verification

- [ ] All plan phases completed successfully
- [ ] Success criteria checks pass for each phase
- [ ] Plan file updated with completion markers
- [ ] No critical blockers remain unresolved
- [ ] Cache updated with successful execution patterns

#### Manual Verification

- [ ] Implementation matches plan intent and requirements
- [ ] Code follows project conventions and standards
- [ ] All edge cases and error conditions handled
- [ ] Documentation updated to reflect changes
- [ ] Testing covers all critical paths

## Implementation Guidelines

### Phase Execution Strategy

- **Complete Before Proceed**: Finish each phase entirely before starting the next
- **Adapt Intelligently**: Follow plan intent while adjusting for real-world constraints
- **Verify Continuously**: Run checks at natural stopping points, not after every change
- **Document Deviations**: Note any significant differences from the original plan

### Handling Plan Mismatches

When the actual codebase differs from the plan:

1. **STOP and Analyze**: Don't proceed until you understand the discrepancy
2. **Present Clearly**: Show expected vs. actual situation with impact analysis
3. **Request Guidance**: Ask for direction on how to proceed
4. **Document Decision**: Update plan with resolution approach

### Verification Best Practices

- **Batch Verification**: Group checks at phase boundaries to maintain flow
- **Fix Issues Immediately**: Don't accumulate technical debt
- **Update Progress Markers**: Keep both plan file and todo list current
- **Trust Completed Work**: Don't re-verify already completed phases

## Edge Cases

### Partial Plan Execution

- Start from specific phase when resuming interrupted work
- Verify previous phases only if inconsistencies are suspected
- Maintain context of what has already been implemented

### Technical Blockers

- Identify root cause before asking for guidance
- Provide multiple solution options when possible
- Document workaround approaches for future reference

### Evolving Requirements

- Compare new requirements against existing implementation
- Assess impact of changes on remaining phases
- Update plan to reflect new understanding

## Anti-Patterns

### Avoid These Practices

- **Rushed implementation**: Don't skip understanding the full context
- **Accumulating debt**: Don't leave verification issues unresolved
- **Plan deviation**: Don't implement differently without clear justification
- **Cache bypass**: Don't skip cache checks for performance reasons

## Caching Guidelines

## Enhanced Subagent Orchestration for Execution

### Comprehensive Implementation Workflow

For complex feature implementation requiring coordinated expertise across domains:

#### Phase 1: Pre-Implementation Validation (Parallel)

- **codebase-locator**: Verify all referenced components and files exist
- **codebase-analyzer**: Understand current implementation state and integration points
- **research-analyzer**: Review existing documentation and implementation notes
- **codebase-pattern-finder**: Identify established patterns for the implementation approach

#### Phase 2: Domain-Specific Implementation (Sequential by Phase)

- **full-stack-developer**: Primary implementation agent for feature development
- **api-builder**: Handle API endpoint creation and contract implementation
- **database-expert**: Manage schema changes and data migration implementation
- **performance-engineer**: Optimize performance-critical implementation aspects
- **security-scanner**: Ensure security requirements are properly implemented
- **accessibility-pro**: Implement accessibility features for user interfaces
- **ux-optimizer**: Optimize user experience implementation details

#### Phase 3: Quality Assurance & Validation (Parallel)

- **code-reviewer**: Comprehensive code quality and maintainability review
- **test-generator**: Generate and implement comprehensive test suites
- **quality-testing-performance-tester**: Execute performance and load testing
- **compliance-expert**: Validate regulatory compliance implementation
- **monitoring-expert**: Implement monitoring and observability features

#### Phase 4: Infrastructure & Deployment (Sequential)

- **infrastructure-builder**: Prepare infrastructure changes and configurations
- **deployment-wizard**: Implement deployment automation and rollback procedures
- **devops-operations-specialist**: Coordinate deployment and operational handoff
- **cost-optimizer**: Validate cost implications of infrastructure changes

#### Phase 5: Documentation & Knowledge Transfer (Parallel)

- **content-writer**: Create user documentation and release notes
- **research-analyzer**: Update technical documentation and implementation notes
- **content-localization-coordinator**: Handle internationalization updates

### Execution Orchestration Best Practices

1. **Phase-by-Phase Validation**: Validate each implementation phase before proceeding
2. **Domain Expert Coordination**: Engage appropriate specialists for each technical domain
3. **Quality Gates**: Never proceed without code-reviewer validation
4. **Testing Integration**: Include test-generator and quality-testing-performance-tester early
5. **Infrastructure Readiness**: Prepare deployment infrastructure before implementation completion
6. **Documentation Updates**: Keep documentation current throughout implementation

### Implementation Quality Gates

- **Code Quality**: Reviewed by code-reviewer with all issues resolved
- **Test Coverage**: Comprehensive tests generated and passing
- **Performance**: Validated by quality-testing-performance-tester
- **Security**: Cleared by security-scanner
- **Compliance**: Approved by compliance-expert (if applicable)
- **Accessibility**: Validated by accessibility-pro (if applicable)
- **Documentation**: Updated by research-analyzer and content-writer

### Risk Mitigation Strategies

- **Incremental Implementation**: Implement and validate in small, reversible increments
- **Automated Testing**: Generate comprehensive tests before marking phases complete
- **Performance Monitoring**: Include performance validation in each phase
- **Security Reviews**: Conduct security validation at key implementation milestones
- **Rollback Planning**: Ensure rollback capabilities exist before deployment
- **Monitoring Setup**: Implement observability before production deployment

### Cache Usage Patterns

- **Execution patterns**: Store successful implementation approaches for similar features
- **Blocker resolutions**: Cache solutions to common technical obstacles
- **Verification strategies**: Remember effective testing and validation approaches

### Cache Invalidation Triggers

- **Manual**: Clear cache when implementation standards change
- **Content-based**: Invalidate when plan structure changes significantly
- **Time-based**: Refresh cache every 30 minutes for active development

### Performance Optimization

- Cache hit rate target: ≥ 65% for repeated execution patterns
- Memory usage: < 20MB for execution pattern cache
- Response time: < 75ms for cache queries

{{plan_path}}
