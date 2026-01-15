# Quick Start: MCP Connectors Implementation

**Feature**: 004-mcp-connectors
**Date**: 2026-01-15
**For**: Developers implementing the MCP Connectors feature

## Overview

This guide provides a quick walkthrough for implementing the MCP Connectors management feature. Follow the steps in order for a smooth implementation.

---

## Prerequisites

Before starting implementation:

- ✅ Read [spec.md](spec.md) - Understand user requirements
- ✅ Read [research.md](research.md) - Understand technical decisions
- ✅ Read [data-model.md](data-model.md) - Understand data structures
- ✅ Review [contracts/](contracts/) - Understand API contracts

**Estimated Time**: 2-3 development sessions (~8-12 hours total)

---

## Implementation Phases

### Phase 1: Data Layer (Priority: P1)

**Goal**: Create the McpConnectorsContext for state management

**Files to Create**:
1. `packages/app/src/types/mcp-connectors.ts`
2. `packages/app/src/context/mcp-connectors.tsx`

**Steps**:

1. **Define TypeScript types** (`types/mcp-connectors.ts`):
   ```typescript
   export interface McpServer {
     command: string;
     args?: string[];
     env?: Record<string, string>;
   }

   export interface McpConfig {
     inputs?: Array<{ type: string }>;
     servers: Record<string, McpServer>;
   }
   ```

2. **Create context provider** (`context/mcp-connectors.tsx`):
   ```typescript
   import { createSimpleContext } from '@/utils/context'
   import { createStore } from 'solid-js/store'
   import { useSDK } from './sdk'

   export const { use: useMcpConnectors, provider: McpConnectorsProvider } =
     createSimpleContext({
       name: 'McpConnectors',
       init: () => {
         const sdk = useSDK()
         const [config, setConfig] = createStore<McpConfig>({ servers: {} })
         const [isLoading, setIsLoading] = createSignal(false)

         // Implement methods: addServer, updateServer, removeServer, etc.
         // See contracts/mcp-connectors-context-api.ts for full API

         return { config, isLoading, addServer, ... }
       }
     })
   ```

3. **Add file I/O operations**:
   - `reload()`: Read `.mcp.json` using `sdk.client.file.read()`
   - `save()`: Write `.mcp.json` using `sdk.client.file.write()`
   - Handle missing file: Auto-create default config

4. **Add validation**:
   ```typescript
   import { z } from 'zod'

   const McpServerSchema = z.object({
     command: z.string().min(1),
     args: z.array(z.string()).optional(),
     env: z.record(z.string()).optional(),
   })
   ```

5. **Wire up provider in app** (`pages/directory-layout.tsx`):
   ```typescript
   <McpConnectorsProvider>
     {/* existing providers */}
   </McpConnectorsProvider>
   ```

**Testing**:
- Unit test: Validation logic
- Integration test: File read/write operations
- Test edge cases: Missing file, invalid JSON

**Time Estimate**: 3-4 hours

---

### Phase 2: UI Components (Priority: P1)

**Goal**: Create the Connectors section UI

**Files to Create**:
1. `packages/app/src/components/mcp-connectors-section.tsx`
2. `packages/app/src/components/mcp-connector-item.tsx`
3. `packages/app/src/components/mcp-connector-form.tsx`

**Steps**:

1. **Create section component** (`mcp-connectors-section.tsx`):
   ```tsx
   import { Collapsible } from '@/ui/components/collapsible'
   import { useMcpConnectors } from '@/context/mcp-connectors'

   export function McpConnectorsSection() {
     const connectors = useMcpConnectors()

     return (
       <div class="border-t border-border-weak-base">
         <Collapsible variant="ghost" defaultOpen>
           <Collapsible.Trigger>
             <span>Connectors ({connectors.getServerCount()})</span>
           </Collapsible.Trigger>
           <Collapsible.Content>
             {/* List of connectors */}
           </Collapsible.Content>
         </Collapsible>
       </div>
     )
   }
   ```

2. **Create item component** (`mcp-connector-item.tsx`):
   ```tsx
   export function McpConnectorItem(props: McpConnectorItemProps) {
     return (
       <div class="flex items-center justify-between px-2 py-1">
         <div>
           <div class="font-medium">{props.name}</div>
           <div class="text-sm text-muted">{props.server.command}</div>
         </div>
         <div class="flex gap-1">
           <IconButton onClick={() => props.onEdit?.(props.name)}>
             <EditIcon />
           </IconButton>
           <IconButton onClick={() => props.onRemove?.(props.name)}>
             <TrashIcon />
           </IconButton>
         </div>
       </div>
     )
   }
   ```

3. **Create form dialog** (`mcp-connector-form.tsx`):
   ```tsx
   import { Dialog } from '@/ui/components/dialog'
   import { TextField } from '@/ui/components/text-field'

   export function McpConnectorForm(props: McpConnectorFormProps) {
     const [formData, setFormData] = createSignal<ConnectorFormData>({
       name: props.initialData?.name || '',
       command: props.initialData?.command || '',
       args: props.initialData?.args || [],
       env: props.initialData?.env || {}
     })

     const handleSubmit = (e: Event) => {
       e.preventDefault()
       props.onSubmit(formData())
     }

     return (
       <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
         <Dialog.Content>
           <Dialog.Header>
             <Dialog.Title>
               {props.mode === 'add' ? 'Add Connector' : 'Edit Connector'}
             </Dialog.Title>
           </Dialog.Header>

           <form onSubmit={handleSubmit}>
             <TextField label="Server Name" value={formData().name} />
             <TextField label="Command" value={formData().command} />
             {/* Args and Env inputs */}
           </form>
         </Dialog.Content>
       </Dialog>
     )
   }
   ```

4. **Add to layout** (`pages/session.tsx`):
   ```tsx
   <div class="flex h-full">
     {/* Main content */}
     <div class="w-80 flex flex-col border-l">
       <McpConnectorsSection />
     </div>
   </div>
   ```

**Reference Components**:
- See `file-activity-section.tsx` for list pattern
- See `workspace-sidebar.tsx` for panel layout
- Use `@kobalte/core` components for accessibility

**Time Estimate**: 4-5 hours

---

### Phase 3: Layout Integration (Priority: P1)

**Goal**: Add Connectors panel to layout store

**Files to Modify**:
1. `packages/app/src/context/layout.tsx`

**Steps**:

1. **Add to layout store**:
   ```typescript
   const layoutStore = createStore({
     // ... existing properties ...
     connectors: {
       opened: true,
       collapsed: false
     }
   })
   ```

2. **Add methods**:
   ```typescript
   setConnectorsOpened(opened: boolean) {
     setLayout('connectors', 'opened', opened)
   },

   toggleConnectors() {
     setLayout('connectors', 'opened', prev => !prev)
   }
   ```

3. **Wire up in UI**:
   ```tsx
   <Show when={layout.connectors.opened()}>
     <McpConnectorsSection />
   </Show>
   ```

**Time Estimate**: 1 hour

---

### Phase 4: File Watcher (Priority: P2)

**Goal**: Detect external changes to `.mcp.json`

**Files to Modify**:
1. `packages/app/src/context/mcp-connectors.tsx`

**Steps**:

1. **Add file watcher** (in context init):
   ```typescript
   import { watch } from '@tauri-apps/plugin-fs'

   onMount(async () => {
     const unwatch = await watch('.mcp.json', (event) => {
       if (event.type === 'modify') {
         handleExternalChange()
       }
     })

     onCleanup(() => unwatch())
   })
   ```

2. **Handle external changes**:
   ```typescript
   const handleExternalChange = async () => {
     if (hasUnsavedChanges()) {
       // Show confirmation dialog
       const shouldReload = await showConfirm(
         'File changed externally. Reload?'
       )
       if (shouldReload) {
         await reload(true)
       }
     } else {
       // Silent reload
       await reload()
     }
   }
   ```

**Time Estimate**: 2 hours

---

### Phase 5: Testing & Polish (Priority: P1)

**Goal**: Ensure quality and edge case handling

**Tasks**:

1. **Unit Tests**:
   - ✅ Validation logic (valid/invalid configs)
   - ✅ State transitions (add/edit/remove)
   - ✅ Duplicate name detection

2. **Integration Tests**:
   - ✅ File read (existing, missing, corrupted)
   - ✅ File write (success, permission denied)
   - ✅ File watch (external modifications)

3. **E2E Tests** (optional):
   - ✅ Add connector flow
   - ✅ Edit connector flow
   - ✅ Remove connector flow

4. **Manual Testing Checklist**:
   - ✅ Open app with no `.mcp.json` (auto-create)
   - ✅ Open app with existing `.mcp.json` (load correctly)
   - ✅ Add new connector (saves to file)
   - ✅ Edit connector (updates file)
   - ✅ Remove connector (deletes from file)
   - ✅ Invalid JSON in file (shows error)
   - ✅ External file change (prompts reload)
   - ✅ Sensitive env var warning (shows 🔒 icon)

**Time Estimate**: 2-3 hours

---

## Optional Features (P3-P4)

### Inputs Editor (P4 - Advanced)

**Goal**: Allow editing the `inputs` array

**Approach**:
1. Add "Advanced Settings" section in ConnectorsSection
2. Show inputs as read-only JSON initially
3. Provide "Edit JSON" button for raw editing
4. Use JSON editor component with validation

**Time Estimate**: 2-3 hours

---

## File Structure Summary

```
packages/app/src/
├── types/
│   └── mcp-connectors.ts             # NEW (50 LOC)
├── context/
│   ├── mcp-connectors.tsx            # NEW (300 LOC)
│   └── layout.tsx                    # MODIFY (+20 LOC)
├── components/
│   ├── mcp-connectors-section.tsx    # NEW (200 LOC)
│   ├── mcp-connector-item.tsx        # NEW (80 LOC)
│   └── mcp-connector-form.tsx        # NEW (200 LOC)
└── pages/
    ├── session.tsx                   # MODIFY (+5 LOC)
    └── directory-layout.tsx          # MODIFY (+5 LOC)

tests/
├── unit/
│   └── mcp-connectors.test.ts        # NEW (150 LOC)
└── integration/
    └── mcp-connectors-file.test.ts   # NEW (100 LOC)
```

**Total**: ~1,110 new lines of code

---

## Common Pitfalls to Avoid

### 1. File I/O Errors

**Problem**: File read/write can fail (permissions, disk full, etc.)

**Solution**: Always use try-catch and show user-friendly errors
```typescript
try {
  await sdk.client.file.write({ path: '.mcp.json', content: json })
} catch (error) {
  showToast('Failed to save: ' + error.message, 'error')
}
```

### 2. Validation Before Save

**Problem**: Saving invalid JSON corrupts the file

**Solution**: Validate before write
```typescript
const result = validateConfig(config)
if (!result.success) {
  throw new Error('Invalid config')
}
await save()
```

### 3. Race Conditions with File Watcher

**Problem**: File watcher triggers while saving

**Solution**: Debounce watcher events
```typescript
const debouncedReload = debounce(reload, 500)
```

### 4. Form State Management

**Problem**: Losing form data on dialog close

**Solution**: Keep form data in signal until submit
```typescript
const [formData, setFormData] = createSignal(initialData)
// Don't reset on dialog open, only on submit success
```

### 5. Solid.js Reactivity

**Problem**: Mutating store directly doesn't trigger updates

**Solution**: Use `setStore` API
```typescript
// ❌ Wrong
config.servers[name] = newServer

// ✅ Correct
setConfig('servers', name, newServer)
```

---

## Debugging Tips

### 1. File Operations

**Log file path and content**:
```typescript
console.log('Reading:', mcpJsonPath)
console.log('Content:', await sdk.client.file.read({ path: mcpJsonPath }))
```

### 2. State Changes

**Use Solid DevTools**:
```typescript
import { DEV } from 'solid-js'

if (DEV) {
  createEffect(() => {
    console.log('Config changed:', config)
  })
}
```

### 3. Validation Errors

**Log Zod errors**:
```typescript
const result = schema.safeParse(data)
if (!result.success) {
  console.error('Validation errors:', result.error.flatten())
}
```

---

## Performance Optimization

### 1. Debounce Auto-Save

```typescript
import { debounce } from '@solid-primitives/scheduled'

const debouncedSave = debounce(save, 500)

createEffect(() => {
  if (hasUnsavedChanges()) {
    debouncedSave()
  }
})
```

### 2. Memoize Expensive Computations

```typescript
import { createMemo } from 'solid-js'

const serverNames = createMemo(() => Object.keys(config.servers))
```

### 3. Virtualize Long Lists (if needed)

```typescript
// Only if >100 connectors (unlikely)
import { VirtualList } from '@solid-primitives/virtual'
```

---

## Code Review Checklist

Before submitting PR:

- ✅ All TypeScript types defined (no `any`)
- ✅ All validation errors have user-friendly messages
- ✅ All file operations have error handling
- ✅ All components follow existing patterns (FileActivitySection, etc.)
- ✅ All UI uses @kobalte components for accessibility
- ✅ All tests pass (unit + integration)
- ✅ Manual testing checklist completed
- ✅ No console errors in dev mode
- ✅ Code formatted with prettier
- ✅ No lint warnings

---

## Resources

**Code References**:
- File operations: `packages/app/src/context/local.tsx`
- Context pattern: `packages/app/src/context/file-activity.tsx`
- Panel layout: `packages/app/src/context/layout.tsx`
- List component: `packages/app/src/components/file-activity-section.tsx`
- Dialog forms: `packages/ui/src/components/dialog.tsx`

**Documentation**:
- Solid.js: https://www.solidjs.com/docs/latest
- @kobalte/core: https://kobalte.dev/docs/core
- Tauri File System: https://v2.tauri.app/plugin/file-system/
- Zod Validation: https://zod.dev

**Project Docs**:
- [spec.md](spec.md) - Feature specification
- [research.md](research.md) - Technical decisions
- [data-model.md](data-model.md) - Data structures
- [contracts/](contracts/) - API contracts

---

## Next Steps

After implementation:

1. **Create Tasks**: Run `/speckit.tasks` to generate detailed implementation tasks
2. **Implementation**: Follow the tasks in order
3. **Testing**: Write tests as you go (TDD if following constitution)
4. **Code Review**: Submit PR with completed checklist
5. **User Testing**: Validate against acceptance scenarios in spec.md

---

**Good luck with the implementation!** 🚀

If you get stuck, refer back to the research document or existing codebase patterns.
