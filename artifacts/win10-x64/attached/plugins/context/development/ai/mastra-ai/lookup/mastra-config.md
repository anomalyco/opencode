<!-- Context: development/mastra-config | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Lookup: Mastra Configuration

**Purpose**: Quick reference for Mastra file locations and registration.

**Last Updated**: 2026-01-09

---

## File Locations

| Component | Directory | Registration File |
|-----------|-----------|-------------------|
| **Mastra Instance** | `src/mastra/` | `src/mastra/index.ts` |
| **Agents** | `src/mastra/agents/` | `src/mastra/index.ts` |
| **Tools** | `src/mastra/tools/` | `src/mastra/index.ts` |
| **Workflows** | `src/mastra/workflows/` | `src/mastra/index.ts` |
| **Scorers** | `src/mastra/scorers/` | `src/mastra/index.ts` |
| **Services** | `src/services/` | `src/mastra/shared.ts` |

## Database Tables

| Table Name | Description |
|------------|-------------|
| `mastra_traces` | Workflow execution traces |
| `mastra_ai_spans` | LLM call spans and token usage |
| `mastra_scorers` | Evaluation results and scores |
| `mastra_workflow_state` | Current state of running workflows |

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Mastra in development mode |
| `npm run traces` | View recent execution traces |
| `npm run test:workflow` | Run the test workflow script |

**Related**:
- concepts/core.md
- concepts/workflows.md
