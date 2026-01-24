# Manual Fix Instructions for Issue #10346 (CRITICAL)

## File: `packages/opencode/src/cli/cmd/tui/context/local.tsx`

### Change 1: Fix unsafe array access at line 36-42

**BEFORE:**
```typescript
    const agent = iife(() => {
      const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const [agentStore, setAgentStore] = createStore<{
        current: string
      }>({
        current: agents()[0].name,
      })
```

**AFTER:**
```typescript
    const agent = iife(() => {
      const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const firstAgent = agents()[0]

      // Validate that at least one agent exists
      if (!firstAgent) {
        throw new Error(
          "No agents available. Please ensure at least one agent is enabled in your configuration.\n" +
          "Visit https://opencode.ai/docs/agents for more information."
        )
      }

      const [agentStore, setAgentStore] = createStore<{
        current: string
      }>({
        current: firstAgent.name,
      })
```

### Change 2: Fix unsafe find at line 56-58

**BEFORE:**
```typescript
        current() {
          return agents().find((x) => x.name === agentStore.current)!
        },
```

**AFTER:**
```typescript
        current() {
          const current = agents().find((x) => x.name === agentStore.current)
          // Fallback to first available agent if current not found
          return current ?? agents()[0] ?? (() => {
            throw new Error("No agents available in configuration")
          })()
        },
```

## Verification

After applying these changes, verify the fix works:

1. **Build the project:**
   ```bash
   bun run build
   ```

2. **Run TUI tests (if they exist):**
   ```bash
   bun test packages/opencode/test/cli/cmd/tui/context/local.test.tsx
   ```

3. **Test manually:**
   - Start opencode normally (should work fine)
   - Try with broken config (no agents) - should show helpful error instead of crash

## Rollback

If you need to rollback:
```bash
git checkout packages/opencode/src/cli/cmd/tui/context/local.tsx
```
