---
description: Perform Phase 0 Existing Project Analysis for OpenCode according to AI SDLC OS v1.1
---

# SDLC Phase 0: Existing Project Analysis Workflow

This workflow executes Phase 0 of the AI SDLC Operating System to analyze the existing OpenCode codebase.

1. **Architecture & Monorepo Structure Audit**
   - Check dependency direction across `packages/*`
   - Verify Effect TS generators and Schema definitions

2. **Quality & Test Coverage Check**
   - Verify unit test execution from package directories
   - Check test coverage and lint status

3. **Security & Secrets Check**
   - Check for sensitive keys, tokens, or security flaws in RPC handlers

4. **Technical Debt & Gap Identification**
   - Document any gaps, missing tests, or stale configurations in `PHASE_0_ANALYSIS.md`
