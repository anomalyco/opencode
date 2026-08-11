# Tasks: Refactor context management to introduce a named abstraction for consistency and modularity.

## Phase 1: Design the Core Change

### Tasks
- [x] 1.1. Update the architecture diagram to reflect the new context abstraction.
  - Validation: `git diff packages/console/app/src/asset/architecture.svg`
- [x] 1.2. Create a new interface for context management in the `ContextManager` module.
  - Validation: `cat packages/core/src/context/context_manager.ts`
- [x] 1.3. Define the new `Context` class and its properties.
  - Validation: `cat packages/core/src/context/context.ts`

## Phase 2: Implement the Core Change

### Tasks
- [x] 2.1. Implement the `Context` class with necessary properties.
  - Validation: `cat packages/core/src/context/context.ts`
- [x] 2.2. Update the `ContextManager` to use the new `Context` class.
  - Validation: `cat packages/core/src/context/context_manager.ts`
- [ ] 2.3. Refactor existing code to use the new Context class. Refactor existing code to use the new `Context` class.
  - Validation: `git diff packages/core/src/context`

## Phase 3: Add Tests

### Tasks
- [x] 3.1. Create unit tests for the `Context` class.
  - Validation: `npm test packages/core/src/context`
- [ ] 3.2. Update existing integration tests to use the new Context class. Update existing integration tests to use the new `Context` class.
  - Validation: `npm test packages/core/test`
- [x] 3.3. Ensure all tests cover the new functionality.
  - Validation: `npm test`

## Phase 4: Update Documentation

### Tasks
- [x] 4.1. Document the new `Context` class and its usage.
  - Validation: `git diff README.md`
- [x] 4.2. Update the architecture documentation to reflect the new context abstraction.
  - Validation: `git diff packages/console/app/src/asset/architecture.svg`
- [x] 4.3. Ensure all documentation is consistent with the new design.
  - Validation: `git diff docs`