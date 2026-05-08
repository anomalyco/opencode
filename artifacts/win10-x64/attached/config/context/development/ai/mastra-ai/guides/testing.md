<!-- Context: development/testing | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Testing Mastra

**Purpose**: How to run and validate Mastra components in this project.

**Last Updated**: 2026-01-09

---

## Core Idea
Testing in this project is divided into tool-level tests and full workflow integration tests. Use the provided npm scripts for rapid validation.

## Key Points
- **Tool Tests**: Validate individual tools in isolation (e.g., `npm run test:playbook`).
- **Workflow Tests**: Run full end-to-end scenarios (e.g., `npm run test:workflow`).
- **Baseline Tests**: Compare current performance against a known baseline (`npm run test:baseline`).
- **Observability**: Use `npm run traces` after tests to inspect the execution details in the database.

## Quick Example
```bash
# Test a specific tool
npm run test:calculator

# Run full validity workflow
npm run validity:workflow

# View results of the last run
npm run traces
```

**Reference**: `package.json` scripts, `scripts/` directory
**Related**:
- concepts/core.md
- lookup/mastra-config.md
