---
name: project-docs
mode: command
description: Generate comprehensive project documentation including PRD, security docs, user flows, and more
version: 1.0.0
last_updated: 2025-09-20
command_schema_version: 1.0
inputs:
  - name: prompt
    type: string
    required: true
    description: Project description or prompt to generate documentation from
  - name: analyze_existing
    type: boolean
    required: false
    description: Analyze existing project structure instead of using prompt
  - name: include_security
    type: boolean
    required: false
    description: 'Include security documentation (default: true)'
  - name: include_api_docs
    type: boolean
    required: false
    description: 'Include API documentation (default: true)'
outputs:
  - name: documentation_files
    type: structured
    format: JSON with file paths and metadata
    description: Generated documentation files with metadata
cache_strategy:
  type: agent_specific
  ttl: 7200
  invalidation: manual
  scope: command
success_signals:
  - 'All documentation files created successfully'
  - 'Files saved to docs/'
  - 'Documentation structure validated'
failure_modes:
  - 'Invalid project prompt or description'
  - 'Missing required agents for documentation generation'
  - 'Documentation directory not accessible'
---

# Generate Project Documentation

You are tasked with generating comprehensive project documentation based on a project prompt or existing project structure. This command orchestrates multiple specialized agents to create all essential documentation for a project.

## Purpose

Generate complete project documentation including Product Requirements Document (PRD), security documentation, user flows, API documentation, architecture documentation, deployment guides, and development guidelines.

## Inputs

- **prompt**: Project description or prompt to generate documentation from
- **analyze_existing**: Boolean flag to analyze existing project structure
- **include_security**: Include security documentation (default: true)
- **include_api_docs**: Include API documentation (default: true)
- **conversation_context**: History of project discussions and decisions

## Preconditions

- Valid project prompt or existing project structure to analyze
- Documentation directory `docs/` is writable
- All required agents are available and accessible
- Sufficient context about the project or codebase

## Process Phases

### Phase 1: Context Analysis & Planning

1. **Analyze Input**: Understand the project prompt or analyze existing structure
2. **Check Cache**: Query cache for similar documentation patterns
3. **Plan Documentation Set**: Determine which documentation types to generate
4. **Identify Required Agents**: Select appropriate specialized agents
5. **Create Documentation Structure**: Plan file organization and naming

### Phase 2: Documentation Generation

1. **Generate PRD**: Use product strategy analysis for requirements
2. **Create Security Documentation**: Use security-scanner for security analysis
3. **Document User Flows**: Use ux-optimizer for user experience flows
4. **Generate API Documentation**: Use api-builder for API specifications
5. **Create Architecture Documentation**: Use system-architect for system design
6. **Document Deployment**: Use deployment-wizard for deployment procedures
7. **Create Development Guidelines**: Use code-reviewer for coding standards
8. **Generate Testing Strategy**: Use test-generator for testing approach

### Phase 3: Validation & Finalization

1. **Validate Documentation Completeness**: Ensure all planned docs are created
2. **Cross-reference Validation**: Verify internal consistency
3. **Update Cache**: Store successful documentation patterns
4. **Generate Summary Report**: Create overview of generated documentation

## Agent Coordination Strategy

### Primary Agents Used

1. **system-architect**: Generate architecture documentation and system design
2. **security-scanner**: Create security documentation and threat analysis
3. **ux-optimizer**: Document user flows and user experience design
4. **api-builder**: Generate API documentation and endpoint specifications
5. **deployment-wizard**: Create deployment and operations documentation
6. **code-reviewer**: Generate development guidelines and coding standards
7. **test-generator**: Create testing strategy and test documentation

### Execution Order

1. **Phase 1**: Run system-architect and security-scanner in parallel
2. **Phase 2**: Execute ux-optimizer and api-builder concurrently
3. **Phase 3**: Run deployment-wizard and code-reviewer in parallel
4. **Phase 4**: Finalize with test-generator and validation

## Error Handling

### Invalid Input Error

```error-context
{
  "command": "project-docs",
  "phase": "input_validation",
  "error_type": "invalid_input",
  "expected": "Valid project prompt or existing project structure",
  "found": "Empty or invalid prompt",
  "mitigation": "Provide a clear project description or use --analyze-existing flag",
  "requires_user_input": true
}
```

### Agent Unavailable Error

```error-context
{
  "command": "project-docs",
  "phase": "agent_coordination",
  "error_type": "agent_unavailable",
  "expected": "All required agents available",
  "found": "security-scanner agent not found",
  "mitigation": "Install missing agents or run codeflow sync",
  "requires_user_input": true
}
```

### Permission Error

```error-context
{
  "command": "project-docs",
  "phase": "file_creation",
  "error_type": "permission_denied",
  "expected": "Write access to docs/",
  "found": "Permission denied",
  "mitigation": "Check directory permissions or specify alternative location",
  "requires_user_input": true
}
```

## Structured Output Specification

### Primary Output

```command-output:documentation_files
{
  "status": "success|in_progress|error",
  "timestamp": "ISO-8601",
  "cache": {
    "hit": true|false,
    "key": "project_docs:{prompt_hash}",
    "ttl_remaining": 7200,
    "savings": 0.35
  },
  "project": {
    "name": "Project Name",
    "description": "Brief project description",
    "scope": "small|medium|large|enterprise"
  },
  "documentation": {
    "total_files": 8,
    "types_generated": ["prd", "security", "user_flows", "api", "architecture", "deployment", "development", "testing"],
    "files": [
      {
        "type": "prd",
        "path": "docs/2025-09-20-project-prd.md",
        "title": "Project Name - Product Requirements Document",
        "sections": ["vision", "user_personas", "functional_requirements", "success_metrics"],
        "word_count": 1200
      },
      {
        "type": "security",
        "path": "docs/2025-09-20-project-security.md",
        "title": "Project Name - Security Documentation",
        "sections": ["threat_model", "security_controls", "compliance", "incident_response"],
        "word_count": 800
      },
      {
        "type": "user_flows",
        "path": "docs/2025-09-20-project-user-flows.md",
        "title": "Project Name - User Flow Documentation",
        "sections": ["user_journeys", "interaction_design", "wireframes", "usability_considerations"],
        "word_count": 600
      },
      {
        "type": "api",
        "path": "docs/2025-09-20-project-api.md",
        "title": "Project Name - API Documentation",
        "endpoints": 15,
        "examples": 8
      },
      {
        "type": "architecture",
        "path": "docs/2025-09-20-project-architecture.md",
        "title": "Project Name - Architecture Documentation",
        "sections": ["system_overview", "component_diagram", "data_flow", "deployment_architecture"],
        "word_count": 900
      },
      {
        "type": "deployment",
        "path": "docs/2025-09-20-project-deployment.md",
        "title": "Project Name - Deployment Guide",
        "sections": ["infrastructure_setup", "deployment_procedures", "monitoring", "rollback_strategy"],
        "word_count": 700
      },
      {
        "type": "development",
        "path": "docs/2025-09-20-project-development.md",
        "title": "Project Name - Development Guidelines",
        "sections": ["coding_standards", "code_review_process", "testing_requirements", "documentation_standards"],
        "word_count": 500
      },
      {
        "type": "testing",
        "path": "docs/2025-09-20-project-testing.md",
        "title": "Project Name - Testing Strategy",
        "sections": ["testing_approach", "test_types", "test_environment", "quality_gates"],
        "word_count": 400
      }
    ]
  },
  "metadata": {
    "processing_time": 420,
    "cache_savings": 0.35,
    "agents_used": 7,
    "total_words": 6000
  }
}
```

## Success Criteria

#### Automated Verification

- [ ] All planned documentation files created successfully
- [ ] Files saved to `docs/` with proper naming convention
- [ ] No file system errors during creation
- [ ] Cache updated with successful documentation patterns
- [ ] All required agents completed successfully

#### Manual Verification

- [ ] Documentation content is comprehensive and accurate
- [ ] Cross-references between documents are correct
- [ ] Documentation follows consistent formatting and style
- [ ] All essential project aspects are covered
- [ ] Documentation is appropriate for the project scope and complexity

## Documentation Templates

### Product Requirements Document Template

```markdown
---
title: <Project Name> - Product Requirements Document
type: prd
version: 1.0.0
date: 2025-09-20
status: draft
---

## 1. Product Vision & Mission

### Vision Statement

[Clear, compelling vision of what the product will achieve]

### Mission

[Specific mission statement defining the product's purpose]

### Value Proposition

- **Primary Value**: [Main benefit to users]
- **Secondary Values**: [Additional benefits]
- **Target Market**: [Intended users and use cases]

## 2. Target User Personas

### Primary Personas

#### **[Persona Name]**

- **Profile**: [Demographic and technical characteristics]
- **Pain Points**: [Problems this persona faces]
- **Goals**: [What this persona wants to achieve]
- **Use Cases**: [Specific scenarios where they use the product]

## 3. Functional Requirements

### Core Features

#### **FR-001: [Feature Name]**

- **Description**: [What the feature does]
- **Acceptance Criteria**:
  - [Specific, testable criteria]
  - [User-facing behavior requirements]
  - [Technical implementation requirements]
- **Priority**: P0 (Critical) | P1 (High) | P2 (Medium)

## 4. Non-Functional Requirements

### Performance Requirements

- **Response Time**: [Expected response times]
- **Scalability**: [User/system load requirements]
- **Reliability**: [Uptime and availability requirements]

### Security Requirements

- **Authentication**: [Auth requirements]
- **Authorization**: [Access control requirements]
- **Data Protection**: [Privacy and security requirements]

## 5. Success Metrics & KPIs

### User Adoption Metrics

- **Primary Metrics**: [Key success indicators]
- **Secondary Metrics**: [Supporting metrics]
- **Target Values**: [Specific numerical targets]

## 6. Constraints & Assumptions

### Technical Constraints

- **Platform Requirements**: [Supported platforms/browsers]
- **Integration Requirements**: [Third-party services needed]
- **Performance Constraints**: [Technical limitations]

### Business Constraints

- **Timeline**: [Development and launch timeline]
- **Budget**: [Resource constraints]
- **Compliance**: [Regulatory requirements]

## 7. Risk Assessment

### High Risk Items

- **[Risk 1]**: [Description and impact]
- **[Risk 2]**: [Description and impact]

### Mitigation Strategies

- **[Strategy 1]**: [How to address the risk]
- **[Strategy 2]**: [Alternative approaches]

## 8. Future Roadmap

### Phase 1: MVP

- [Core features for initial launch]
- [Essential functionality]
- [Basic user experience]

### Phase 2: Enhancement

- [Additional features]
- [Performance improvements]
- [Extended functionality]

### Phase 3: Scale

- [Enterprise features]
- [Advanced capabilities]
- [Market expansion]
```

### Security Documentation Template

```markdown
---
title: <Project Name> - Security Documentation
type: security
version: 1.0.0
date: 2025-09-20
---

## Security Overview

### Security Objectives

- **Confidentiality**: [Data protection goals]
- **Integrity**: [Data integrity requirements]
- **Availability**: [System availability requirements]

## Threat Model

### Identified Threats

#### **[Threat Category 1]**

- **Threat**: [Specific threat description]
- **Impact**: [Potential consequences]
- **Mitigation**: [Security controls in place]

#### **[Threat Category 2]**

- **Threat**: [Specific threat description]
- **Impact**: [Potential consequences]
- **Mitigation**: [Security controls in place]

## Security Controls

### Authentication & Authorization

- **Authentication Methods**: [Supported auth methods]
- **Authorization Model**: [Access control approach]
- **Session Management**: [Session handling]

### Data Protection

- **Encryption**: [Encryption methods and standards]
- **Data Classification**: [Data sensitivity levels]
- **Privacy Controls**: [Privacy protection measures]

### Network Security

- **Network Architecture**: [Network security design]
- **Firewall Rules**: [Network access controls]
- **TLS/SSL Configuration**: [Transport security]

## Compliance Requirements

### Regulatory Compliance

- **[Compliance Framework 1]**: [Requirements and status]
- **[Compliance Framework 2]**: [Requirements and status]

## Incident Response

### Incident Response Plan

- **Detection**: [How incidents are detected]
- **Response**: [Incident response procedures]
- **Recovery**: [Recovery and restoration procedures]
- **Communication**: [Stakeholder communication plan]

## Security Testing

### Security Testing Approach

- **Threat Modeling**: [Security testing methodology]
- **Penetration Testing**: [Penetration testing schedule]
- **Vulnerability Scanning**: [Scanning frequency and tools]
- **Code Review**: [Security code review process]

## Security Best Practices

### Development Practices

- **Secure Coding**: [Coding standards and practices]
- **Dependency Management**: [Third-party component security]
- **Configuration Management**: [Secure configuration practices]

### Operational Practices

- **Access Management**: [Access control procedures]
- **Monitoring**: [Security monitoring and alerting]
- **Backup**: [Backup and recovery procedures]
```

## Edge Cases

### Large Project Documentation

- Break complex projects into multiple focused documents
- Use modular approach with clear relationships between documents
- Consider creating overview document linking to detailed sections

### API-First Projects

- Prioritize API documentation and OpenAPI specifications
- Include detailed endpoint documentation with examples
- Focus on developer experience and SDK considerations

### Security-Critical Projects

- Emphasize security documentation and threat modeling
- Include detailed compliance and regulatory requirements
- Provide comprehensive security testing documentation

## Anti-Patterns

### Avoid These Practices

- **Incomplete Documentation**: Don't skip essential documentation types
- **Generic Content**: Don't use placeholder or vague descriptions
- **Outdated Information**: Don't include obsolete technical details
- **Inconsistent Formatting**: Don't mix different documentation styles
- **Missing Examples**: Don't document APIs without working examples

## Caching Guidelines

## Enhanced Subagent Orchestration for Project Documentation

### Comprehensive Project Documentation Workflow

For complete project documentation requiring multi-domain expertise and content specialization:

#### Phase 1: Project Analysis & Planning (Parallel)

- **codebase-locator**: Analyze existing project structure and components
- **research-locator**: Discover existing documentation and project knowledge
- **codebase-analyzer**: Understand project architecture and implementation
- **research-analyzer**: Review project history and decision documentation
- **system-architect**: Analyze overall system architecture and design

#### Phase 2: Core Documentation Generation (Sequential)

- **content-writer**: Primary agent for creating user-facing and business documentation
- **api-builder**: Generate comprehensive API documentation and specifications
- **database-expert**: Document data architecture and database design
- **security-scanner**: Create security documentation and threat models
- **compliance-expert**: Generate compliance and regulatory documentation

#### Phase 3: Technical Documentation Creation (Parallel)

- **performance-engineer**: Document performance requirements and architecture
- **infrastructure-builder**: Create infrastructure and deployment documentation
- **monitoring-expert**: Document monitoring and observability setup
- **devops-operations-specialist**: Generate operational runbooks and procedures
- **deployment-wizard**: Document deployment processes and CI/CD pipelines

#### Phase 4: Specialized Content Development (Parallel)

- **accessibility-pro**: Create accessibility guidelines and documentation
- **ux-optimizer**: Document user experience design and workflows
- **content-localization-coordinator**: Plan internationalization and localization
- **cost-optimizer**: Document cost optimization strategies and monitoring
- **growth-engineer**: Create growth and analytics documentation

#### Phase 5: Quality Assurance & Integration (Sequential)

- **code-reviewer**: Validate technical accuracy of all documentation
- **quality-testing-performance-tester**: Review performance and testing documentation
- **full-stack-developer**: Validate implementation documentation accuracy
- **research-analyzer**: Ensure documentation is integrated with knowledge base
- **content-writer**: Final content review and consistency validation

### Project Documentation Orchestration Best Practices

1. **Comprehensive Analysis**: Start with thorough project analysis using multiple discovery agents
2. **Domain Expertise**: Engage appropriate specialists for each documentation domain
3. **Content Consistency**: Use content-writer to ensure consistent voice and style
4. **Technical Validation**: Validate all technical content with domain experts
5. **Integration**: Ensure all documentation works together as a cohesive whole
6. **Maintenance Planning**: Include processes for keeping documentation current

### Documentation Completeness Gates

- **Business Documentation**: PRD, user stories, requirements, and business context
- **Technical Documentation**: Architecture, API specs, database design, infrastructure
- **Security Documentation**: Threat models, security controls, compliance requirements
- **Operational Documentation**: Deployment, monitoring, runbooks, troubleshooting
- **User Documentation**: User guides, API docs, tutorials, and examples
- **Development Documentation**: Setup guides, contribution guidelines, testing
- **Quality Assurance**: Testing strategies, performance benchmarks, validation procedures

### Documentation Optimization Strategies

- **Modular Structure**: Create reusable documentation components and templates
- **Version Control**: Document version-specific features and compatibility
- **Search Optimization**: Include comprehensive metadata and indexing
- **Interactive Elements**: Include code examples, diagrams, and interactive demos
- **Feedback Integration**: Establish processes for continuous documentation improvement
- **Multi-format Output**: Generate documentation in multiple formats (web, PDF, etc.)
- **Localization Ready**: Structure content for easy translation and localization

### Cache Usage Patterns

- **Project Templates**: Store successful documentation templates by project type
- **Structure Patterns**: Cache documentation organization patterns
- **Content Patterns**: Remember successful content for similar project types

### Cache Invalidation Triggers

- **Manual**: Clear cache when documentation standards change
- **Content-based**: Invalidate when project requirements change significantly
- **Time-based**: Refresh cache every 2 hours for active development

### Performance Optimization

- Cache hit rate target: ≥ 70% for repeated documentation patterns
- Memory usage: < 25MB for documentation template cache
- Response time: < 200ms for cache queries

{{prompt}}
