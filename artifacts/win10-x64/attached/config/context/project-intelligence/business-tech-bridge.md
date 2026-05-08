<!-- Context: project-intelligence/bridge | Priority: high | Version: 1.0 | Updated: 2025-01-12 -->

# Business ↔ Tech Bridge

> Document how business needs translate to technical solutions. This is the critical connection point.

## Quick Reference

- **Purpose**: Show stakeholders technical choices serve business goals
- **Purpose**: Show developers business constraints drive architecture
- **Update When**: New features, refactoring, business pivot

## Core Mapping

| Business Need | Technical Solution | Why This Mapping | Business Value |
|---------------|-------------------|------------------|----------------|
| [Users need X] | [Technical implementation] | [Why this maps] | [Value delivered] |
| [Business wants Y] | [Technical implementation] | [Why this maps] | [Value delivered] |
| [Compliance requires Z] | [Technical implementation] | [Why this maps] | [Value delivered] |

## Feature Mapping Examples

### Feature: [Feature Name]

**Business Context**:
- User need: [What users need]
- Business goal: [Why this matters to business]
- Priority: [Why this was prioritized]

**Technical Implementation**:
- Solution: [What was built]
- Architecture: [How it fits the system]
- Trade-offs: [What was considered and why it won]

**Connection**:
[Explain clearly how the technical solution serves the business need. What would happen without this feature? What does this feature enable for the business?]

### Feature: [Feature Name]

**Business Context**:
- User need: [What users need]
- Business goal: [Why this matters to business]
- Priority: [Why this was prioritized]

**Technical Implementation**:
- Solution: [What was built]
- Architecture: [How it fits the system]
- Trade-offs: [What was considered and why it won]

**Connection**:
[Explain clearly how the technical solution serves the business need.]

## Trade-off Decisions

When business and technical needs conflict, document the trade-off:

| Situation | Business Priority | Technical Priority | Decision Made | Rationale |
|-----------|-------------------|-------------------|---------------|-----------|
| [Conflict] | [What business wants] | [What tech wants] | [What was chosen] | [Why this was right] |

## Common Misalignments

| Misalignment | Warning Signs | Resolution Approach |
|--------------|---------------|---------------------|
| [Type of mismatch] | [Symptoms to watch for] | [How to address] |

## Stakeholder Communication

This file helps translate between worlds:

**For Business Stakeholders**:
- Shows that technical investments serve business goals
- Provides context for why certain choices were made
- Demonstrates ROI of technical decisions

**For Technical Stakeholders**:
- Provides business context for architectural decisions
- Shows the "why" behind constraints and requirements
- Helps prioritize technical debt with business impact

## Onboarding Checklist

- [ ] Understand the core business needs this project addresses
- [ ] See how each major feature maps to business value
- [ ] Know the key trade-offs and why decisions were made
- [ ] Be able to explain to stakeholders why technical choices matter
- [ ] Be able to explain to developers why business constraints exist

## Related Files

- `business-domain.md` - Business needs in detail
- `technical-domain.md` - Technical implementation in detail
- `decisions-log.md` - Decisions made with full context
- `living-notes.md` - Current open questions and issues
