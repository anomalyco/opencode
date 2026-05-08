<!-- Context: openagents-repo/examples | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Context Bundle Example: Create Data Analyst Agent

Session: 20250121-143022-a4f2
Created: 2025-01-21T14:30:22Z
For: TaskManager
Status: in_progress

## Task Overview

Create a new data analyst agent for the OpenAgents Control repository. This agent will specialize in data analysis tasks including data visualization, statistical analysis, and data transformation.

## User Request

"Create a new data analyst agent that can help with data analysis, visualization, and statistical tasks"

## Relevant Standards (Load These Before Starting)

**Core Standards**:
- `/Users/apple/.config/opencode/context/core/standards/code-quality.md` → Modular, functional code patterns
- `/Users/apple/.config/opencode/context/core/standards/test-coverage.md` → Testing requirements and TDD
- `/Users/apple/.config/opencode/context/core/standards/documentation.md` → Documentation standards

**Core Workflows**:
- `/Users/apple/.config/opencode/context/core/workflows/feature-breakdown.md` → Task breakdown methodology

## Repository-Specific Context (Load These Before Starting)

**Quick Start** (ALWAYS load first):
- `/Users/apple/.config/opencode/context/openagents-repo/quick-start.md` → Repo orientation and common commands

**Core Concepts** (Load based on task type):
- `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/agents.md` → How agents work
- `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/evals.md` → How testing works
- `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/registry.md` → How registry works
- `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/categories.md` → How organization works

**Guides** (Load for specific workflows):
- `/Users/apple/.config/opencode/context/openagents-repo/guides/adding-agent-basics.md` → Step-by-step agent creation
- `/Users/apple/.config/opencode/context/openagents-repo/guides/testing-agent.md` → Testing workflow
- `/Users/apple/.config/opencode/context/openagents-repo/guides/updating-registry.md` → Registry workflow

## Key Requirements

**From Standards**:
- Agent must follow modular, functional programming patterns
- All code must be testable and maintainable
- Documentation must be concise and high-signal
- Include examples where helpful

**From Repository Context**:
- Agent file must be in `.opencode/agent/data/` directory (category-based organization)
- Must include proper frontmatter metadata (id, name, description, category, type, version, etc.)
- Must follow naming convention: `data-analyst.md` (kebab-case)
- Must include tags for discoverability
- Must specify tools and permissions
- Must be registered in `registry.json`

**Naming Conventions**:
- File name: `data-analyst.md` (kebab-case)
- Agent ID: `data-analyst`
- Category: `data`
- Type: `agent`

**File Structure**:
- Agent file: `.opencode/agent/data/data-analyst.md`
- Eval directory: `evals/agents/data/data-analyst/`
- Eval config: `evals/agents/data/data-analyst/config/eval-config.yaml`
- Eval tests: `evals/agents/data/data-analyst/tests/`
- README: `evals/agents/data/data-analyst/README.md`

## Technical Constraints

- Must use category-based organization (data category)
- Must include proper frontmatter metadata
- Must specify tools needed (read, write, bash, etc.)
- Must define permissions for sensitive operations
- Must include temperature setting (0.1-0.3 for analytical tasks)
- Must follow agent prompt structure (context, role, task, instructions)
- Eval tests must use YAML format
- Registry entry must follow schema

## Files to Create/Modify

**Create**:
- `.opencode/agent/data/data-analyst.md` - Main agent definition with frontmatter and prompt
- `evals/agents/data/data-analyst/config/eval-config.yaml` - Eval configuration
- `evals/agents/data/data-analyst/tests/smoke-test.yaml` - Basic smoke test
- `evals/agents/data/data-analyst/tests/data-analysis-test.yaml` - Data analysis capability test
- `evals/agents/data/data-analyst/README.md` - Agent documentation

**Modify**:
- `registry.json` - Add data-analyst agent entry
- `/Users/apple/.config/opencode/context/navigation.md` - Add data category context if needed

## Success Criteria

- [x] Agent file created with proper frontmatter metadata
- [x] Agent prompt follows established patterns (context, role, task, instructions)
- [x] Eval test structure created with config and tests
- [x] Smoke test passes
- [x] Data analysis test passes
- [x] Registry entry added and validates
- [x] README documentation created
- [x] All validation scripts pass

## Validation Requirements

**Scripts to Run**:
- `./scripts/registry/validate-registry.sh` - Validates registry.json schema and entries
- `./scripts/validation/validate-test-suites.sh` - Validates eval test structure

**Tests to Run**:
- `cd evals/framework && npm run eval:sdk -- --agent=data/data-analyst --pattern="smoke-test.yaml"` - Run smoke test
- `cd evals/framework && npm run eval:sdk -- --agent=data/data-analyst` - Run all tests

**Manual Checks**:
- Verify frontmatter includes all required fields
- Check that tools and permissions are appropriate
- Ensure prompt is clear and follows standards
- Verify eval tests are meaningful

## Expected Output

**Deliverables**:
- Functional data analyst agent
- Complete eval test suite
- Registry entry
- Documentation

**Format**:
- Agent file: Markdown with YAML frontmatter
- Eval config: YAML format
- Eval tests: YAML format with test cases
- README: Markdown documentation

## Progress Tracking

- [ ] Context loaded and understood
- [ ] Agent file created with frontmatter
- [ ] Agent prompt written
- [ ] Eval directory structure created
- [ ] Eval config created
- [ ] Smoke test created
- [ ] Data analysis test created
- [ ] README documentation created
- [ ] Registry entry added
- [ ] Validation scripts run
- [ ] All tests pass
- [ ] Documentation updated

---

## Instructions for Subagent

**IMPORTANT**: 
1. Load ALL context files listed in "Relevant Standards" and "Repository-Specific Context" sections BEFORE starting work
2. Follow ALL requirements from the loaded context
3. Apply naming conventions and file structure requirements
4. Validate your work using the validation requirements
5. Update progress tracking as you complete steps

**Your Task**:
Create a complete data analyst agent for the OpenAgents Control repository following all established conventions and standards.

**Approach**:
1. **Load Context**: Read all context files listed above to understand:
   - How agents are structured (core-concepts/agents.md)
   - How to add an agent (guides/adding-agent-basics.md)
   - Code standards (standards/code-quality.md)
   - Testing requirements (core-concepts/evals.md)

2. **Create Agent File**:
   - Create `.opencode/agent/data/data-analyst.md`
   - Add frontmatter with all required metadata
   - Write agent prompt with:
     - Context section (system, domain, task, execution context)
     - Role definition
     - Task description
     - Instructions and workflow
     - Tools and capabilities
     - Examples if helpful

3. **Create Eval Structure**:
   - Create directory: `evals/agents/data/data-analyst/`
   - Create config: `config/eval-config.yaml`
   - Create tests directory: `tests/`
   - Create smoke test: `tests/smoke-test.yaml`
   - Create capability test: `tests/data-analysis-test.yaml`
   - Create README: `README.md`

4. **Update Registry**:
   - Add entry to `registry.json` following schema
   - Include: id, name, description, category, type, path, version, tags

5. **Validate**:
   - Run validation scripts
   - Run eval tests
   - Fix any issues

**Constraints**:
- Agent must be in `data` category
- Must follow functional programming patterns
- Must include proper error handling
- Must specify appropriate tools (read, write, bash for data tasks)
- Temperature should be 0.1-0.3 for analytical precision
- Eval tests must be meaningful and test actual capabilities

**Questions/Clarifications**:
- What specific data analysis capabilities should be emphasized? (visualization, statistics, transformation)
- Should the agent support specific data formats? (CSV, JSON, Parquet)
- Should the agent integrate with specific tools? (pandas, matplotlib, etc.)
- What level of statistical analysis? (descriptive, inferential, predictive)

**Note**: This is an example context bundle. In practice, the subagent would receive this file and follow the instructions to complete the task.
