# BMM Module Data

This directory contains module-specific data files used by BMM agents and workflows.

## Files

### `project-context-template.md`

Template for project-specific brainstorming context. Used by:

- Analyst agent `brainstorm-project` command
- Core brainstorming workflow when called with context

### `documentation-standards.md`

BMAD documentation standards and guidelines. Used by:

- Tech Writer agent (critical action loading)
- Various documentation workflows
- Standards validation and review processes

## Purpose

Separates module-specific data from core workflow implementations, maintaining clean architecture:

- Core workflows remain generic and reusable
- Module-specific templates and standards are properly scoped
- Data files can be easily maintained and updated
- Clear separation of concerns between core and module functionality
