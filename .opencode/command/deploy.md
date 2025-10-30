---
name: deploy
mode: command
description: Execute deployment workflow with pre-deployment validation, deployment execution, and post-deployment verification
version: 1.0.0
last_updated: 2025-10-16
command_schema_version: 1.0
inputs:
  - name: environment
    type: string
    required: true
    description: Target deployment environment (staging|production|development)
  - name: version
    type: string
    required: false
    description: Version to deploy (defaults to current HEAD)
  - name: rollback_on_failure
    type: boolean
    required: false
    description: Automatically rollback on deployment failure (default true)
  - name: skip_validation
    type: boolean
    required: false
    description: Skip pre-deployment validation checks (default false)
outputs:
  - name: deployment_status
    type: structured
    format: JSON with deployment results and verification status
    description: Comprehensive deployment execution results and status
cache_strategy:
  type: agent_specific
  ttl: 600
  invalidation: manual
  scope: command
success_signals:
  - 'Pre-deployment validation passed'
  - 'Deployment executed successfully'
  - 'Post-deployment verification completed'
  - 'Service health checks passing'
failure_modes:
  - 'Pre-deployment validation failed'
  - 'Deployment execution failed'
  - 'Post-deployment verification failed'
  - 'Rollback required and executed'
validation_rules:
  - rule: require_environment
    severity: error
    message: Target environment must be specified
    condition: environment
---

# Deploy Application

Execute a complete deployment workflow with comprehensive validation, execution, and verification phases to ensure safe and reliable deployments.

## Purpose

Orchestrate deployment processes across environments with pre-deployment validation, controlled execution, and post-deployment verification to minimize deployment risks and ensure service reliability.

## Inputs

- **environment**: Target deployment environment (staging|production|development)
- **version**: Optional version to deploy (defaults to current HEAD)
- **rollback_on_failure**: Optional flag to enable automatic rollback (default true)
- **skip_validation**: Optional flag to skip pre-deployment validation (default false)
- **conversation_context**: History of deployment discussions and preparations

## Preconditions

- Deployment infrastructure configured and accessible
- Deployment credentials and permissions available
- Target environment is accessible and ready
- Monitoring and alerting systems are operational
- Rollback procedures are prepared and tested

## Process Phases

### Phase 1: Pre-Deployment Validation

1. **Check Cache First**: Query cache for similar deployment patterns using environment and version hash
2. **Validate Build Artifacts**: Ensure all required build artifacts exist and are valid
3. **Run Pre-Deploy Tests**: Execute smoke tests, integration tests, and validation checks
4. **Verify Infrastructure**: Confirm infrastructure is ready and has sufficient capacity
5. **Check Dependencies**: Validate all external dependencies and services are available
6. **Review Security**: Scan for security vulnerabilities and compliance issues
7. **Backup Current State**: Create recovery points for rollback capability

### Phase 2: Deployment Execution

1. **Prepare Deployment**: Stage deployment artifacts and configure deployment parameters
2. **Execute Deployment**: Deploy to target environment using appropriate strategy
3. **Monitor Deployment**: Track deployment progress and health metrics
4. **Handle Failures**: Detect and respond to deployment failures immediately
5. **Execute Migration**: Run database migrations and data transformations if needed
6. **Update Configuration**: Apply environment-specific configuration changes
7. **Rollback on Error**: Execute rollback if critical failures are detected

### Phase 3: Post-Deployment Verification

1. **Run Smoke Tests**: Execute critical path smoke tests on deployed application
2. **Verify Health Checks**: Confirm all service health endpoints are responding
3. **Monitor Performance**: Track performance metrics and compare to baselines
4. **Validate Functionality**: Execute post-deployment integration and E2E tests
5. **Check Logs and Metrics**: Review deployment logs and monitoring metrics
6. **Notify Stakeholders**: Send deployment status notifications to relevant teams
7. **Update Cache**: Store successful deployment patterns for future reference

## Error Handling

### Pre-Deployment Validation Failure

```error-context
{
  "command": "deploy",
  "phase": "pre_deployment_validation",
  "error_type": "validation_failed",
  "expected": "All pre-deployment validation checks pass",
  "found": "3 critical validation failures detected",
  "mitigation": "Review validation failures and resolve before deploying",
  "requires_user_input": true
}
```

### Deployment Execution Failure

```error-context
{
  "command": "deploy",
  "phase": "deployment_execution",
  "error_type": "deployment_failed",
  "expected": "Deployment completes successfully",
  "found": "Deployment failed with connection timeout",
  "mitigation": "Automatically rolling back to previous version",
  "requires_user_input": false
}
```

### Post-Deployment Verification Failure

```error-context
{
  "command": "deploy",
  "phase": "post_deployment_verification",
  "error_type": "verification_failed",
  "expected": "All health checks and smoke tests pass",
  "found": "Critical smoke tests failing after deployment",
  "mitigation": "Initiate rollback procedure immediately",
  "requires_user_input": false
}
```

## Structured Output Specification

### Primary Output

```command-output:deployment_status
{
  "status": "success|failed|rolled_back",
  "timestamp": "ISO-8601",
  "cache": {
    "hit": true|false,
    "key": "deployment_pattern:{environment}:{version}",
    "ttl_remaining": 600,
    "savings": 0.15
  },
  "deployment": {
    "environment": "production",
    "version": "v2.5.0",
    "strategy": "blue-green|canary|rolling",
    "start_time": "ISO-8601",
    "end_time": "ISO-8601",
    "duration": 180
  },
  "validation": {
    "pre_deployment": {
      "status": "passed|failed",
      "checks": [
        {
          "name": "Build artifacts validation",
          "status": "passed",
          "duration": 15
        },
        {
          "name": "Infrastructure readiness",
          "status": "passed",
          "duration": 30
        },
        {
          "name": "Security scan",
          "status": "passed",
          "duration": 45
        }
      ]
    },
    "post_deployment": {
      "status": "passed|failed",
      "checks": [
        {
          "name": "Service health checks",
          "status": "passed",
          "endpoints": 5,
          "duration": 20
        },
        {
          "name": "Smoke tests",
          "status": "passed",
          "tests_run": 12,
          "duration": 60
        },
        {
          "name": "Performance validation",
          "status": "passed",
          "metrics_checked": 8,
          "duration": 40
        }
      ]
    }
  },
  "execution": {
    "artifacts_deployed": 15,
    "migrations_run": 3,
    "configuration_updated": true,
    "rollback_available": true
  },
  "health": {
    "service_status": "healthy|degraded|unhealthy",
    "response_time_p95": 125,
    "error_rate": 0.01,
    "active_instances": 6
  },
  "rollback": {
    "required": false,
    "executed": false,
    "reason": null,
    "recovery_time": null
  },
  "issues": [
    {
      "type": "warning",
      "description": "Response time slightly elevated",
      "severity": "low",
      "resolved": true
    }
  ],
  "metadata": {
    "processing_time": 180,
    "cache_savings": 0.15,
    "notifications_sent": 3,
    "stakeholders_notified": true
  }
}
```

## Success Criteria

#### Automated Verification

- [ ] Pre-deployment validation checks all pass
- [ ] Deployment executes without critical errors
- [ ] All service health checks pass after deployment
- [ ] Smoke tests execute successfully on deployed application
- [ ] Performance metrics are within acceptable ranges
- [ ] Monitoring and alerting confirm healthy service state
- [ ] Cache updated with successful deployment patterns

#### Manual Verification

- [ ] Deployment rollback capability is confirmed and ready
- [ ] Critical user workflows function correctly
- [ ] Database migrations completed successfully
- [ ] Configuration changes applied correctly
- [ ] Stakeholders notified of deployment status
- [ ] Deployment documentation updated

## Deployment Strategy Framework

### Deployment Strategies

- **Blue-Green**: Full environment switch with instant rollback capability
- **Canary**: Gradual rollout with traffic shifting and validation
- **Rolling**: Sequential instance updates with health monitoring
- **Recreate**: Stop old version, deploy new version (downtime expected)

### Deployment Best Practices

- **Incremental Rollout**: Deploy to smaller environments first (dev → staging → production)
- **Monitoring Integration**: Track metrics continuously during deployment
- **Automated Rollback**: Enable automatic rollback on critical failure detection
- **Communication**: Notify stakeholders at each deployment phase
- **Documentation**: Maintain deployment runbooks and post-mortems

## Pre-Deployment Validation Guidelines

### Build Artifact Validation

- **Artifact Integrity**: Verify checksums and signatures
- **Dependency Verification**: Confirm all dependencies are available
- **Configuration Validation**: Ensure environment-specific configs are correct
- **Security Scanning**: Check for vulnerabilities and compliance issues

### Infrastructure Readiness

- **Capacity Check**: Verify sufficient resources (CPU, memory, storage)
- **Network Connectivity**: Confirm network paths and firewall rules
- **Service Dependencies**: Validate external services are available
- **Backup Status**: Ensure recovery points exist for rollback

## Deployment Execution Best Practices

### Deployment Monitoring

- **Real-Time Metrics**: Track deployment progress and health indicators
- **Log Aggregation**: Centralize logs for immediate issue detection
- **Error Detection**: Monitor for errors and anomalies during deployment
- **Performance Tracking**: Compare metrics to established baselines

### Migration Management

- **Database Migrations**: Execute schema changes with rollback capability
- **Data Transformations**: Apply data migrations with validation
- **Backward Compatibility**: Ensure migrations don't break existing functionality
- **Migration Testing**: Validate migrations in non-production environments first

## Post-Deployment Verification Guidelines

### Health Check Validation

- **Endpoint Testing**: Verify all service endpoints respond correctly
- **Dependency Checks**: Confirm external service integrations work
- **Database Connectivity**: Validate database connections and queries
- **Cache Warmup**: Ensure caches are populated and performing

### Smoke Test Execution

- **Critical Paths**: Test essential user workflows immediately
- **Integration Tests**: Verify component interactions function correctly
- **Performance Tests**: Confirm response times are acceptable
- **Security Tests**: Validate authentication and authorization work

## Rollback Procedures

### Automatic Rollback Triggers

- **Critical Health Check Failure**: Service health checks fail after deployment
- **Excessive Error Rate**: Error rates exceed acceptable thresholds
- **Performance Degradation**: Response times significantly worse than baseline
- **Smoke Test Failures**: Critical smoke tests fail post-deployment

### Rollback Execution

- **Immediate Detection**: Identify rollback triggers within minutes
- **Automated Execution**: Execute rollback procedure automatically
- **State Recovery**: Restore database and application state
- **Verification**: Confirm rollback completed successfully
- **Notification**: Alert stakeholders of rollback and reasons

## Edge Cases

### Partial Deployment Failures

- Identify which components deployed successfully
- Determine if partial rollback is needed
- Assess impact on dependent services
- Execute appropriate recovery procedure

### Migration Rollback Challenges

- Handle data migrations that cannot be easily reversed
- Maintain data consistency during rollback
- Communicate data state to dependent systems
- Document migration rollback limitations

### Zero-Downtime Requirements

- Use blue-green or canary strategies for no downtime
- Maintain backward compatibility during transition
- Ensure database migrations support old and new versions
- Validate traffic routing during deployment

## Anti-Patterns

### Avoid These Practices

- **Skip validation**: Never skip pre-deployment validation checks
- **Manual deployments**: Avoid manual deployment steps without automation
- **No rollback plan**: Never deploy without tested rollback capability
- **Insufficient monitoring**: Don't deploy without comprehensive monitoring
- **Cache bypass**: Don't skip cache checks for performance reasons

## Caching Guidelines

## Enhanced Subagent Orchestration for Deployment

### Comprehensive Deployment Workflow

For production deployments requiring multi-domain coordination:

#### Phase 1: Pre-Deployment Validation (Parallel)

- **security-scanner**: Comprehensive security vulnerability scanning
- **compliance-expert**: Validate regulatory compliance requirements
- **code-reviewer**: Final code quality and security review
- **performance-engineer**: Validate performance benchmarks and thresholds
- **database-expert**: Review database migration scripts and rollback procedures
- **infrastructure-builder**: Verify infrastructure readiness and capacity

#### Phase 2: Deployment Preparation (Sequential)

- **deployment-wizard**: Primary orchestrator for deployment automation
- **infrastructure-builder**: Prepare infrastructure and configuration
- **database-expert**: Execute database migrations and backups
- **monitoring-expert**: Configure monitoring and alerting for deployment
- **cost-optimizer**: Validate cost implications of deployment changes

#### Phase 3: Deployment Execution (Sequential)

- **deployment-wizard**: Execute deployment with chosen strategy
- **devops-operations-specialist**: Monitor deployment execution and health
- **incident-responder**: Stand by for immediate issue response
- **monitoring-expert**: Track real-time deployment metrics and alerts

#### Phase 4: Post-Deployment Validation (Parallel)

- **quality-testing-performance-tester**: Execute smoke tests and performance validation
- **security-scanner**: Verify security controls in deployed environment
- **monitoring-expert**: Confirm monitoring and alerting operational
- **full-stack-developer**: Validate functional correctness of deployment
- **incident-responder**: Monitor for post-deployment issues

#### Phase 5: Documentation & Communication (Parallel)

- **content-writer**: Update deployment documentation and release notes
- **research-analyzer**: Document deployment learnings and improvements
- **devops-operations-specialist**: Update operational runbooks

### Deployment Orchestration Best Practices

1. **Comprehensive Validation**: Use multiple domain experts for thorough pre-deployment validation
2. **Automated Execution**: Leverage deployment-wizard for consistent deployment automation
3. **Real-Time Monitoring**: Include monitoring-expert for continuous health tracking
4. **Incident Readiness**: Have incident-responder available during deployment
5. **Quality Validation**: Execute comprehensive post-deployment testing
6. **Documentation Updates**: Keep deployment documentation current

### Deployment Quality Gates

- **Security Validation**: Cleared by security-scanner before deployment
- **Performance Baseline**: Validated by performance-engineer and quality-testing-performance-tester
- **Infrastructure Readiness**: Confirmed by infrastructure-builder
- **Migration Validation**: Approved by database-expert
- **Compliance Check**: Cleared by compliance-expert (if applicable)
- **Monitoring Setup**: Validated by monitoring-expert
- **Rollback Readiness**: Confirmed by deployment-wizard and devops-operations-specialist

### Deployment Risk Mitigation

- **Incremental Rollout**: Deploy to smaller environments first with validation
- **Automated Testing**: Execute comprehensive smoke tests immediately
- **Real-Time Monitoring**: Track metrics continuously during deployment
- **Rollback Capability**: Maintain tested rollback procedures for immediate use
- **Incident Response**: Have incident-responder ready for immediate issue resolution
- **Communication Plan**: Keep stakeholders informed throughout deployment

### Cache Usage Patterns

- **Deployment strategies**: Store successful deployment approaches for environments
- **Validation patterns**: Cache effective validation check combinations
- **Rollback procedures**: Remember successful rollback execution patterns

### Cache Invalidation Triggers

- **Manual**: Clear cache when deployment infrastructure changes
- **Content-based**: Invalidate when deployment strategy changes
- **Time-based**: Refresh cache every 10 minutes during active deployments

### Performance Optimization

- Cache hit rate target: ≥ 60% for repeated deployment patterns
- Memory usage: < 15MB for deployment pattern cache
- Response time: < 50ms for cache queries

{{environment}}
