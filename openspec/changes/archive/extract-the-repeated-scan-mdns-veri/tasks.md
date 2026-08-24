# Tasks: Extract the repeated "scan mDNS + verify + dedup by name" pattern in packages/core/src/local-providers/ into a reusable discovery service in packages/core/src/discovery/index.ts.
<!-- default: #impl #L2 #m -->

---

## Phase 1 — Analysis

- [ ] 1. Understand the codebase and identify affected components
  - Read relevant source files and understand the current design
  - Validation: document findings in coder-context.md

## Phase 2 — Implementation

- [ ] 2. Implement the core change: Extract the repeated "scan mDNS + verify + dedup by name" pattern in packages/core/src/local-providers/ into a reusable discovery service in packages/core/src/discovery/index.ts.
  - Identify the right files to modify or create
  - Write code following existing patterns in the project
  - Validation: build or run the project and verify it works

## Phase 3 — Tests and Validation

- [ ] 3. Add tests for the new functionality
  - Write tests appropriate for the project's language and framework
  - Validation: all tests pass
