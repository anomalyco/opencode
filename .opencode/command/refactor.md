---
name: refactor
mode: command
description: Refactor code to reduce technical debt and improve maintainability
version: 2.0.0-internal
last_updated: 2025-09-13
command_schema_version: 1.0
inputs:
  - name: target_path
    type: string
    required: true
    description: Path to file or directory to refactor
  - name: scope
    type: string
    required: false
    description: 'Refactoring scope: file, directory, or module (default: file)'
  - name: focus_areas
    type: array
    required: false
    description: Specific areas to focus on (performance, readability, maintainability, etc.)
outputs:
  - name: refactoring_status
    type: structured
    format: JSON with refactoring changes and impact analysis
    description: Detailed refactoring status and impact assessment
cache_strategy:
  type: agent_specific
  ttl: 1800
  invalidation: manual
  scope: command
success_signals:
  - 'Refactoring completed successfully'
  - 'Technical debt reduced without breaking functionality'
  - 'Code quality metrics improved'
failure_modes:
  - 'Refactoring introduces breaking changes'
  - 'Performance regressions detected'
  - 'Code becomes less maintainable'
---

# Refactor Code for Technical Debt Reduction

You are tasked with refactoring code to reduce technical debt while maintaining functionality and improving code quality. This command uses intelligent analysis to identify refactoring opportunities and implements changes safely.

## Purpose

Refactor code to improve maintainability, readability, and performance while eliminating technical debt. Focus on safe, incremental changes that preserve existing functionality.

## Inputs

- **target_path**: Path to the file or directory to refactor
- **scope**: Scope of refactoring (file, directory, module)
- **focus_areas**: Specific areas to focus on (performance, readability, maintainability, etc.)
- **conversation_context**: History of previous refactoring discussions

## Preconditions

- Target code exists and is readable
- Development environment is properly configured
- Tests exist for the target code (recommended)
- Code is under version control

## Process Phases

### Phase 1: Analysis & Planning

1. **Analyze Code Quality**: Use code-reviewer to assess current code quality and identify issues
2. **Identify Technical Debt**: Catalog specific technical debt items and refactoring opportunities
3. **Assess Impact**: Evaluate the impact of potential refactoring changes
4. **Create Refactoring Plan**: Develop a safe, incremental refactoring strategy
5. **Set Up Safety Measures**: Ensure tests and backups are in place

### Phase 2: Safe Implementation

1. **Execute Incremental Changes**: Implement refactoring changes one at a time
2. **Verify After Each Change**: Run tests and checks after each modification
3. **Maintain Functionality**: Ensure no breaking changes are introduced
4. **Update Documentation**: Keep code comments and documentation current
5. **Handle Dependencies**: Update any dependent code as needed

### Phase 3: Verification & Optimization

1. **Run Comprehensive Tests**: Execute full test suite to ensure no regressions
2. **Performance Validation**: Check for performance improvements or regressions
3. **Code Quality Assessment**: Verify that code quality metrics have improved
4. **Documentation Updates**: Ensure all documentation reflects changes
5. **Final Review**: Conduct final code review of refactored code

## Error Handling

### Breaking Changes Error

```error-context
{
  "command": "refactor",
  "phase": "implementation",
  "error_type": "breaking_changes",
  "expected": "No functionality changes",
  "found": "API contract violation in refactored function",
  "mitigation": "Revert changes and implement more conservative refactoring",
  "requires_user_input": true
}
```

### Performance Regression Error

```error-context
{
  "command": "refactor",
  "phase": "verification",
  "error_type": "performance_regression",
  "expected": "Performance maintained or improved",
  "found": "20% performance degradation detected",
  "mitigation": "Analyze performance impact and optimize or revert",
  "requires_user_input": true
}
```

### Test Failures Error

```error-context
{
  "command": "refactor",
  "phase": "verification",
  "error_type": "test_failures",
  "expected": "All tests pass",
  "found": "5 test failures after refactoring",
  "mitigation": "Fix test issues or adjust refactoring approach",
  "requires_user_input": false
}
```

## Structured Output Specification

### Primary Output

```command-output:refactoring_status
{
  "status": "success|in_progress|blocked|error",
  "timestamp": "ISO-8601",
  "target": {
    "path": "src/components/AuthComponent.tsx",
    "scope": "file",
    "lines_of_code": 245
  },
  "analysis": {
    "technical_debt_score": 7.2,
    "issues_identified": 12,
    "refactoring_opportunities": 8
  },
  "changes": [
    {
      "type": "extract_function",
      "description": "Extract authentication logic into separate function",
      "impact": "high",
      "risk": "low",
      "status": "completed"
    },
    {
      "type": "rename_variables",
      "description": "Improve variable naming for clarity",
      "impact": "medium",
      "risk": "low",
      "status": "completed"
    },
    {
      "type": "remove_dead_code",
      "description": "Remove unused imports and functions",
      "impact": "low",
      "risk": "low",
      "status": "completed"
    }
  ],
  "metrics": {
    "cyclomatic_complexity": {
      "before": 15,
      "after": 8,
      "improvement": "-46.7%"
    },
    "maintainability_index": {
      "before": 45,
      "after": 72,
      "improvement": "+60.0%"
    },
    "performance_impact": "neutral"
  },
  "testing": {
    "tests_run": 45,
    "tests_passed": 45,
    "coverage_change": "+2.3%",
    "regressions": 0
  },
  "blockers": [],
  "metadata": {
    "processing_time": 180,
    "files_modified": 3,
    "lines_changed": 67,
    "safety_score": 9.2
  }
}
```

## Success Criteria

#### Automated Verification

- [ ] All tests pass after refactoring
- [ ] No performance regressions detected
- [ ] Code quality metrics improved
- [ ] No breaking changes introduced
- [ ] Documentation updated

#### Manual Verification

- [ ] Code is more readable and maintainable
- [ ] Function complexity reduced where appropriate
- [ ] Naming conventions improved
- [ ] Dead code eliminated
- [ ] Dependencies properly managed

## Implementation Guidelines

### Refactoring Strategy

- **Incremental Changes**: Make small, safe changes that can be easily reverted
- **Test First**: Ensure comprehensive tests exist before refactoring
- **Preserve Behavior**: Never change functionality, only improve structure
- **Document Changes**: Keep track of all modifications for review

### Risk Assessment

When evaluating refactoring opportunities:

1. **High Risk**: API changes, complex logic restructuring
2. **Medium Risk**: Variable renaming, function extraction
3. **Low Risk**: Dead code removal, comment improvements

### Safety Measures

- **Backup Original**: Create backups before major changes
- **Frequent Commits**: Commit after each safe refactoring step
- **Revert Plan**: Know how to undo changes if needed
- **Test Coverage**: Ensure adequate test coverage exists

## Edge Cases

### Legacy Code Without Tests

- Create characterization tests before refactoring
- Implement changes very conservatively
- Focus on safe improvements like naming and structure

### Performance-Critical Code

- Measure performance before and after changes
- Be prepared to revert if performance degrades
- Consider optimization opportunities during refactoring

### Large Codebases

- Refactor in small, manageable chunks
- Focus on high-impact areas first
- Maintain clear boundaries between refactored and non-refactored code

## Anti-Patterns

### Avoid These Practices

- **Big Bang Refactoring**: Don't refactor everything at once
- **Untested Changes**: Never refactor without test coverage
- **Functionality Changes**: Don't change behavior during refactoring
- **Ignoring Performance**: Don't sacrifice performance for cleanliness

## Enhanced Subagent Orchestration for Refactoring

### Comprehensive Refactoring Workflow

For complex refactoring requiring coordinated expertise:

#### Phase 1: Analysis & Risk Assessment (Parallel)

- **codebase-analyzer**: Understand code structure and dependencies
- **code-reviewer**: Assess code quality and identify issues
- **codebase-pattern-finder**: Identify established patterns and anti-patterns
- **performance-engineer**: Evaluate performance implications

#### Phase 2: Safe Refactoring Implementation (Sequential)

- **full-stack-developer**: Execute refactoring changes safely
- **test-generator**: Generate additional tests for refactored code
- **code-reviewer**: Validate each refactoring step
- **performance-engineer**: Monitor performance during changes

#### Phase 3: Quality Assurance & Validation (Parallel)

- **code-reviewer**: Final comprehensive code review
- **quality-testing-performance-tester**: Performance and load testing
- **security-scanner**: Ensure security requirements maintained
- **accessibility-pro**: Verify accessibility features preserved

#### Phase 4: Documentation & Knowledge Transfer (Parallel)

- **research-analyzer**: Update technical documentation
- **documentation-specialist**: Create refactoring summary and rationale

### Refactoring Orchestration Best Practices

1. **Risk-First Approach**: Address high-risk changes before low-risk ones
2. **Incremental Validation**: Validate after each significant change
3. **Performance Monitoring**: Track performance throughout refactoring
4. **Comprehensive Testing**: Include unit, integration, and performance tests

### Quality Gates

- **Safety**: No breaking changes or functionality regressions
- **Performance**: Performance maintained or improved
- **Quality**: Code quality metrics show improvement
- **Testing**: All tests pass with adequate coverage
- **Documentation**: Changes properly documented

### Risk Mitigation Strategies

- **Incremental Implementation**: Small, reversible changes
- **Comprehensive Testing**: Extensive test coverage before and after
- **Performance Baselines**: Establish performance benchmarks
- **Rollback Planning**: Clear rollback procedures for each change
- **Gradual Rollout**: Consider feature flags for risky changes

{{target_path}}
