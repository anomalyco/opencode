# Testing the Plugin UI System

## What Was Changed

1. **opencode.json**: Added `./examples/plugin-sidebar-context` to plugins array
2. **sidebar.tsx**: Replaced hardcoded Context section (lines 450-472) with:
   ```tsx
   <PluginComponent
     componentId="context-panel"
     context={{ sessionID: props.sessionID, theme }}
     fallback="Loading context..."
   />
   ```

## To Test

1. Start OpenCode:
   ```bash
   cd packages/opencode
   bun dev
   ```

2. Open a session (create a new one or resume existing)

3. Look at the sidebar - the Context section should now be rendered by the plugin!

## What You Should See

**SAME UI** as before:
- "Context" heading
- Token usage bar (colored segments)
- "X,XXX tokens"
- "XX% used"  
- "$X.XX spent"

## Behind the Scenes

- Plugin loads from `examples/plugin-sidebar-context/`
- Registers as `context-panel` component
- Fetches session data via SDK client
- Renders JSX component with Solid.js reactivity
- Subscribes to `session.updated` and `context.updated` events
- Auto-refreshes when events fire

## Verification

Run the test script to verify plugin loads:
```bash
bun test-plugin-load.ts
```

Should output:
```
✅ Loaded 4 plugins
✅ Found 2 panels:
  - context-panel: Context (left)
✨ Plugin system is working!
```

## Rollback if Needed

If something breaks:
1. Revert `sidebar.tsx` changes (restore ContextUsageBar)
2. Remove plugin from `opencode.json`
3. Rebuild: `bun run build`
