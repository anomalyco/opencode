# Task Completion Checklist

## Before Completing Any Task

### Code Quality
- [ ] Run `bun turbo typecheck` to ensure no TypeScript errors
- [ ] Run `bun test` (or `bun turbo test`) to ensure tests pass
- [ ] Check if linting is available and run it
- [ ] Format code with Prettier if needed

### Code Review
- [ ] Follow code conventions (no unnecessary destructuring, avoid else statements, etc.)
- [ ] Avoid `any` types
- [ ] Use single-word variable names where appropriate
- [ ] Prefer Bun APIs like `Bun.file()`
- [ ] Keep functions focused and composable

### Testing
- [ ] Add tests for new functionality if applicable
- [ ] Ensure existing tests still pass
- [ ] Test edge cases and error conditions

### Documentation
- [ ] Update relevant documentation if API changes were made
- [ ] Add comments for complex logic (but keep them minimal)
- [ ] Update README files if needed

### Git Readiness
- [ ] Review changes with `git diff`
- [ ] Ensure no sensitive data is committed
- [ ] Check that changes are focused and minimal

## Special Cases

### Core Server Changes
- [ ] If `packages/opencode/src/server/server.ts` was modified, notify OpenCode team for SDK regeneration

### Plugin Changes
- [ ] Test plugin functionality
- [ ] Ensure plugin API compatibility

### LSP/Formatter Changes
- [ ] Test with multiple file types
- [ ] Verify integration works correctly

### UI Changes
- [ ] Test in terminal environment
- [ ] Verify responsive behavior if applicable
- [ ] Check accessibility if relevant

## Commands to Run
```bash
# Always run these before considering a task complete
bun turbo typecheck
bun test

# Check if these exist and run them
bun run lint    # if available
bun run format   # if available
```