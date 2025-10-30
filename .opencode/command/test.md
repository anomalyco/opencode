---
name: test
mode: command
description: Generate and run a comprehensive testing workflow
version: 2.0.0-internal
last_updated: 2025-09-13
command_schema_version: 1.0
inputs:
  - name: scope
    type: string
    required: true
    description: Short description of the feature/area under test
  - name: files
    type: array
    required: false
    description: Paths that must be tested or that changed
  - name: plan
    type: string
    required: false
    description: Path to implementation plan to derive criteria from
outputs:
  - name: test_results
    type: structured
    format: JSON with test execution results and coverage
    description: Comprehensive test execution results and analysis
cache_strategy:
  type: agent_specific
  ttl: 900
  invalidation: manual
  scope: command
success_signals:
  - 'Test suite generated and executed successfully'
  - 'All automated tests passing'
  - 'Test coverage report generated'
failure_modes:
  - 'Test generation failed due to missing context'
  - 'Automated tests failing with errors'
  - 'Test execution environment not configured'
---

# Generate Test Suite

You are tasked with designing, generating, and executing comprehensive tests for implemented features or plans. This command uses intelligent caching to optimize testing workflows and maintain consistency across similar test generation scenarios.

## Purpose

Create complete test coverage including automated unit/integration tests, manual test scenarios, and performance validation to ensure implementation quality and prevent regressions.

## Inputs

- **scope**: Short description of the feature/area under test
- **files**: Optional array of paths that must be tested or that changed
- **plan**: Optional path to implementation plan for deriving test criteria
- **conversation_context**: History of implementation and testing discussions

## Preconditions

- Implementation code exists and is accessible
- Testing framework is configured and available
- Development environment supports test execution
- Access to related modules and dependencies for integration testing

## Process Phases

### Phase 1: Context Analysis & Strategy Development

1. **Check Cache First**: Query cache for similar testing patterns using feature context hash
2. **Read Complete Context**: Read plan, implementation files, and related modules
3. **Analyze Test Requirements**: Identify unit, integration, and E2E testing needs
4. **Derive Test Strategy**: Map success criteria to concrete test scenarios
5. **Identify Critical Paths**: Enumerate edge cases, failure modes, and boundary conditions

### Phase 2: Test Suite Design & Generation

1. **Design Test Structure**: Plan test files, describe blocks, and test cases
2. **Generate Test Files**: Create comprehensive test suites following project conventions
3. **Implement Test Cases**: Write clear, deterministic assertions with proper setup/teardown
4. **Include Edge Cases**: Add negative tests, boundary values, and error conditions
5. **Validate Test Design**: Ensure tests cover all critical functionality

### Phase 3: Execution & Validation

1. **Execute Automated Tests**: Run type checks, unit tests, and integration tests
2. **Analyze Results**: Triage failures and identify root causes
3. **Iterate on Failures**: Fix implementation issues or adjust test expectations
4. **Generate Coverage Report**: Assess test coverage and identify gaps
5. **Update Cache**: Store successful testing patterns for future reference

## Error Handling

### Context Missing Error

```error-context
{
  "command": "test",
  "phase": "context_analysis",
  "error_type": "missing_context",
  "expected": "Implementation files or plan for testing",
  "found": "No files specified and no recent implementation found",
  "mitigation": "Provide specific files to test or implementation plan",
  "requires_user_input": true
}
```

### Test Execution Failure

```error-context
{
  "command": "test",
  "phase": "execution",
  "error_type": "test_failure",
  "expected": "All tests pass successfully",
  "found": "5 tests failing with assertion errors",
  "mitigation": "Fix implementation issues or adjust test expectations",
  "requires_user_input": false
}
```

### Environment Configuration Error

```error-context
{
  "command": "test",
  "phase": "setup",
  "error_type": "environment_not_configured",
  "expected": "Testing framework available and configured",
  "found": "Test runner not found in package.json",
  "mitigation": "Install and configure testing framework",
  "requires_user_input": true
}
```

## Structured Output Specification

### Primary Output

```command-output:test_results
{
  "status": "success|failures|incomplete",
  "timestamp": "ISO-8601",
  "cache": {
    "hit": true|false,
    "key": "test_pattern:{feature_hash}:{scope}",
    "ttl_remaining": 900,
    "savings": 0.25
  },
  "test_plan": {
    "scope": "User authentication feature",
    "strategy": {
      "layers": ["unit", "integration", "e2e"],
      "critical_paths": ["login_flow", "password_reset", "session_management"],
      "edge_cases": ["invalid_credentials", "expired_sessions", "concurrent_logins"]
    }
  },
  "execution": {
    "typecheck": {
      "status": "passed|failed",
      "duration": 45,
      "errors": 0
    },
    "unit_tests": {
      "status": "passed|failed",
      "total": 25,
      "passed": 23,
      "failed": 2,
      "duration": 120
    },
    "integration_tests": {
      "status": "passed|failed",
      "total": 8,
      "passed": 8,
      "failed": 0,
      "duration": 85
    }
  },
  "coverage": {
    "overall": 85.5,
    "by_file": [
      {
        "file": "src/auth/login.ts",
        "coverage": 92.3,
        "lines_covered": 45,
        "total_lines": 49
      }
    ]
  },
  "manual_testing": [
    {
      "scenario": "UI Login Flow",
      "steps": [
        "Navigate to login page",
        "Enter valid credentials",
        "Verify redirect to dashboard",
        "Check session persistence"
      ],
      "priority": "high"
    },
    {
      "scenario": "Error Handling",
      "steps": [
        "Enter invalid credentials",
        "Verify error message display",
        "Test password reset flow",
        "Check rate limiting"
      ],
      "priority": "medium"
    }
  ],
  "issues": [
    {
      "type": "test_failure",
      "description": "Login validation fails for edge case",
      "severity": "medium",
      "resolution": "Adjust validation logic"
    }
  ],
  "metadata": {
    "processing_time": 250,
    "cache_savings": 0.25,
    "test_files_generated": 4,
    "test_files_existing": 2
  }
}
```

## Success Criteria

#### Automated Verification

- [ ] All generated test files created following project conventions
- [ ] Type checking passes without errors
- [ ] Unit tests execute and pass for core functionality
- [ ] Integration tests validate component interactions
- [ ] Test coverage report generated with acceptable thresholds
- [ ] Cache updated with successful testing patterns

#### Manual Verification

- [ ] Manual test scenarios are clearly documented with step-by-step instructions
- [ ] Edge cases and error conditions are properly tested
- [ ] Test failures are triaged and resolved appropriately
- [ ] Test suite provides adequate coverage for feature requirements
- [ ] Performance and load testing considerations are included

## Testing Strategy Framework

### Test Layer Organization

- **Unit Tests**: Individual functions, classes, and modules in isolation
- **Integration Tests**: Component interactions and data flow between modules
- **End-to-End Tests**: Complete user workflows and system interactions
- **Performance Tests**: Load testing, stress testing, and scalability validation

### Test Case Design Principles

- **Clear Assertions**: Use specific, deterministic assertions over snapshots
- **Boundary Testing**: Include edge cases, boundary values, and error conditions
- **Negative Testing**: Test failure scenarios and error handling
- **Data-Driven Tests**: Parameterize tests for multiple input scenarios
- **Maintainable Tests**: Follow DRY principles and clear naming conventions

## Test Generation Best Practices

### File Organization

- **Test File Naming**: Follow project conventions (`.test.ts`, `.spec.ts`, etc.)
- **Test Structure**: Use describe/it blocks for logical grouping
- **Setup/Teardown**: Proper test isolation with beforeEach/afterEach
- **Mock Strategy**: Mock external dependencies while testing core logic

### Test Case Categories

- **Happy Path**: Primary functionality works as expected
- **Edge Cases**: Boundary conditions and unusual inputs
- **Error Conditions**: System behavior under failure scenarios
- **Performance**: Response times and resource usage
- **Security**: Input validation and access control

## Execution and Analysis

### Automated Test Execution

- **Sequential Runs**: Execute tests in logical dependency order
- **Parallel Execution**: Run independent test suites concurrently when possible
- **Failure Analysis**: Detailed error reporting with stack traces
- **Retry Logic**: Handle flaky tests with appropriate retry mechanisms

### Coverage Analysis

- **Coverage Metrics**: Line, branch, and function coverage percentages
- **Coverage Goals**: Establish minimum acceptable coverage thresholds
- **Gap Analysis**: Identify untested code paths and missing scenarios
- **Coverage Trends**: Track coverage improvements over time

## Manual Testing Guidelines

### Scenario Documentation

- **Step-by-Step Instructions**: Clear, actionable test procedures
- **Expected Results**: Specific outcomes for each test step
- **Prerequisites**: Required setup and test data
- **Environment Notes**: Browser, device, or system requirements

### Test Data Management

- **Test Fixtures**: Consistent test data across automated and manual tests
- **Data Cleanup**: Proper teardown and cleanup procedures
- **Data Isolation**: Prevent test data interference between test runs

## Performance Testing Integration

### Load Testing Scenarios

- **Concurrent Users**: Simulate multiple users accessing the system
- **Data Volume**: Test with large datasets and high transaction volumes
- **Response Times**: Validate performance under various load conditions
- **Resource Usage**: Monitor memory, CPU, and network utilization

### Performance Benchmarks

- **Baseline Metrics**: Establish performance expectations
- **Regression Detection**: Identify performance degradation
- **Scalability Testing**: Validate system behavior under increasing load

## Edge Cases

### Complex Feature Testing

- Break down complex features into testable component parts
- Create integration tests for component interactions
- Use mocking to isolate complex dependencies

### Legacy System Integration

- Test integration points between new and existing code
- Validate data compatibility and migration scenarios
- Ensure backward compatibility is maintained

### Asynchronous Operation Testing

- Test timing-dependent functionality
- Handle race conditions and concurrency issues
- Validate timeout and retry mechanisms

## Anti-Patterns

### Avoid These Practices

- **Snapshot over-reliance**: Don't use snapshots for logic that should be explicitly tested
- **Flaky tests**: Don't create tests that fail intermittently without clear causes
- **Test interdependence**: Don't create tests that depend on other test execution order
- **Cache bypass**: Don't skip cache checks for performance reasons

## Caching Guidelines

## Enhanced Subagent Orchestration for Testing

### Comprehensive Testing Workflow

For thorough test generation and validation requiring multiple testing domains:

#### Phase 1: Test Strategy Development (Parallel)

- **codebase-locator**: Identify all components and files that need testing
- **codebase-analyzer**: Understand implementation details and dependencies
- **research-analyzer**: Review existing test documentation and testing patterns
- **codebase-pattern-finder**: Identify established testing patterns in the codebase
- **test-generator**: Primary agent for comprehensive test suite generation

#### Phase 2: Domain-Specific Test Generation (Sequential)

- **api-builder**: Generate API contract and integration tests
- **database-expert**: Create database interaction and migration tests
- **security-scanner**: Develop security-focused test cases
- **performance-engineer**: Design performance and load testing scenarios
- **accessibility-pro**: Generate accessibility compliance tests
- **compliance-expert**: Create regulatory compliance validation tests

#### Phase 3: Test Execution & Validation (Parallel)

- **quality-testing-performance-tester**: Execute performance, load, and stress tests
- **full-stack-developer**: Validate test implementation and fix issues
- **code-reviewer**: Review test code quality and coverage completeness
- **monitoring-expert**: Validate monitoring and alerting test scenarios

#### Phase 4: Integration & System Testing (Sequential)

- **infrastructure-builder**: Test infrastructure and deployment scenarios
- **deployment-wizard**: Validate deployment and rollback testing
- **devops-operations-specialist**: Test operational procedures and monitoring
- **cost-optimizer**: Validate cost-related test scenarios

#### Phase 5: Documentation & Reporting (Parallel)

- **content-writer**: Document test scenarios and procedures
- **research-analyzer**: Update testing documentation and best practices
- **content-localization-coordinator**: Test internationalization scenarios

### Testing Orchestration Best Practices

1. **Comprehensive Coverage**: Use multiple domain experts to ensure complete test coverage
2. **Test-First Generation**: Leverage test-generator for systematic test creation
3. **Domain Validation**: Include security, performance, and compliance testing
4. **Quality Assurance**: Use code-reviewer to validate test quality
5. **Integration Testing**: Include infrastructure and deployment validation
6. **Documentation Updates**: Keep testing documentation current

### Test Quality Gates

- **Unit Test Coverage**: Comprehensive unit tests for all functions and methods
- **Integration Testing**: API, database, and component interaction tests
- **Security Testing**: Vulnerability and security control validation
- **Performance Testing**: Load, stress, and performance benchmark tests
- **Accessibility Testing**: WCAG compliance and usability validation
- **Compliance Testing**: Regulatory requirement validation
- **Infrastructure Testing**: Deployment and operational scenario testing

### Test Optimization Strategies

- **Automated Generation**: Use test-generator for systematic test creation
- **Parallel Execution**: Run independent test suites simultaneously
- **Incremental Testing**: Test and validate in small increments
- **Regression Prevention**: Include comprehensive regression test suites
- **Performance Benchmarking**: Establish performance baselines and thresholds
- **Monitoring Integration**: Include monitoring and alerting validation

### Cache Usage Patterns

- **Test structures**: Store successful test organization patterns for similar features
- **Test cases**: Cache effective test case templates for common scenarios
- **Failure patterns**: Remember common failure modes and resolution approaches

### Cache Invalidation Triggers

- **Manual**: Clear cache when testing standards or frameworks change
- **Content-based**: Invalidate when feature implementation changes significantly
- **Time-based**: Refresh cache every 15 minutes for active testing sessions

### Performance Optimization

- Cache hit rate target: ≥ 70% for repeated testing patterns
- Memory usage: < 25MB for testing pattern cache
- Response time: < 75ms for cache queries

{{scope}}
