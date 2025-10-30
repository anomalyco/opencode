---
name: debug
mode: command
description: Debug issues with issue reproduction, root cause analysis, fix implementation, and regression testing
version: 1.0.0
last_updated: 2025-10-16
command_schema_version: 1.0
inputs:
  - name: issue
    type: string
    required: true
    description: Description of the issue or path to issue ticket
  - name: reproduction_steps
    type: string
    required: false
    description: Steps to reproduce the issue
  - name: environment
    type: string
    required: false
    description: Environment where issue occurs (development|staging|production)
  - name: severity
    type: string
    required: false
    description: Issue severity (critical|high|medium|low)
outputs:
  - name: debug_results
    type: structured
    format: JSON with debugging analysis and resolution status
    description: Comprehensive debugging results and resolution details
cache_strategy:
  type: agent_specific
  ttl: 1800
  invalidation: manual
  scope: command
success_signals:
  - 'Issue reproduced successfully'
  - 'Root cause identified and analyzed'
  - 'Fix implemented and verified'
  - 'Regression tests created and passing'
failure_modes:
  - 'Unable to reproduce issue'
  - 'Root cause analysis inconclusive'
  - 'Fix implementation failed'
  - 'Regression tests failing'
validation_rules:
  - rule: require_issue
    severity: error
    message: Issue description or ticket path must be provided
    condition: issue
---

# Debug Issue

Execute a comprehensive debugging workflow with systematic issue reproduction, root cause analysis, fix implementation, and regression test creation to resolve issues effectively.

## Purpose

Systematically debug and resolve issues through structured reproduction, analysis, implementation, and validation phases to ensure reliable and lasting fixes.

## Inputs

- **issue**: Issue description or path to issue ticket
- **reproduction_steps**: Optional steps to reproduce the issue
- **environment**: Optional environment where issue occurs
- **severity**: Optional issue severity level
- **conversation_context**: History of debugging discussions and attempts

## Preconditions

- Issue description is clear and detailed
- Development environment is accessible and configured
- Reproduction environment is available if needed
- Access to logs, metrics, and monitoring systems
- Testing framework is available for regression tests

## Process Phases

### Phase 1: Issue Reproduction & Context Gathering

1. **Check Cache First**: Query cache for similar issue patterns using issue context hash
2. **Read Issue Details**: Parse issue description and gather all available context
3. **Collect Evidence**: Gather logs, stack traces, metrics, and error messages
4. **Reproduce Issue**: Follow reproduction steps to confirm the issue exists
5. **Document Behavior**: Record observed behavior and expected behavior
6. **Identify Scope**: Determine affected components and impact scope
7. **Create Debug Plan**: Establish investigation strategy and checkpoints

### Phase 2: Root Cause Analysis

1. **Analyze Stack Traces**: Examine error messages and call stacks
2. **Review Code Paths**: Trace execution flow through affected components
3. **Inspect State**: Examine application state at point of failure
4. **Check Dependencies**: Verify external dependencies and integrations
5. **Review Recent Changes**: Identify recent code changes that may be related
6. **Test Hypotheses**: Systematically test potential root causes
7. **Document Findings**: Record root cause analysis and supporting evidence

### Phase 3: Fix Implementation & Verification

1. **Design Fix**: Develop solution approach addressing root cause
2. **Implement Solution**: Write code changes to resolve the issue
3. **Verify Fix Locally**: Test fix in development environment
4. **Review Code Changes**: Ensure fix follows best practices and standards
5. **Test Edge Cases**: Verify fix handles edge cases and error conditions
6. **Performance Check**: Ensure fix doesn't introduce performance issues
7. **Security Review**: Validate fix doesn't introduce security vulnerabilities

### Phase 4: Regression Testing & Documentation

1. **Create Regression Tests**: Generate tests that prevent issue recurrence
2. **Execute Test Suite**: Run all tests to ensure no regressions introduced
3. **Validate Fix**: Confirm fix resolves original issue without side effects
4. **Document Resolution**: Update issue ticket with fix details and analysis
5. **Update Documentation**: Add learnings to knowledge base if applicable
6. **Update Cache**: Store successful debugging patterns for future reference
7. **Notify Stakeholders**: Communicate resolution to affected parties

## Error Handling

### Reproduction Failure Error

```error-context
{
  "command": "debug",
  "phase": "issue_reproduction",
  "error_type": "reproduction_failed",
  "expected": "Issue can be reproduced consistently",
  "found": "Unable to reproduce issue with provided steps",
  "mitigation": "Request additional reproduction details or context",
  "requires_user_input": true
}
```

### Root Cause Analysis Inconclusive

```error-context
{
  "command": "debug",
  "phase": "root_cause_analysis",
  "error_type": "analysis_inconclusive",
  "expected": "Root cause identified with confidence",
  "found": "Multiple potential causes without clear evidence",
  "mitigation": "Gather additional evidence and test hypotheses systematically",
  "requires_user_input": false
}
```

### Fix Verification Failure

```error-context
{
  "command": "debug",
  "phase": "fix_verification",
  "error_type": "verification_failed",
  "expected": "Fix resolves issue without introducing regressions",
  "found": "Fix causes 3 test failures in related components",
  "mitigation": "Revise fix to address test failures",
  "requires_user_input": false
}
```

## Structured Output Specification

### Primary Output

```command-output:debug_results
{
  "status": "resolved|in_progress|blocked",
  "timestamp": "ISO-8601",
  "cache": {
    "hit": true|false,
    "key": "debug_pattern:{issue_hash}:{environment}",
    "ttl_remaining": 1800,
    "savings": 0.20
  },
  "issue": {
    "description": "Application crashes when processing large datasets",
    "severity": "high",
    "environment": "production",
    "affected_components": ["data-processor", "memory-manager"],
    "reproduction_rate": "100%"
  },
  "reproduction": {
    "status": "success|failed",
    "steps": [
      "Load dataset with 10,000+ records",
      "Trigger processing operation",
      "Observe memory usage during processing"
    ],
    "observed_behavior": "Out of memory error after processing 8,000 records",
    "expected_behavior": "Process all records without memory errors",
    "evidence": [
      "logs/error.log:1234-1250",
      "metrics/memory-usage-spike.png"
    ]
  },
  "root_cause": {
    "identified": true,
    "cause": "Memory leak in batch processing loop",
    "location": "src/processors/batch-processor.ts:145-167",
    "explanation": "Batch processor accumulates results without clearing intermediate buffers",
    "contributing_factors": [
      "No buffer size limit enforcement",
      "Missing garbage collection between batches"
    ],
    "confidence": 0.9
  },
  "fix": {
    "implemented": true,
    "approach": "Add buffer clearing after each batch and enforce size limits",
    "changes": [
      {
        "file": "src/processors/batch-processor.ts",
        "lines_changed": 12,
        "description": "Added buffer.clear() calls and max size validation"
      }
    ],
    "verification": {
      "status": "passed",
      "tests_run": 25,
      "tests_passed": 25,
      "tests_failed": 0,
      "performance_impact": "negligible"
    }
  },
  "regression_tests": {
    "created": true,
    "test_files": [
      "tests/processors/batch-processor-memory.test.ts"
    ],
    "test_cases": [
      {
        "name": "handles large datasets without memory leaks",
        "type": "integration",
        "coverage": "batch processing with 10k+ records"
      },
      {
        "name": "clears buffers between batches",
        "type": "unit",
        "coverage": "buffer clearing logic"
      }
    ],
    "all_passing": true
  },
  "timeline": {
    "issue_reported": "ISO-8601",
    "reproduction_confirmed": "ISO-8601",
    "root_cause_identified": "ISO-8601",
    "fix_implemented": "ISO-8601",
    "fix_verified": "ISO-8601",
    "total_resolution_time": 120
  },
  "metadata": {
    "processing_time": 120,
    "cache_savings": 0.20,
    "files_modified": 2,
    "tests_created": 2,
    "stakeholders_notified": true
  }
}
```

## Success Criteria

#### Automated Verification

- [ ] Issue successfully reproduced in controlled environment
- [ ] Root cause identified with supporting evidence
- [ ] Fix implemented and code reviewed
- [ ] All existing tests continue to pass
- [ ] New regression tests created and passing
- [ ] Performance impact assessed and acceptable
- [ ] Cache updated with successful debugging patterns

#### Manual Verification

- [ ] Fix resolves original issue completely
- [ ] No unintended side effects or regressions introduced
- [ ] Code changes follow project conventions and best practices
- [ ] Issue documentation updated with resolution details
- [ ] Knowledge base updated with debugging insights
- [ ] Stakeholders notified of resolution

## Debugging Strategy Framework

### Issue Reproduction Strategies

- **Direct Reproduction**: Follow exact steps provided in issue report
- **Simplified Reproduction**: Create minimal reproduction case
- **Environment Simulation**: Replicate production environment conditions
- **Automated Reproduction**: Create automated test that triggers issue

### Root Cause Analysis Techniques

- **Stack Trace Analysis**: Examine error call stacks and exception details
- **Code Path Tracing**: Follow execution flow through affected components
- **State Inspection**: Analyze application state at failure point
- **Binary Search**: Isolate problematic code through systematic testing
- **Hypothesis Testing**: Systematically test potential root causes

## Issue Reproduction Best Practices

### Evidence Collection

- **Error Logs**: Gather complete error messages and stack traces
- **System Metrics**: Collect CPU, memory, network metrics during issue
- **Application State**: Capture relevant state and configuration
- **Reproduction Steps**: Document exact steps that trigger the issue
- **Environment Details**: Record environment configuration and dependencies

### Reproduction Verification

- **Consistent Reproduction**: Verify issue occurs reliably with same steps
- **Isolation**: Confirm issue is not caused by unrelated factors
- **Minimal Case**: Reduce reproduction to simplest possible scenario
- **Documentation**: Record all reproduction findings clearly

## Root Cause Analysis Guidelines

### Analysis Techniques

- **Log Analysis**: Examine logs for error patterns and sequences
- **Code Review**: Inspect code paths related to failure
- **Debugging Tools**: Use debuggers, profilers, and tracing tools
- **Dependency Analysis**: Check external service and library interactions
- **Historical Analysis**: Review recent changes that may be related

### Hypothesis Testing

- **Formulate Hypotheses**: Develop testable theories about root cause
- **Design Experiments**: Create tests to validate or invalidate hypotheses
- **Systematic Testing**: Test hypotheses methodically and document results
- **Evidence-Based Conclusions**: Base conclusions on concrete evidence

## Fix Implementation Best Practices

### Solution Design

- **Address Root Cause**: Fix underlying issue, not just symptoms
- **Minimal Changes**: Make smallest change that resolves the issue
- **Maintainability**: Ensure fix is understandable and maintainable
- **Performance**: Validate fix doesn't introduce performance issues
- **Security**: Ensure fix doesn't create security vulnerabilities

### Code Quality

- **Follow Conventions**: Adhere to project coding standards
- **Add Comments**: Document why fix is needed and how it works
- **Error Handling**: Include appropriate error handling
- **Edge Cases**: Handle boundary conditions and error scenarios

## Regression Testing Guidelines

### Test Design

- **Reproduction Tests**: Create tests that reproduce original issue
- **Fix Validation**: Verify fix resolves issue in all scenarios
- **Edge Case Coverage**: Test boundary conditions and error cases
- **Integration Coverage**: Validate interactions with other components
- **Performance Tests**: Ensure fix maintains performance requirements

### Test Implementation

- **Clear Test Names**: Use descriptive names explaining what is tested
- **Specific Assertions**: Use precise assertions, not generic checks
- **Isolated Tests**: Ensure tests are independent and repeatable
- **Documentation**: Document why each test exists and what it prevents

## Edge Cases

### Intermittent Issues

- Increase reproduction attempts to identify patterns
- Add instrumentation to capture state when issue occurs
- Use statistical analysis to identify triggers
- Create tests that handle non-deterministic behavior

### Environment-Specific Issues

- Reproduce in target environment or create accurate simulation
- Identify environment-specific configuration differences
- Document environment requirements for reproduction
- Test fix in target environment before deploying

### Performance-Related Issues

- Use profiling tools to identify bottlenecks
- Create performance benchmarks before and after fix
- Validate fix under load conditions
- Monitor resource usage patterns

## Anti-Patterns

### Avoid These Practices

- **Symptom fixing**: Don't fix symptoms without addressing root cause
- **Rushed analysis**: Don't skip thorough investigation to save time
- **Insufficient testing**: Don't deploy fixes without comprehensive testing
- **Poor documentation**: Don't leave fixes undocumented for future reference
- **Cache bypass**: Don't skip cache checks for performance reasons

## Caching Guidelines

## Enhanced Subagent Orchestration for Debugging

### Comprehensive Debugging Workflow

For complex issues requiring multi-domain investigation:

#### Phase 1: Issue Reproduction & Analysis (Parallel)

- **codebase-locator**: Identify all components related to the issue
- **codebase-analyzer**: Understand implementation details of affected code
- **research-analyzer**: Review historical context and similar past issues
- **error-detective**: Search logs and codebases for error patterns
- **codebase-pattern-finder**: Identify similar patterns and known issues

#### Phase 2: Domain-Specific Root Cause Analysis (Sequential)

- **debugger**: Primary debugging specialist for systematic investigation
- **performance-engineer**: Analyze performance-related root causes
- **security-scanner**: Investigate security-related issue causes
- **database-expert**: Analyze database-related issues and queries
- **network-engineer**: Investigate network and connectivity issues
- **infrastructure-builder**: Analyze infrastructure and configuration issues

#### Phase 3: Fix Implementation & Validation (Sequential)

- **full-stack-developer**: Implement fix based on root cause analysis
- **code-reviewer**: Review fix quality and potential side effects
- **security-scanner**: Validate fix doesn't introduce security issues
- **performance-engineer**: Ensure fix maintains performance standards

#### Phase 4: Testing & Regression Prevention (Parallel)

- **test-generator**: Generate comprehensive regression test suites
- **quality-testing-performance-tester**: Execute performance and load tests
- **full-stack-developer**: Implement and validate regression tests
- **code-reviewer**: Review test quality and coverage completeness

#### Phase 5: Documentation & Knowledge Transfer (Parallel)

- **content-writer**: Document issue resolution and debugging insights
- **research-analyzer**: Update knowledge base with debugging learnings
- **incident-responder**: Update incident response procedures if applicable

### Debugging Orchestration Best Practices

1. **Comprehensive Investigation**: Use multiple domain experts for thorough analysis
2. **Systematic Approach**: Follow structured debugging methodology
3. **Evidence-Based Analysis**: Base conclusions on concrete evidence
4. **Quality Validation**: Include code-reviewer for fix review
5. **Regression Prevention**: Generate comprehensive regression tests
6. **Knowledge Capture**: Document debugging insights for future reference

### Debugging Quality Gates

- **Reproduction Confirmed**: Issue reliably reproduced before proceeding
- **Root Cause Identified**: Clear understanding of underlying issue
- **Fix Validated**: Fix resolves issue without introducing regressions
- **Code Quality**: Fix reviewed and approved by code-reviewer
- **Test Coverage**: Comprehensive regression tests created and passing
- **Performance Validated**: Fix maintains performance standards
- **Documentation Complete**: Issue resolution thoroughly documented

### Debugging Risk Mitigation

- **Systematic Investigation**: Follow structured debugging process
- **Hypothesis Testing**: Test theories systematically with evidence
- **Incremental Fixes**: Implement and test changes incrementally
- **Regression Prevention**: Create tests before marking issue resolved
- **Code Review**: Include expert review of all fix implementations
- **Performance Monitoring**: Track performance impact of fixes

### Cache Usage Patterns

- **Issue patterns**: Store successful debugging approaches for similar issues
- **Root cause patterns**: Cache common root cause analysis techniques
- **Fix strategies**: Remember effective fix implementation patterns

### Cache Invalidation Triggers

- **Manual**: Clear cache when debugging methodology changes
- **Content-based**: Invalidate when issue characteristics change significantly
- **Time-based**: Refresh cache every 30 minutes during active debugging

### Performance Optimization

- Cache hit rate target: ≥ 65% for repeated issue patterns
- Memory usage: < 20MB for debugging pattern cache
- Response time: < 75ms for cache queries

{{issue}}
