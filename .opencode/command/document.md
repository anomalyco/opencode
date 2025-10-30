---
name: document
mode: command
description: Produce high-quality documentation for implemented features
version: 2.0.0-internal
last_updated: 2025-09-13
command_schema_version: 1.0
inputs:
  - name: audience
    type: string
    required: true
    description: Target audience (user | api | developer | mixed)
  - name: plan
    type: string
    required: false
    description: Path to implementation plan file
  - name: files
    type: array
    required: true
    description: Key code files for documentation reference
  - name: changelog
    type: array
    required: false
    description: List of notable changes for documentation
outputs:
  - name: documentation_files
    type: structured
    format: JSON with file paths and metadata
    description: Generated documentation files with metadata
cache_strategy:
  type: agent_specific
  ttl: 3600
  invalidation: manual
  scope: command
success_signals:
  - 'Documentation files created successfully'
  - 'All audience types documented'
  - 'Files saved to docs/'
failure_modes:
  - 'Invalid audience specification'
  - 'Missing required code files'
  - 'Documentation directory not accessible'
---

# Document Feature

You are tasked with producing high-quality documentation based on the implemented feature, its plan, and the code. This command uses intelligent caching to optimize documentation generation and maintain consistency across similar features.

## Purpose

Deliver user-facing guides, API references, and developer notes that are accurate, comprehensive, and properly structured for the target audience.

## Inputs

- **audience**: Target audience type (user, api, developer, or mixed)
- **plan**: Optional path to implementation plan for context
- **files**: Array of key code files to reference for documentation
- **changelog**: Optional list of notable changes to document
- **conversation_context**: History of implementation decisions

## Preconditions

- Target audience is clearly specified and valid
- Required code files exist and are accessible
- Documentation directory `docs/` is writable
- Implementation is complete and testable

## Process Phases

### Phase 1: Context Analysis & Cache Check

1. **Check Cache First**: Query cache for similar documentation patterns using feature context hash
2. **Gather Context**: Read implementation plan and all specified code files
3. **Analyze Audience Requirements**: Determine documentation scope based on audience type
4. **Validate Inputs**: Ensure all required files exist and are readable

### Phase 2: Documentation Planning

1. **Determine Document Set**: Select appropriate documentation types for audience
2. **Create Structure Outline**: Plan documentation organization and sections
3. **Identify Key Information**: Extract important details from code and plan
4. **Plan Examples**: Determine what code examples and use cases to include

### Phase 3: Content Generation & Validation

1. **Generate Documentation**: Create content using appropriate templates
2. **Validate Accuracy**: Cross-check examples with actual code and outputs
3. **Ensure Completeness**: Verify all important aspects are documented
4. **Update Cache**: Store successful documentation patterns for future reference

## Error Handling

### Invalid Audience Error

```error-context
{
  "command": "document",
  "phase": "input_validation",
  "error_type": "invalid_audience",
  "expected": "user | api | developer | mixed",
  "found": "invalid_value",
  "mitigation": "Specify valid audience type",
  "requires_user_input": true
}
```

### Missing Files Error

```error-context
{
  "command": "document",
  "phase": "context_gathering",
  "error_type": "missing_files",
  "expected": "All specified files exist",
  "found": "File not found: path/to/missing/file.ts",
  "mitigation": "Verify file paths and ensure files exist",
  "requires_user_input": true
}
```

### Permission Error

```error-context
{
  "command": "document",
  "phase": "file_creation",
  "error_type": "permission_denied",
  "expected": "Write access to docs/",
  "found": "Permission denied",
  "mitigation": "Check directory permissions or use alternative location",
  "requires_user_input": true
}
```

## Structured Output Specification

### Primary Output

```command-output:documentation_files
{
  "status": "success|planning|error",
  "timestamp": "ISO-8601",
  "cache": {
    "hit": true|false,
    "key": "doc_pattern:{feature_hash}:{audience}",
    "ttl_remaining": 3600,
    "savings": 0.25
  },
  "analysis": {
    "audience": "user|api|developer|mixed",
    "feature_scope": "small|medium|large",
    "document_types": ["user_guide", "api_reference", "dev_notes"]
  },
  "files": [
    {
      "type": "user_guide",
      "path": "docs/2025-09-13-feature-user.md",
      "title": "Feature Name - User Guide",
      "sections": ["overview", "prerequisites", "steps", "troubleshooting"],
      "word_count": 450
    },
    {
      "type": "api_reference",
      "path": "docs/2025-09-13-feature-api.md",
      "title": "Feature Name - API Reference",
      "endpoints": 3,
      "examples": 5
    },
    {
      "type": "dev_notes",
      "path": "docs/2025-09-13-feature-dev.md",
      "title": "Feature Name - Developer Notes",
      "sections": ["architecture", "decisions", "extension_points"],
      "code_references": 8
    }
  ],
  "metadata": {
    "processing_time": 180,
    "cache_savings": 0.25,
    "total_files": 3,
    "total_words": 1200
  }
}
```

## Success Criteria

#### Automated Verification

- [ ] All specified audience types have corresponding documentation files
- [ ] Documentation files created in `docs/` directory
- [ ] File paths follow naming convention: `YYYY-MM-DD-<feature>-<type>.md`
- [ ] No file system errors during creation
- [ ] Cache updated with successful documentation patterns

#### Manual Verification

- [ ] Documentation content is accurate and matches code implementation
- [ ] Examples are functional and can be copied/pasted
- [ ] Documentation is well-structured and scannable
- [ ] Appropriate level of detail for target audience
- [ ] Cross-references between related documents are correct

## Documentation Templates

### User Guide Template

```markdown
---
title: <Feature Name> - User Guide
audience: user
version: <semver or commit>
---

## Overview

Short description of the value and when to use it.

## Prerequisites

- Required dependencies and setup steps

## Steps

1. Step-by-step instructions with clear actions
2. Include screenshots placeholders where helpful

## Troubleshooting

- Common issues and their solutions
- Error messages and what they mean
```

### API Reference Template

````markdown
---
title: <Feature Name> - API Reference
audience: api
version: <semver or commit>
---

## Endpoints / Commands

### Endpoint/Command Name

- **Method/Command**: HTTP method or CLI command
- **Path/Usage**: Endpoint path or command syntax
- **Request**: Input parameters and types
- **Response**: Output format and fields
- **Errors**: Error codes and messages

#### Example

```bash
curl -X POST /api/feature \
  -H "Content-Type: application/json" \
  -d '{"param": "value"}'
```
````

````

### Developer Notes Template

```markdown
---
title: <Feature Name> - Developer Notes
audience: developer
version: <semver or commit>
---

## Architecture

- High-level component overview
- Data flow and interactions
- Key design patterns used

## Key Decisions

- Important architectural choices
- Trade-offs and rationale
- Alternative approaches considered

## Extension Points

- How to safely modify behavior
- Plugin interfaces and hooks
- Configuration options
````

## Edge Cases

### Mixed Audience Documentation

- For mixed audiences, create separate files for each type
- Link between related documents
- Avoid mixing user and developer content in same file

### Large Feature Sets

- Break complex features into multiple focused documents
- Use table of contents and cross-references
- Consider creating overview document linking to details

### API-Only Features

- Focus on comprehensive endpoint documentation
- Include authentication and rate limiting details
- Provide SDK examples if applicable

## Anti-Patterns

### Avoid These Practices

- **Generic content**: Don't use placeholder text or vague descriptions
- **Code dumping**: Don't include large code blocks without explanation
- **Missing examples**: Don't document APIs without working examples
- **Cache bypass**: Don't skip cache checks for performance reasons

## Caching Guidelines

## Enhanced Subagent Orchestration for Documentation

### Comprehensive Documentation Workflow

For multi-audience documentation requiring domain expertise and content specialization:

#### Phase 1: Content Analysis & Planning (Parallel)

- **codebase-locator**: Identify all components and files requiring documentation
- **codebase-analyzer**: Understand implementation details for technical accuracy
- **research-analyzer**: Review existing documentation patterns and standards
- **codebase-pattern-finder**: Identify established documentation patterns
- **content-writer**: Primary agent for content creation and audience adaptation

#### Phase 2: Technical Documentation Generation (Sequential)

- **api-builder**: Generate API documentation and contract specifications
- **database-expert**: Document data models, schemas, and database interactions
- **system-architect**: Provide architectural context and design decisions
- **performance-engineer**: Document performance characteristics and limitations
- **security-scanner**: Include security considerations and best practices

#### Phase 3: Specialized Content Creation (Parallel)

- **accessibility-pro**: Create accessibility documentation and guidelines
- **compliance-expert**: Document regulatory compliance requirements and procedures
- **ux-optimizer**: Provide user experience documentation and workflows
- **content-localization-coordinator**: Plan internationalization and localization documentation
- **deployment-wizard**: Document deployment procedures and operational requirements

#### Phase 4: Content Review & Validation (Sequential)

- **code-reviewer**: Validate technical accuracy and code references
- **quality-testing-performance-tester**: Review performance-related documentation
- **monitoring-expert**: Validate monitoring and alerting documentation
- **full-stack-developer**: Confirm implementation details are accurately represented

#### Phase 5: Content Publishing & Maintenance (Parallel)

- **research-analyzer**: Update internal documentation and knowledge base
- **content-localization-coordinator**: Coordinate translation and localization efforts
- **devops-operations-specialist**: Document operational procedures and runbooks
- **infrastructure-builder**: Document infrastructure requirements and configurations

### Documentation Orchestration Best Practices

1. **Audience Analysis**: Use content-writer for audience-specific content adaptation
2. **Technical Accuracy**: Coordinate with domain experts for technical content validation
3. **Comprehensive Coverage**: Include all relevant technical and operational aspects
4. **Quality Validation**: Use code-reviewer and domain specialists for accuracy verification
5. **Maintenance Planning**: Establish processes for keeping documentation current

### Documentation Quality Gates

- **Technical Accuracy**: All code references and implementation details validated
- **Audience Appropriateness**: Content tailored for specified audience types
- **Completeness**: All features, APIs, and functionality documented
- **Consistency**: Documentation follows established patterns and standards
- **Accessibility**: Documentation accessible to all intended users
- **Maintenance**: Processes established for keeping documentation current

### Content Optimization Strategies

- **Modular Documentation**: Create reusable content components
- **Version Control**: Document version-specific features and changes
- **Search Optimization**: Include metadata and keywords for discoverability
- **Interactive Elements**: Include code examples, tutorials, and interactive demos
- **Feedback Integration**: Establish processes for documentation improvement
- **Localization Planning**: Plan for international audience requirements

### Cache Usage Patterns

- **Template caching**: Store successful documentation templates by audience type
- **Structure patterns**: Cache outline structures for similar feature types
- **Example repositories**: Remember successful code examples for reuse

### Cache Invalidation Triggers

- **Manual**: Clear cache when documentation standards change
- **Content-based**: Invalidate when feature implementation changes significantly
- **Time-based**: Refresh cache every hour for active development

### Performance Optimization

- Cache hit rate target: ≥ 60% for repeated documentation patterns
- Memory usage: < 15MB for documentation template cache
- Response time: < 100ms for cache queries

{{audience}}
